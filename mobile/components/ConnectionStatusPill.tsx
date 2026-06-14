/**
 * ConnectionStatusPill — always-visible connection indicator.
 *
 * Reads the single human-facing status (`useConnectionStatus`) so it says the
 * same clear thing as every other surface: Connecting… / Reconnecting… /
 * Syncing… / Connected / Not connected. The dot pulses during work-in-progress
 * states (connecting, reconnecting, syncing) so a slow/VPN connect reads as
 * "still working" rather than a confusing flicker. Tap → connection switcher.
 */

import { useEffect, useRef } from 'react';
import { Text, TouchableOpacity, StyleSheet, View, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnectionStatus } from '../lib/store';

export default function ConnectionStatusPill() {
  const router = useRouter();
  const { label, color, pulsing } = useConnectionStatus();

  // Pulse the dot while a connection is in progress.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulsing) { pulse.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulsing, pulse]);

  return (
    <TouchableOpacity
      onPress={() => router.push('/connection-switcher')}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Connection: ${label}. Tap to open the connection switcher.`}
    >
      <View style={[styles.pill, { backgroundColor: `${color}15`, borderColor: color }]}>
        <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
        <Text style={[styles.label, { color }]}>{label}</Text>
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
