/**
 * ConnectionStatusPill — session-persistence plan / item 5.5.
 *
 * Always-visible chrome indicator for the current connection state.
 * Reads the *debounced* state from `useDebouncedConnectionState` (item
 * 5.4) so sub-2s blips never surface as a colour flash. Tap → opens
 * the connection-switcher modal, which is already the existing
 * connection-management surface on mobile.
 */

import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useDebouncedConnectionState } from '../lib/store';
import type { ConnectionState } from '../lib/types';

interface StateVisual {
  color: string;
  bg: string;
  label: string;
}

const STATE_STYLE: Record<ConnectionState, StateVisual> = {
  connected:    { color: '#10b981', bg: '#10b98115', label: 'online' },
  connecting:   { color: '#3b82f6', bg: '#3b82f615', label: 'connecting' },
  reconnecting: { color: '#3b82f6', bg: '#3b82f615', label: 'reconnecting' },
  disconnected: { color: '#71717a', bg: '#71717a15', label: 'offline' },
  failed:       { color: '#ef4444', bg: '#ef444415', label: 'offline' },
};

export default function ConnectionStatusPill() {
  const router = useRouter();
  const state = useDebouncedConnectionState();
  const s = STATE_STYLE[state];

  return (
    <TouchableOpacity
      onPress={() => router.push('/connection-switcher')}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Connection: ${s.label}. Tap to open the connection switcher.`}
    >
      <View style={[styles.pill, { backgroundColor: s.bg, borderColor: s.color }]}>
        <View style={[styles.dot, { backgroundColor: s.color }]} />
        <Text style={[styles.label, { color: s.color }]}>{s.label}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 12,
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
});
