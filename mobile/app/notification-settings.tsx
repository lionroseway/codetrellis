/**
 * Notification settings — permission + desktop bind status, plus a manual
 * "Enable / Re-bind" action.
 *
 * Why this screen exists: push token registration used to happen only
 * automatically on connect, with zero visibility — when it failed (old build,
 * denied permission, channel not open) it failed silently and the user had no
 * recourse. This surfaces the real state and gives a one-tap recovery, so an
 * existing connection can re-share its token at any time.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Stack } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useConnectionState } from '../lib/store';
import {
  getPushPermission,
  getPushBindState,
  bindPushToDesktop,
  onPushAck,
} from '../lib/push';

type Perm = 'granted' | 'denied' | 'undetermined';

const PUSH_EVENTS: { icon: string; label: string; desc: string }[] = [
  { icon: '🟣', label: 'Decision needed', desc: 'An agent hit a genuine choice it can’t make alone.' },
  { icon: '🔴', label: 'Stuck', desc: 'An agent is failing repeatedly and wants a hand.' },
  { icon: '🟡', label: 'Context needed', desc: 'An agent is missing knowledge only you have.' },
  { icon: '🔵', label: 'Handoff', desc: 'Work is being handed to you — here’s what was tried.' },
];

export default function NotificationSettingsScreen() {
  const connState = useConnectionState();
  const connected = connState === 'connected';

  const [perm, setPerm] = useState<Perm>('undetermined');
  const [bind, setBind] = useState(getPushBindState());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPerm(await getPushPermission());
    setBind(getPushBindState());
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // Live-update when the desktop acknowledges our token.
  useEffect(() => onPushAck(() => setBind(getPushBindState())), []);

  const onBind = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await bindPushToDesktop();
      await refresh();
      if (r.ok) {
        setResult('Token sent — waiting for the desktop to confirm…');
      } else if (r.reason === 'permission') {
        setResult('Notifications are blocked. Enable them in iOS Settings, then try again.');
      } else if (r.reason === 'offline') {
        setResult('Got a token but no desktop is connected. Connect first, then re-bind.');
      } else {
        setResult('Couldn’t get a push token on this device.');
      }
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const boundLabel = bind.acked
    ? 'Confirmed by desktop'
    : bind.tokenSent
      ? 'Sent — awaiting confirmation'
      : 'Not bound';
  const boundColor = bind.acked ? '#22c55e' : bind.tokenSent ? '#eab308' : '#71717a';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Get a push when an agent needs you while the app is closed or backgrounded —
          decisions, hand-offs, and stuck moments. Nothing buzzes while you’re actively
          watching on a connected phone.
        </Text>

        {/* Status */}
        <Text style={styles.sectionTitle}>STATUS</Text>
        <View style={styles.card}>
          <StatusRow
            label="Permission"
            value={perm === 'granted' ? 'Allowed' : perm === 'denied' ? 'Blocked' : 'Not asked'}
            color={perm === 'granted' ? '#22c55e' : perm === 'denied' ? '#ef4444' : '#71717a'}
          />
          <View style={styles.divider} />
          <StatusRow label="Bound to desktop" value={boundLabel} color={boundColor} />
          {bind.token && (
            <Text style={styles.tokenHint} numberOfLines={1}>
              {bind.token.replace('ExponentPushToken[', 'token …').replace(']', '')}
            </Text>
          )}
        </View>

        {/* Action */}
        <TouchableOpacity
          style={[styles.bindBtn, (!connected || busy) && styles.bindBtnDisabled]}
          onPress={onBind}
          disabled={!connected || busy}
          activeOpacity={0.8}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.bindText}>
              {perm === 'granted' ? 'Re-bind to this desktop' : 'Enable notifications'}
            </Text>
          )}
        </TouchableOpacity>
        {!connected && (
          <Text style={styles.warnHint}>Connect to a desktop first — the token rides the live link.</Text>
        )}
        {result && <Text style={styles.resultHint}>{result}</Text>}
        {perm === 'denied' && (
          <TouchableOpacity onPress={() => Linking.openSettings()}>
            <Text style={styles.linkHint}>Open iOS Settings →</Text>
          </TouchableOpacity>
        )}

        {/* What triggers a push */}
        <Text style={styles.sectionTitle}>WHAT YOU’LL BE PINGED FOR</Text>
        <View style={styles.card}>
          {PUSH_EVENTS.map((e, i) => (
            <View key={e.label}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.eventRow}>
                <Text style={styles.eventIcon}>{e.icon}</Text>
                <View style={styles.eventInfo}>
                  <Text style={styles.eventLabel}>{e.label}</Text>
                  <Text style={styles.eventDesc}>{e.desc}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.footnote}>
          Re-bind any time you reinstall, switch desktops, or notifications stop arriving.
        </Text>
      </ScrollView>
    </View>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusValueWrap}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.statusValue, { color }]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  intro: { color: '#a1a1aa', fontSize: 13, lineHeight: 19, marginBottom: 4 },

  sectionTitle: {
    fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1,
    marginTop: 22, marginBottom: 8,
  },
  card: {
    backgroundColor: '#18181b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#27272a',
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#27272a', marginVertical: 12 },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusLabel: { color: '#e4e4e7', fontSize: 14, fontWeight: '500' },
  statusValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusValue: { fontSize: 14, fontWeight: '600' },
  tokenHint: { color: '#52525b', fontSize: 11, fontFamily: 'Menlo', marginTop: 10 },

  bindBtn: {
    backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 18,
  },
  bindBtnDisabled: { backgroundColor: '#27272a' },
  bindText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  warnHint: { color: '#eab308', fontSize: 12, marginTop: 8, textAlign: 'center' },
  resultHint: { color: '#a1a1aa', fontSize: 12, marginTop: 10, textAlign: 'center', lineHeight: 17 },
  linkHint: { color: '#3b82f6', fontSize: 13, fontWeight: '600', marginTop: 10, textAlign: 'center' },

  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  eventIcon: { fontSize: 15, marginTop: 1 },
  eventInfo: { flex: 1 },
  eventLabel: { color: '#e4e4e7', fontSize: 14, fontWeight: '600' },
  eventDesc: { color: '#71717a', fontSize: 12, marginTop: 2, lineHeight: 16 },

  footnote: { color: '#52525b', fontSize: 11, marginTop: 16, lineHeight: 16 },
});
