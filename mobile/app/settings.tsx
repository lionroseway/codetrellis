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
import { getRpcTimeoutMs, setRpcTimeoutMs, RPC_TIMEOUT_MIN_MS, RPC_TIMEOUT_MAX_MS } from '../lib/prefs';
import { useDevicePowerStatus } from '../lib/store';
import { flushDiagnosticsToDesktop, snapshot as diagnosticsSnapshot } from '../lib/diagnostics';

interface PowerTriggers {
  whileMobileConnected: boolean;
  whileAgentActive: boolean;
  always: boolean;
}

interface PowerSettings {
  triggers: PowerTriggers;
  preventLidCloseSleep: boolean;
  onlyWhenOnAC: boolean;
}

interface PowerStatus {
  shouldBlock: boolean;
  reason: 'mobile-connected' | 'agent-active' | 'always' | null;
  ac: 'plugged' | 'battery' | 'unknown';
  platform: 'darwin' | 'win32' | 'linux' | 'web';
  updatedAt: string;
}

interface AppSettings {
  identity: { displayName: string; email: string };
  plans: {
    defaultVisibility: 'shared' | 'local';
    attachmentLocation: 'project' | 'user';
  };
  device: { deviceName: string; advertise: boolean; shareAudio: boolean; mobileApiPort: number };
  power: PowerSettings;
  mcp: { port: number };
}

export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Plan item 4.4 + 11.1 — runtime power status (shouldBlock, reason,
  // ac, platform). Now read reactively from the state-sync snapshot
  // (which carries `powerStatus` since 11.1) instead of a 4s RPC poll.
  // Drives both the live status strip and the platform-gate for the
  // macOS-only lid-close toggle.
  const powerStatusFromSnapshot = useDevicePowerStatus();
  // Fallback poll: when connected to a pre-11.1 desktop (snapshot has
  // no powerStatus), poll `power.status` once on mount as before so the
  // UI still works. Cheap to keep; pure backwards-compat.
  const [powerStatusFallback, setPowerStatusFallback] = useState<PowerStatus | null>(null);
  const powerStatus = powerStatusFromSnapshot ?? powerStatusFallback;

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

  // Pre-11.1 desktops don't put powerStatus in the snapshot. Probe
  // once on mount, then forget — if the snapshot ever provides it
  // we'll silently switch over via the ?? above. No interval poll.
  useEffect(() => {
    if (powerStatusFromSnapshot) return; // snapshot has it — skip RPC
    let cancelled = false;
    rpc<PowerStatus>('power.status')
      .then((s) => { if (!cancelled) setPowerStatusFallback(s); })
      .catch(() => { /* desktop unreachable / no power.status RPC — keep null */ });
    return () => { cancelled = true; };
  }, [powerStatusFromSnapshot]);

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
        power: settings.power,
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
    // Desktop settings unavailable (often a slow/unreachable connection) — but
    // still expose the local Connection timeout here, since raising it is the
    // very fix for that situation.
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Settings' }} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <ConnectionTimeoutCard />
          <Text style={styles.sectionTitle}>DESKTOP SETTINGS</Text>
          <View style={styles.card}>
            <Text style={styles.errorText}>{error ?? 'No settings'}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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

        {/* Power (session-persistence plan / Track A) */}
        <Text style={styles.sectionTitle}>POWER</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Keep the desktop awake based on what you&apos;re doing. Toggles are independent — the blocker engages on the union of what&apos;s checked, then disengaged by the battery safety net if that&apos;s on.
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.label}>Awake while mobile connected</Text>
              <Text style={styles.hint}>Holds the assertion while your phone is paired and active.</Text>
            </View>
            <Switch
              value={settings.power.triggers.whileMobileConnected}
              onValueChange={(v) => patch('power', {
                triggers: { ...settings.power.triggers, whileMobileConnected: v },
              })}
              trackColor={{ true: '#3b82f6', false: '#27272a' }}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.label}>Awake while agent active</Text>
              <Text style={styles.hint}>Stays on for 5 minutes after the last MCP tool call.</Text>
            </View>
            <Switch
              value={settings.power.triggers.whileAgentActive}
              onValueChange={(v) => patch('power', {
                triggers: { ...settings.power.triggers, whileAgentActive: v },
              })}
              trackColor={{ true: '#3b82f6', false: '#27272a' }}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.label}>Awake always</Text>
              <Text style={styles.hint}>Holds the assertion the entire time CodeTrellis runs.</Text>
            </View>
            <Switch
              value={settings.power.triggers.always}
              onValueChange={(v) => patch('power', {
                triggers: { ...settings.power.triggers, always: v },
              })}
              trackColor={{ true: '#3b82f6', false: '#27272a' }}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.label}>Disable when on battery</Text>
              <Text style={styles.hint}>
                {powerStatus && powerStatus.ac !== 'unknown'
                  ? `Current AC state: ${powerStatus.ac}.`
                  : 'No battery info — this toggle has no effect on this desktop.'}
              </Text>
            </View>
            <Switch
              value={settings.power.onlyWhenOnAC}
              onValueChange={(v) => patch('power', { onlyWhenOnAC: v })}
              trackColor={{ true: '#3b82f6', false: '#27272a' }}
            />
          </View>

          {powerStatus?.platform === 'darwin' && (
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Text style={styles.label}>Prevent lid-close sleep</Text>
                <Text style={styles.hint}>
                  macOS-only. Uses `caffeinate -s` while awake. powerSaveBlocker alone doesn&apos;t beat lid-close on Mac.
                </Text>
              </View>
              <Switch
                value={settings.power.preventLidCloseSleep}
                onValueChange={(v) => patch('power', { preventLidCloseSleep: v })}
                trackColor={{ true: '#3b82f6', false: '#27272a' }}
              />
            </View>
          )}

          {/* Live status strip — mirrors the desktop's bottom-of-section indicator */}
          <View style={styles.statusStrip}>
            <Text style={styles.statusStripText}>
              <Text style={styles.statusStripMono}>Status:</Text>{' '}
              {powerStatus ? (
                powerStatus.shouldBlock ? (
                  <Text style={styles.statusActive}>
                    awake{powerStatus.reason ? ` (${powerStatus.reason})` : ''}
                  </Text>
                ) : (
                  <Text>idle</Text>
                )
              ) : (
                <Text>loading…</Text>
              )}
              {powerStatus && powerStatus.ac !== 'unknown' && (
                <Text>{' · AC: '}<Text style={styles.statusStripMono}>{powerStatus.ac}</Text></Text>
              )}
              {powerStatus && (
                <Text>{' · '}<Text style={styles.statusStripMono}>{powerStatus.platform}</Text></Text>
              )}
            </Text>
          </View>
        </View>

        {/* Connection (on-device) */}
        <ConnectionTimeoutCard />

        {/* Diagnostics (Plan 11.2) */}
        <DiagnosticsCard />

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

/**
 * On-device request-timeout control. Persists locally (not to the desktop),
 * so it works even when the desktop is unreachable — which is exactly when a
 * user on a slow/VPN link needs to raise it. The RPC layer reads this value
 * on every request, so changes apply immediately (no reconnect/rebuild).
 */
function ConnectionTimeoutCard() {
  const [sec, setSec] = useState(String(Math.round(getRpcTimeoutMs() / 1000)));
  const [savedAt, setSavedAt] = useState(false);
  const minSec = Math.round(RPC_TIMEOUT_MIN_MS / 1000);
  const maxSec = Math.round(RPC_TIMEOUT_MAX_MS / 1000);

  const commit = useCallback(async () => {
    const n = parseInt(sec, 10);
    const ms = Number.isFinite(n) ? n * 1000 : getRpcTimeoutMs();
    const stored = await setRpcTimeoutMs(ms);
    setSec(String(Math.round(stored / 1000))); // reflect the clamped value
    setSavedAt(true);
    setTimeout(() => setSavedAt(false), 1500);
  }, [sec]);

  return (
    <>
      <Text style={styles.sectionTitle}>CONNECTION</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Request timeout (seconds)</Text>
        <TextInput
          style={styles.input}
          value={sec}
          onChangeText={setSec}
          onEndEditing={commit}
          onBlur={commit}
          keyboardType="number-pad"
          returnKeyType="done"
          placeholder="30"
          placeholderTextColor="#52525b"
          maxLength={3}
        />
        <Text style={styles.hint}>
          How long the app waits for the desktop to answer each request. Raise
          this if you connect over a slow link or VPN (e.g. Tailscale) and see
          “request timed out” errors. Applies on this device only ({minSec}–{maxSec}s).
          {savedAt ? '  ✓ Saved' : ''}
        </Text>
      </View>
    </>
  );
}

/**
 * Plan 11.2 — diagnostics ring shipping. Shows the current ring depth
 * and a "Send to desktop" button that calls the `diagnostics.flush`
 * RPC. The desktop's daily-rotated log file then contains the
 * cross-side lifecycle narrative for the most recent ~500 events.
 */
function DiagnosticsCard() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Re-read count when the screen re-focuses or after a flush.
  const [count, setCount] = useState<number>(() => diagnosticsSnapshot().length);

  const send = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const wrote = await flushDiagnosticsToDesktop();
      setStatus(wrote > 0 ? `Sent ${wrote} entries to the desktop log.` : 'Nothing to send (or desktop unreachable).');
    } finally {
      setBusy(false);
      setCount(diagnosticsSnapshot().length);
    }
  }, []);

  return (
    <>
      <Text style={styles.sectionTitle}>DIAGNOSTICS</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Recent events buffered: {count}</Text>
        <Text style={styles.hint}>
          Lifecycle, network, and RPC events from the last few minutes are kept
          in memory on this device. Send them to the desktop log if something
          weird happens — easier to share than a screenshot.
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, busy && { opacity: 0.5 }]}
          onPress={send}
          disabled={busy}
        >
          <Text style={styles.retryText}>{busy ? 'Sending…' : 'Send to desktop log'}</Text>
        </TouchableOpacity>
        {status && <Text style={styles.hint}>{status}</Text>}
      </View>
    </>
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
  container: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: 'transparent' },
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

  // Power status strip
  statusStrip: {
    marginTop: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#27272a',
  },
  statusStripText: { color: '#a1a1aa', fontSize: 11, lineHeight: 16 },
  statusStripMono: { fontFamily: 'Menlo', color: '#71717a' },
  statusActive: { color: '#10b981', fontWeight: '600' },
});
