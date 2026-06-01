/**
 * Connection switcher — modal overlay for switching between desktops.
 *
 * Accessible from within the workspace (tap the connection bar on
 * the Home tab). Shows all paired desktops with connect/disconnect/
 * switch actions. Selecting a different desktop disconnects the
 * current one and connects to the new one.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { loadPairedDesktops } from '../lib/storage';
import { connection } from '../lib/connection';
import { registerForPush, sendPushTokenToDesktop } from '../lib/push';
import { startDiscovery, stopDiscovery, onDiscoveryChange } from '../lib/discovery';
import type { PairedDesktop, ConnectionState } from '../lib/types';

export default function ConnectionSwitcherScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [devices, setDevices] = useState<PairedDesktop[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(connection.state);
  const [connectedFingerprint, setConnectedFingerprint] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    const loaded = await loadPairedDesktops();
    setDevices(loaded);
  }, []);

  // Reload devices when screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadDevices();
    }, [loadDevices]),
  );

  // Discovery for auto-updating addresses
  useEffect(() => {
    startDiscovery();
    const unsub = onDiscoveryChange(() => {
      loadDevices();
    });
    return () => {
      unsub();
      stopDiscovery();
    };
  }, [loadDevices]);

  // Track connection state
  useEffect(() => {
    const unsub = connection.onStateChange((state, fingerprint) => {
      setConnectionState(state);
      setConnectedFingerprint(state === 'connected' ? fingerprint : null);
      if (state === 'connected') {
        setSwitchingTo(null);
      }
    });
    return unsub;
  }, []);

  const handleSwitch = async (device: PairedDesktop) => {
    const isAlreadyConnected = connectedFingerprint === device.fingerprint;
    if (isAlreadyConnected) {
      // Already connected to this one — just go back
      router.back();
      return;
    }

    setSwitchingTo(device.fingerprint);

    try {
      // Disconnect current connection first
      connection.disconnect();

      // Small delay for cleanup
      await new Promise((r) => setTimeout(r, 300));

      // Connect to the new desktop
      await connection.connect({
        type: 'webrtc',
        pairingId: device.pairingId ?? '',
        fingerprint: device.fingerprint,
        sharedSecret: device.sharedSecret,
        desktopAddress: device.lastKnownAddress,
        mobileApiPort: device.lastKnownPort || 19480,
      });

      const token = await registerForPush();
      if (token) {
        sendPushTokenToDesktop(token);
      }

      // Go back to workspace
      router.back();
    } catch (err) {
      setSwitchingTo(null);
      Alert.alert('Connection Failed', String(err));
    }
  };

  const handleDisconnect = () => {
    connection.disconnect();
    // Navigate back to root pairing screen
    try { router.dismissAll(); } catch { /* */ }
    router.replace('/');
  };

  const handlePairNew = () => {
    router.push('/pair');
  };

  const renderDevice = ({ item }: { item: PairedDesktop }) => {
    const isConnected = connectedFingerprint === item.fingerprint;
    const isSwitching = switchingTo === item.fingerprint;

    return (
      <TouchableOpacity
        style={[
          styles.deviceCard,
          isConnected && styles.deviceCardActive,
        ]}
        onPress={() => handleSwitch(item)}
        activeOpacity={0.7}
        disabled={switchingTo !== null}
      >
        <View style={styles.deviceRow}>
          {/* Icon */}
          <View style={[
            styles.iconWrap,
            isConnected && styles.iconWrapActive,
          ]}>
            <Text style={styles.iconText}>
              {item.alias?.toLowerCase().includes('mac') ? '\u{1F4BB}' : '\u{1F5A5}'}
            </Text>
          </View>

          {/* Info */}
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceAlias} numberOfLines={1}>
              {item.alias}
            </Text>
            <Text style={styles.deviceMeta}>
              {isConnected
                ? 'Currently connected'
                : item.lastConnected
                  ? `Last seen ${formatRelative(item.lastConnected)}`
                  : 'Never connected'}
            </Text>
          </View>

          {/* Status / action */}
          {isSwitching ? (
            <ActivityIndicator size="small" color="#3b82f6" />
          ) : isConnected ? (
            <View style={styles.connectedBadge}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedText}>Live</Text>
            </View>
          ) : (
            <View style={styles.switchBadge}>
              <Text style={styles.switchText}>Switch</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: 16 }]}>
        <Text style={styles.headerTitle}>Switch Connection</Text>
        <Text style={styles.headerSubtitle}>
          {connectedFingerprint
            ? `Connected to ${devices.find((d) => d.fingerprint === connectedFingerprint)?.alias ?? 'desktop'}`
            : 'Not connected'}
        </Text>
      </View>

      {/* Device list */}
      <FlatList
        data={devices}
        keyExtractor={(d) => d.fingerprint}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No paired desktops</Text>
            <Text style={styles.emptySubtext}>
              Pair with a desktop first to switch connections
            </Text>
          </View>
        }
      />

      {/* Bottom actions */}
      <View style={[styles.bottomActions, { paddingBottom: insets.bottom + 16 }]}>
        {connectedFingerprint && (
          <TouchableOpacity
            style={styles.disconnectButton}
            onPress={handleDisconnect}
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.pairButton}
          onPress={handlePairNew}
        >
          <Text style={styles.pairButtonIcon}>+</Text>
          <Text style={styles.pairButtonText}>Pair New Desktop</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatRelative(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e1e22',
  },
  headerTitle: {
    color: '#fafafa',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  headerSubtitle: {
    color: '#71717a',
    fontSize: 13,
  },

  // List
  list: {
    padding: 16,
  },

  // Device cards
  deviceCard: {
    backgroundColor: '#111113',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e1e22',
  },
  deviceCardActive: {
    borderColor: '#22c55e30',
    backgroundColor: '#0a1a0f',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1a1a1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconWrapActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  iconText: {
    fontSize: 20,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceAlias: {
    color: '#fafafa',
    fontSize: 15,
    fontWeight: '600',
  },
  deviceMeta: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },

  // Status badges
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    gap: 5,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  connectedText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '600',
  },
  switchBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  switchText: {
    color: '#3b82f6',
    fontSize: 11,
    fontWeight: '600',
  },

  // Empty
  empty: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#52525b',
    fontSize: 14,
    marginBottom: 4,
  },
  emptySubtext: {
    color: '#3f3f46',
    fontSize: 12,
    textAlign: 'center',
  },

  // Bottom actions
  bottomActions: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e1e22',
    gap: 8,
  },
  disconnectButton: {
    backgroundColor: '#1a1a1e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef444430',
  },
  disconnectText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  pairButton: {
    flexDirection: 'row',
    backgroundColor: '#18181b',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  pairButtonIcon: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: '300',
  },
  pairButtonText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '500',
  },
});
