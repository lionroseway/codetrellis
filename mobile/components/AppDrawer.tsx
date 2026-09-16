/**
 * AppDrawer — the global navigation side panel.
 *
 * Mounted once at the root layout, it overlays every screen. Opened with the
 * ☰ button in the tab header (or `useDrawerStore().openDrawer()` anywhere).
 *
 * Why it exists: once you connect to a desktop you drop into the tab stack and
 * lose easy access to device-level navigation (switch desktop, pair, settings,
 * notifications). This panel restores that traversal from anywhere — quick
 * device switching up top, app destinations below.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useDrawerStore } from '../lib/drawer';
import { useConnectionState, useConnectedFingerprint } from '../lib/store';
import { connection } from '../lib/connection';
import { loadPairedDesktops } from '../lib/storage';
import { registerForPush, sendPushTokenToDesktop } from '../lib/push';
import type { PairedDesktop } from '../lib/types';

const SCREEN_W = Dimensions.get('window').width;
const PANEL_W = Math.min(330, Math.round(SCREEN_W * 0.86));

export default function AppDrawer() {
  const open = useDrawerStore((s) => s.open);
  const closeDrawer = useDrawerStore((s) => s.closeDrawer);
  const insets = useSafeAreaInsets();

  const connState = useConnectionState();
  const connectedFingerprint = useConnectedFingerprint();
  const [devices, setDevices] = useState<PairedDesktop[]>([]);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  // Keep the panel mounted through the close animation, then unmount so it
  // stops intercepting touches.
  const [mounted, setMounted] = useState(false);
  const translateX = useRef(new Animated.Value(-PANEL_W)).current;
  const scrim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      void loadPairedDesktops().then(setDevices);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(scrim, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -PANEL_W, duration: 200, useNativeDriver: true }),
        Animated.timing(scrim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [open, translateX, scrim]);

  const go = useCallback((path: string) => {
    closeDrawer();
    // Let the close animation start before navigating.
    setTimeout(() => { try { router.push(path as never); } catch { /* */ } }, 60);
  }, [closeDrawer]);

  const goHome = useCallback(() => {
    closeDrawer();
    setTimeout(() => { try { router.navigate('/(tabs)' as never); } catch { /* */ } }, 60);
  }, [closeDrawer]);

  const handleSwitch = useCallback(async (device: PairedDesktop) => {
    if (connectedFingerprint === device.fingerprint) { closeDrawer(); return; }
    setSwitchingTo(device.fingerprint);
    try {
      connection.disconnect();
      await new Promise((r) => setTimeout(r, 300));
      await connection.connect({
        type: 'webrtc',
        pairingId: device.pairingId ?? '',
        fingerprint: device.fingerprint,
        sharedSecret: device.sharedSecret,
        desktopAddress: device.lastKnownAddress,
        candidateAddresses: device.candidateAddresses,
        mobileApiPort: device.lastKnownPort || 19480,
      });
      const token = await registerForPush();
      if (token) sendPushTokenToDesktop(token);
      closeDrawer();
      setTimeout(() => { try { router.navigate('/(tabs)' as never); } catch { /* */ } }, 60);
    } catch (err) {
      Alert.alert('Connection failed', String(err));
    } finally {
      setSwitchingTo(null);
    }
  }, [connectedFingerprint, closeDrawer]);

  const handleDisconnect = useCallback(() => {
    closeDrawer();
    connection.disconnect();
    setTimeout(() => {
      try { router.dismissAll(); } catch { /* */ }
      try { router.replace('/' as never); } catch { /* */ }
    }, 60);
  }, [closeDrawer]);

  if (!mounted) return null;

  const connected = connState === 'connected';
  const currentAlias = devices.find((d) => d.fingerprint === connectedFingerprint)?.alias;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Scrim */}
      <Animated.View style={[styles.scrim, { opacity: scrim }]} pointerEvents={open ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        style={[
          styles.panel,
          { width: PANEL_W, paddingTop: insets.top + 14, transform: [{ translateX }] },
        ]}
      >
        {/* Header — identity + live connection */}
        <View style={styles.header}>
          <Text style={styles.brand}>CodeTrellis</Text>
          <View style={styles.connRow}>
            <View style={[styles.dot, connected ? styles.dotOn : styles.dotOff]} />
            <Text style={styles.connText} numberOfLines={1}>
              {connected ? (currentAlias ?? 'Connected') : connState === 'connecting' ? 'Connecting…' : 'Not connected'}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Devices */}
          {devices.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>DEVICES</Text>
              {devices.map((d) => {
                const isLive = connectedFingerprint === d.fingerprint;
                const isBusy = switchingTo === d.fingerprint;
                return (
                  <TouchableOpacity
                    key={d.fingerprint}
                    style={[styles.deviceRow, isLive && styles.deviceRowLive]}
                    onPress={() => handleSwitch(d)}
                    disabled={switchingTo !== null}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.deviceIcon}>
                      {d.alias?.toLowerCase().includes('mac') ? '\u{1F4BB}' : '\u{1F5A5}'}
                    </Text>
                    <Text style={styles.deviceAlias} numberOfLines={1}>{d.alias}</Text>
                    {isBusy ? (
                      <ActivityIndicator size="small" color="#3b82f6" />
                    ) : isLive ? (
                      <View style={styles.liveBadge}><Text style={styles.liveText}>Live</Text></View>
                    ) : (
                      <Text style={styles.switchHint}>Switch</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* Navigation */}
          <Text style={styles.sectionTitle}>GO TO</Text>
          <NavRow icon="🏠" label="Home" onPress={goHome} />
          <NavRow icon="🔔" label="Notifications" onPress={() => go('/notification-settings')} />
          <NavRow icon="⚙️" label="App settings" onPress={() => go('/settings')} />
          <NavRow icon="➕" label="Pair new device" onPress={() => go('/pair')} />
        </ScrollView>

        {/* Footer */}
        {connected && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function NavRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.navIcon}>{icon}</Text>
      <Text style={styles.navLabel}>{label}</Text>
      <Text style={styles.navChevron}>{'›'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    backgroundColor: '#0a0c18',
    borderRightWidth: 1, borderRightColor: '#1e1e22',
  },
  header: {
    paddingHorizontal: 18, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1e1e22',
  },
  brand: { color: '#fafafa', fontSize: 19, fontWeight: '800', letterSpacing: 0.3 },
  connRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: '#22c55e' },
  dotOff: { backgroundColor: '#52525b' },
  connText: { color: '#a1a1aa', fontSize: 13, flex: 1 },

  scroll: { paddingHorizontal: 12, paddingTop: 14 },
  sectionTitle: {
    fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1,
    marginTop: 14, marginBottom: 6, marginLeft: 6,
  },

  deviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10,
    backgroundColor: '#111113', marginBottom: 6,
    borderWidth: 1, borderColor: '#1e1e22',
  },
  deviceRowLive: { borderColor: '#22c55e30', backgroundColor: '#0a1a0f' },
  deviceIcon: { fontSize: 17 },
  deviceAlias: { color: '#e4e4e7', fontSize: 14, fontWeight: '600', flex: 1 },
  liveBadge: {
    backgroundColor: 'rgba(34,197,94,0.12)', paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 100,
  },
  liveText: { color: '#22c55e', fontSize: 11, fontWeight: '700' },
  switchHint: { color: '#3b82f6', fontSize: 12, fontWeight: '600' },

  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 13, borderRadius: 10,
  },
  navIcon: { fontSize: 17, width: 24, textAlign: 'center' },
  navLabel: { color: '#e4e4e7', fontSize: 15, fontWeight: '500', flex: 1 },
  navChevron: { color: '#52525b', fontSize: 20, fontWeight: '400' },

  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e1e22',
  },
  disconnectBtn: {
    backgroundColor: '#1a1a1e', paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', borderWidth: 1, borderColor: '#ef444430',
  },
  disconnectText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
});
