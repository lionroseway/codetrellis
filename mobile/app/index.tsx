/**
 * Home screen — paired desktops list with modern card UI.
 *
 * Shows a branded header with CodeTrellis wordmark, paired device
 * cards with connection status, and a prominent "Pair New Device"
 * action. Refreshes the device list when the screen regains focus
 * (e.g. after returning from the pair screen).
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  RefreshControl,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { loadPairedDesktops, removePairedDesktop } from '../lib/storage';
import { connection } from '../lib/connection';
import { registerForPush, sendPushTokenToDesktop } from '../lib/push';
import { startDiscovery, stopDiscovery, getDiscoveredDesktops, onDiscoveryChange, type DiscoveredDesktop } from '../lib/discovery';
import type { PairedDesktop, ConnectionState } from '../lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [devices, setDevices] = useState<PairedDesktop[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectedFingerprint, setConnectedFingerprint] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDevices = useCallback(async () => {
    const loaded = await loadPairedDesktops();
    setDevices(loaded);
  }, []);

  // Reload devices every time the screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadDevices();
    }, [loadDevices]),
  );

  // Start mDNS discovery — auto-updates paired desktop addresses/ports
  useEffect(() => {
    startDiscovery();
    const unsub = onDiscoveryChange((_desktops) => {
      // Refresh device list to pick up updated addresses from discovery
      loadDevices();
    });
    return () => {
      unsub();
      stopDiscovery();
    };
  }, [loadDevices]);

  useEffect(() => {
    const unsub = connection.onStateChange((state, fingerprint) => {
      setConnectionState(state);
      setConnectedFingerprint(state === 'connected' ? fingerprint : null);
    });
    return unsub;
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDevices();
    setRefreshing(false);
  };

  const handleConnect = async (device: PairedDesktop) => {
    try {
      // pairingId may be missing for pre-upgrade devices — the desktop
      // accepts fingerprint as a fallback and returns the pairingId
      // for silent upgrade (stored automatically on connect).
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

      router.push('/workspace');
    } catch (err) {
      Alert.alert('Connection Failed', String(err));
    }
  };

  const handleDisconnect = () => {
    connection.disconnect();
  };

  const handleUnpair = (device: PairedDesktop) => {
    Alert.alert(
      'Remove Device',
      `Unpair "${device.alias}"? You'll need to scan the QR code again to reconnect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (connectedFingerprint === device.fingerprint) {
              connection.disconnect();
            }
            await removePairedDesktop(device.fingerprint);
            await loadDevices();
          },
        },
      ],
    );
  };

  const renderDevice = ({ item }: { item: PairedDesktop }) => {
    const isConnected = connectedFingerprint === item.fingerprint;
    const isConnecting = connectionState === 'connecting' && !isConnected;

    return (
      <TouchableOpacity
        style={styles.deviceCard}
        onPress={() => isConnected ? router.push('/workspace') : handleConnect(item)}
        onLongPress={() => handleUnpair(item)}
        activeOpacity={0.7}
      >
        {/* Icon + info */}
        <View style={styles.deviceRow}>
          <View style={[
            styles.deviceIconWrap,
            isConnected && styles.deviceIconWrapActive,
          ]}>
            <Text style={styles.deviceIconText}>
              {item.alias?.toLowerCase().includes('mac') ? '\u{1F4BB}' : '\u{1F5A5}'}
            </Text>
          </View>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceAlias} numberOfLines={1}>
              {item.alias}
            </Text>
            <Text style={styles.deviceMeta}>
              {isConnected
                ? 'Connected now'
                : item.lastConnected
                  ? `Last seen ${formatRelative(item.lastConnected)}`
                  : 'Never connected'}
            </Text>
          </View>
          <View style={[
            styles.statusIndicator,
            isConnected ? styles.statusConnected : styles.statusOffline,
          ]}>
            <View style={[
              styles.statusDot,
              isConnected ? styles.statusDotConnected : styles.statusDotOffline,
            ]} />
            <Text style={[
              styles.statusText,
              isConnected ? styles.statusTextConnected : styles.statusTextOffline,
            ]}>
              {isConnected ? 'Live' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Action row */}
        <View style={styles.actionRow}>
          {isConnected ? (
            <>
              <TouchableOpacity
                style={styles.actionButtonPrimary}
                onPress={() => router.push('/workspace')}
              >
                <Text style={styles.actionButtonPrimaryText}>Open Workspace</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButtonSecondary}
                onPress={handleDisconnect}
              >
                <Text style={styles.actionButtonDangerText}>Disconnect</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionButtonPrimary, isConnecting && styles.buttonDisabled]}
                onPress={() => handleConnect(item)}
                disabled={isConnecting}
              >
                <Text style={styles.actionButtonPrimaryText}>
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButtonSecondary}
                onPress={() => handleUnpair(item)}
              >
                <Text style={styles.actionButtonDangerText}>Remove</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header with safe area */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.headerTitle}>
              <Text style={styles.headerTitleCode}>Code</Text>
              <Text style={styles.headerTitleTrellis}>Trellis</Text>
            </Text>
            <Text style={styles.headerSubtitle}>
              {devices.length === 0
                ? 'No paired desktops'
                : `${devices.length} paired desktop${devices.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
          {/* Settings gear — future */}
        </View>
      </View>

      <FlatList
        data={devices}
        keyExtractor={(d) => d.fingerprint}
        renderItem={renderDevice}
        contentContainerStyle={[
          styles.list,
          devices.length === 0 && styles.listEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#71717a"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {/* Trellis icon */}
            <View style={styles.emptyIconWrap}>
              <View style={styles.emptyTrellis}>
                <View style={styles.emptyTrellisRow}>
                  <View style={[styles.emptyNode, styles.emptyNodeAccent]} />
                  <View style={styles.emptyConnector} />
                  <View style={[styles.emptyNode, styles.emptyNodeDim]} />
                  <View style={styles.emptyConnector} />
                  <View style={[styles.emptyNode, styles.emptyNodeAccent]} />
                </View>
                <View style={styles.emptyTrellisVerts}>
                  <View style={styles.emptyVertLine} />
                  <View style={{ width: 16 }} />
                  <View style={[styles.emptyVertLine, { opacity: 0.3 }]} />
                  <View style={{ width: 16 }} />
                  <View style={styles.emptyVertLine} />
                </View>
                <View style={styles.emptyTrellisRow}>
                  <View style={[styles.emptyNode, styles.emptyNodeDim]} />
                  <View style={[styles.emptyConnector, { opacity: 0.3 }]} />
                  <View style={[styles.emptyNode, styles.emptyNodeHighlight]} />
                  <View style={[styles.emptyConnector, { opacity: 0.3 }]} />
                  <View style={[styles.emptyNode, styles.emptyNodeDim]} />
                </View>
              </View>
            </View>

            <Text style={styles.emptyTitle}>No paired devices</Text>
            <Text style={styles.emptyBody}>
              Pair with your desktop by scanning the QR{'\n'}code in CodeTrellis Settings
            </Text>
            <TouchableOpacity
              style={styles.emptyPairButton}
              onPress={() => router.push('/pair')}
            >
              <Text style={styles.emptyPairButtonIcon}>+</Text>
              <Text style={styles.emptyPairButtonText}>Pair Your Desktop</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Floating pair button — only show if devices exist */}
      {devices.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 16 }]}
          onPress={() => router.push('/pair')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>+</Text>
          <Text style={styles.fabText}>Pair New Device</Text>
        </TouchableOpacity>
      )}
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

// --- Styles ------------------------------------------------------------------

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
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerTitleCode: {
    color: '#fafafa',
  },
  headerTitleTrellis: {
    color: '#3b82f6',
  },
  headerSubtitle: {
    color: '#71717a',
    fontSize: 13,
    marginTop: 2,
  },

  // List
  list: {
    padding: 16,
    paddingBottom: 120,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  // Device card
  deviceCard: {
    backgroundColor: '#111113',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e1e22',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  deviceIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1a1a1e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  deviceIconWrapActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  deviceIconText: {
    fontSize: 22,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceAlias: {
    color: '#fafafa',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceMeta: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },

  // Status indicator
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    gap: 5,
  },
  statusConnected: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  statusOffline: {
    backgroundColor: 'rgba(113, 113, 122, 0.12)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotConnected: {
    backgroundColor: '#22c55e',
  },
  statusDotOffline: {
    backgroundColor: '#52525b',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusTextConnected: {
    color: '#22c55e',
  },
  statusTextOffline: {
    color: '#71717a',
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButtonPrimary: {
    flex: 1,
    backgroundColor: '#3b82f6',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionButtonPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  actionButtonSecondary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1a1a1e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDangerText: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: '#111113',
    borderWidth: 1,
    borderColor: '#1e1e22',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },

  // Mini trellis icon for empty state
  emptyTrellis: {
    alignItems: 'center',
  },
  emptyTrellisRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  emptyNodeAccent: {
    backgroundColor: '#3b82f6',
  },
  emptyNodeHighlight: {
    backgroundColor: '#60a5fa',
  },
  emptyNodeDim: {
    backgroundColor: '#3b82f640',
  },
  emptyConnector: {
    width: 16,
    height: 1.5,
    backgroundColor: '#3b82f650',
    marginHorizontal: 1,
  },
  emptyTrellisVerts: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 12,
  },
  emptyVertLine: {
    width: 1.5,
    height: 12,
    backgroundColor: '#3b82f650',
  },

  emptyTitle: {
    color: '#fafafa',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyBody: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  emptyPairButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f6',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
  },
  emptyPairButtonIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '300',
    marginTop: -1,
  },
  emptyPairButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  // FAB
  fab: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  fabIcon: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '300',
    marginTop: -1,
  },
  fabText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
