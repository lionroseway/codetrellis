/**
 * Settings — phone-appropriate subset of the desktop settings.
 *
 * Editable from the phone: identity (display name + email used for
 * attribution), plan defaults (visibility + attachment location), and
 * device presence (name, mDNS advertise, audio share). Infrastructure
 * settings (MCP port, data dir, sync paths) stay desktop-only.
 *
 * Reads via `settings.get`, writes the changed sections via
 * `settings.update` (which the desktop clamps to the safe subset).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';

interface AppSettings {
  identity: { displayName: string; email: string };
  plans: {
    defaultVisibility: 'shared' | 'local';
    attachmentLocation: 'project' | 'user';
  };
  device: { deviceName: string; advertise: boolean; shareAudio: boolean; mobileApiPort: number };
  mcp: { port: number };
}

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await rpc<AppSettings>('settings.get');
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Mutate a nested field locally and flag dirty.
  const patch = useCallback(<K extends keyof AppSettings>(
    section: K,
    values: Partial<AppSettings[K]>,
  ) => {
    setSettings((prev) => (prev ? { ...prev, [section]: { ...prev[section], ...values } } : prev));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await rpc('settings.update', {
        identity: settings.identity,
        plans: settings.plans,
        device: {
          deviceName: settings.device.deviceName,
          advertise: settings.device.advertise,
          shareAudio: settings.device.shareAudio,
        },
      });
      setDirty(false);
      Alert.alert('Saved', 'Settings updated on the desktop.');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Settings' }} />
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }
  if (error || !settings) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Settings' }} />
        <Text style={styles.errorText}>{error ?? 'No settings'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Settings',
          headerRight: () =>
            dirty ? (
              <TouchableOpacity onPress={save} disabled={saving} hitSlop={12}>
                <Text style={styles.saveBtn}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            ) : null,
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Identity */}
        <Text style={styles.sectionTitle}>IDENTITY</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            value={settings.identity.displayName}
            onChangeText={(t) => patch('identity', { displayName: t })}
            placeholder="Your name"
            placeholderTextColor="#52525b"
            autoCapitalize="words"
          />
          <Text style={[styles.label, styles.labelSpaced]}>Email (author key)</Text>
          <TextInput
            style={styles.input}
            value={settings.identity.email}
            onChangeText={(t) => patch('identity', { email: t })}
            placeholder="you@example.com"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.hint}>Used to attribute plans, comments, and commits to you.</Text>
        </View>

        {/* Plan defaults */}
        <Text style={styles.sectionTitle}>PLAN DEFAULTS</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Default visibility</Text>
          <Segmented
            value={settings.plans.defaultVisibility}
            options={[
              { value: 'shared', label: 'Shared (git)' },
              { value: 'local', label: 'Local (DB)' },
            ]}
            onChange={(v) => patch('plans', { defaultVisibility: v as 'shared' | 'local' })}
          />
          <Text style={styles.hint}>Shared plans export to .codetrellis/plans/ and ride in git.</Text>

          <Text style={[styles.label, styles.labelSpaced]}>Attachment location</Text>
          <Segmented
            value={settings.plans.attachmentLocation}
            options={[
              { value: 'project', label: 'Project' },
              { value: 'user', label: 'User (~)' },
            ]}
            onChange={(v) => patch('plans', { attachmentLocation: v as 'project' | 'user' })}
          />
        </View>

        {/* Device */}
        <Text style={styles.sectionTitle}>DEVICE</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Device name</Text>
          <TextInput
            style={styles.input}
            value={settings.device.deviceName}
            onChangeText={(t) => patch('device', { deviceName: t })}
            placeholder="(auto — hostname)"
            placeholderTextColor="#52525b"
          />
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.label}>Advertise on local network</Text>
              <Text style={styles.hint}>Lets nearby devices discover this desktop (mDNS).</Text>
            </View>
            <Switch
              value={settings.device.advertise}
              onValueChange={(v) => patch('device', { advertise: v })}
              trackColor={{ true: '#3b82f6', false: '#27272a' }}
            />
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.label}>Share audio with peers</Text>
            </View>
            <Switch
              value={settings.device.shareAudio}
              onValueChange={(v) => patch('device', { shareAudio: v })}
              trackColor={{ true: '#3b82f6', false: '#27272a' }}
            />
          </View>
        </View>

        {/* Read-only desktop info */}
        <Text style={styles.sectionTitle}>DESKTOP (READ-ONLY)</Text>
        <View style={styles.card}>
          <InfoRow label="MCP server port" value={String(settings.mcp.port)} />
          <InfoRow label="Mobile API port" value={String(settings.device.mobileApiPort)} />
          <Text style={styles.hint}>Ports and data paths are managed from the desktop.</Text>
        </View>

        {dirty && (
          <TouchableOpacity style={styles.saveCta} onPress={save} disabled={saving}>
            <Text style={styles.saveCtaText}>{saving ? 'Saving…' : 'Save changes'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#09090b' },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f6',
    borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { color: '#3b82f6', fontWeight: '600', fontSize: 14 },
  saveBtn: { color: '#3b82f6', fontSize: 16, fontWeight: '700' },

  sectionTitle: {
    fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1,
    marginBottom: 8, marginTop: 18,
  },
  card: {
    backgroundColor: '#18181b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#27272a',
  },
  label: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  labelSpaced: { marginTop: 16 },
  input: {
    backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: '#e4e4e7', fontSize: 14, marginTop: 6,
  },
  hint: { color: '#71717a', fontSize: 11, marginTop: 6, lineHeight: 15 },

  segmented: {
    flexDirection: 'row', backgroundColor: '#0c0c0e', borderRadius: 8,
    borderWidth: 1, borderColor: '#27272a', padding: 3, marginTop: 6,
  },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  segmentActive: { backgroundColor: '#3b82f6' },
  segmentText: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#fff' },

  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, gap: 12,
  },
  switchLabel: { flex: 1 },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6,
  },
  infoLabel: { color: '#a1a1aa', fontSize: 13 },
  infoValue: { color: '#e4e4e7', fontSize: 13, fontFamily: 'Menlo', fontWeight: '600' },

  saveCta: {
    backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 24,
  },
  saveCtaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
