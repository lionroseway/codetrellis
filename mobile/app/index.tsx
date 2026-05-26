/**
 * Home screen — lists paired desktops, connect/disconnect, pair new.
 *
 * Each paired desktop shows:
 *   - Alias ("Work iMac")
 *   - Fingerprint (truncated)
 *   - Last connected timestamp
 *   - Connect/Disconnect button
 *   - Swipe to unpair
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { loadPairedDesktops, removePairedDesktop } from '../lib/storage';
import { connection } from '../lib/connection';
import { registerForPush, sendPushTokenToDesktop } from '../lib/push';
import type { PairedDesktop, ConnectionState } from '../lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const [devices, setDevices] = useState<PairedDesktop[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectedFingerprint, setConnectedFingerprint] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDevices = useCallback(async () => {
    const loaded = await loadPairedDesktops();
    setDevices(loaded);
  }, []);

  useEffect(() => {
    loadDevices();

    const unsub = connection.onStateChange((state, fingerprint) => {
      setConnectionState(state);
      setConnectedFingerprint(state === 'connected' ? fingerprint : null);
    });

    return unsub;
  }, [loadDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDevices();
    setRefreshing(false);
  };

  const handleConnect = async (device: PairedDesktop) => {
    try {
      await connection.connect({
        type: 'webrtc',
        fingerprint: device.fingerprint,
        sharedSecret: device.sharedSecret,
      });

      // Register push token with the desktop
      const token = await registerForPush();
      if (token) {
        sendPushTokenToDesktop(token);
      }

      // Navigate to workspace
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
      'Unpair Device',
      `Remove "${device.alias}"? You'll need to scan the QR code again to reconnect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
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
      >
        <View style={styles.deviceHeader}>
          <Text style={styles.deviceIcon}>
            {'\u{1F5A5}'} {/* Desktop emoji */}
          </Text>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceAlias}>{item.alias}</Text>
            <Text style={styles.deviceFingerprint}>
              {item.fingerprint.slice(0, 20)}...
            </Text>
          </View>
          <View style={[
            styles.statusDot,
            isConnected ? styles.statusConnected : styles.statusDisconnected,
          ]} />
        </View>

        <View style={styles.deviceFooter}>
          <Text style={styles.deviceMeta}>
            {item.lastConnected
              ? `Last connected ${formatRelative(item.lastConnected)}`
              : 'Never connected'}
          </Text>

          {isConnected ? (
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={handleDisconnect}
            >
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.connectButton, isConnecting && styles.buttonDisabled]}
              onPress={() => handleConnect(item)}
              disabled={isConnecting}
            >
              <Text style={styles.connectText}>
                {isConnecting ? 'Connecting...' : 'Connect'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={devices}
        keyExtractor={(d) => d.fingerprint}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#71717a"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{'\u{1F4F1}'}</Text>
            <Text style={styles.emptyTitle}>No paired devices</Text>
            <Text style={styles.emptyBody}>
              Pair with your desktop by scanning the QR code shown in CodeTrellis Settings → Devices.
            </Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.pairButton}
        onPress={() => router.push('/pair')}
      >
        <Text style={styles.pairButtonText}>+ Pair New Device</Text>
      </TouchableOpacity>
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
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  deviceCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceAlias: {
    color: '#e4e4e7',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceFingerprint: {
    color: '#71717a',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusConnected: {
    backgroundColor: '#22c55e',
  },
  statusDisconnected: {
    backgroundColor: '#52525b',
  },
  deviceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deviceMeta: {
    color: '#71717a',
    fontSize: 12,
  },
  connectButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  connectText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  disconnectButton: {
    backgroundColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disconnectText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#e4e4e7',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyBody: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  pairButton: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  pairButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
