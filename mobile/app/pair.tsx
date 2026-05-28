/**
 * Pair screen — v4 Bluetooth-style pairing.
 *
 * Flow:
 *   1. Camera opens → scan QR from desktop Settings → Devices.
 *   2. Parse v4 QR payload `{v:4, h, p, c}` (~50 bytes).
 *   3. Fetch full SDP offer from desktop's temp HTTP server.
 *   4. Create WebRTC answer → post back to temp server.
 *   5. Receive Bluetooth-style confirmation code.
 *   6. Display confirmation code → user verifies it matches desktop.
 *   7. WebRTC connects automatically → user names device → done.
 *
 * No second QR code. No webcam needed on desktop. One scan, done.
 */

import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { webrtc, type PairingResult } from '../lib/webrtc';
import { upsertPairedDesktop } from '../lib/storage';
import type { PairingQrPayload } from '../lib/types';

// --- Pairing States ----------------------------------------------------------

type PairingState =
  | 'scanning'       // Camera scanning desktop's QR
  | 'manual'         // Manual code entry (no camera / simulator)
  | 'connecting'     // Exchanging SDPs with temp server
  | 'connected'      // Exchange done — showing code for desktop entry
  | 'error';         // Something went wrong

// --- Pairing Timeout ---------------------------------------------------------

const PAIRING_TIMEOUT_MS = 55_000; // Slightly less than desktop's 60s

// --- Main Component ----------------------------------------------------------

export default function PairScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<PairingState>('scanning');
  const [pairingResult, setPairingResult] = useState<PairingResult | null>(null);
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('');
  const [manualCode, setManualCode] = useState('');
  const scannedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Monitor WebRTC connection state (informational — pairing doesn't
  // wait for WebRTC to connect, since the HTTP exchange + confirmation
  // code is sufficient to verify the pairing)
  useEffect(() => {
    const unsubscribe = webrtc.onStateChange((connectionState) => {
      console.log(`[Pair] WebRTC state: ${connectionState}`);
    });
    return unsubscribe;
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleBarCodeScanned = async (result: { type: string; data: string }) => {
    console.log('[Pair] Barcode scanned:', result.type, result.data?.slice(0, 80));
    if (scannedRef.current) return;
    scannedRef.current = true;

    try {
      // Parse the QR payload
      let payload: PairingQrPayload;
      try {
        payload = JSON.parse(result.data);
      } catch {
        throw new Error('QR code is not valid JSON — not a CodeTrellis pairing code');
      }

      // Validate v4 structure
      if (
        payload.v !== 4 ||
        !payload.h ||
        !payload.p ||
        !payload.c
      ) {
        throw new Error(
          'Invalid QR code — not a CodeTrellis v4 pairing code. ' +
          'Make sure your desktop is running the latest version.',
        );
      }

      console.log(
        `[Pair] Valid v4 QR — server=${payload.h}:${payload.p} code=${payload.c}`,
      );

      setState('connecting');

      // Start timeout
      timeoutRef.current = setTimeout(() => {
        setState('error');
        setError('Pairing timed out. Please try again.');
        webrtc.disconnect();
      }, PAIRING_TIMEOUT_MS);

      // Phase 1: HTTP exchange (works in Expo Go)
      // Phase 2: WebRTC answer creation + POST (needs dev build)
      const result2 = await webrtc.pairWithDesktop(payload);
      setPairingResult(result2);

      // Clear timeout — exchange succeeded
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Go straight to connected — the confirmation code is shown
      // for the user to enter on the desktop. WebRTC connects in
      // the background; pairing is saved based on the HTTP exchange.
      setState('connected');

    } catch (err) {
      console.error('[Pair] Error:', err);
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to connect');
      scannedRef.current = false;
    }
  };

  const handleSavePairing = async () => {
    if (!pairingResult) return;

    const deviceAlias = alias.trim() || 'Desktop';

    try {
      await upsertPairedDesktop({
        fingerprint: pairingResult.desktopFingerprint,
        alias: deviceAlias,
        sharedSecret: '',
        pairedAt: new Date().toISOString(),
        lastConnected: new Date().toISOString(),
        lastKnownAddress: pairingResult.desktopAddress,
        pushToken: null,
      });

      setTimeout(() => {
        router.back();
      }, 800);
    } catch (err) {
      console.error('[Pair] Failed to save pairing:', err);
      setError('Failed to save pairing. Please try again.');
    }
  };

  const handleManualConnect = async () => {
    const host = manualHost.trim();
    const port = parseInt(manualPort.trim(), 10);
    const code = manualCode.trim();

    if (!host || !port || !code || code.length !== 6) {
      setError('Enter the host, port, and 6-digit code from your desktop.');
      setState('error');
      return;
    }

    const payload: PairingQrPayload = { v: 4, h: host, p: port, c: code };
    console.log(`[Pair] Manual connect — ${host}:${port} code=${code}`);

    // Reuse the same flow as QR scanning
    scannedRef.current = true;
    setState('connecting');

    try {
      timeoutRef.current = setTimeout(() => {
        setState('error');
        setError('Pairing timed out. Please try again.');
        webrtc.disconnect();
      }, PAIRING_TIMEOUT_MS);

      const result2 = await webrtc.pairWithDesktop(payload);
      setPairingResult(result2);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setState('connected');
    } catch (err) {
      console.error('[Pair] Manual connect error:', err);
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to connect');
      scannedRef.current = false;
    }
  };

  const handleRetry = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    webrtc.disconnect();
    scannedRef.current = false;
    setState('scanning');
    setPairingResult(null);
    setError(null);
    setAlias('');
    setManualHost('');
    setManualPort('');
    setManualCode('');
  };

  // Camera permission not yet determined
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  // Camera permission denied — offer manual entry as alternative
  if (!permission.granted && state !== 'manual' && state !== 'connecting' && state !== 'confirming' && state !== 'connected' && state !== 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          CodeTrellis needs camera access to scan the pairing QR code from your desktop.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={requestPermission}>
          <Text style={styles.retryButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.manualEntryButton, { marginTop: 16 }]}
          onPress={() => setState('manual')}
        >
          <Text style={styles.manualEntryButtonText}>Enter code manually</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* State: Scanning */}
      {state === 'scanning' && (
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <View style={styles.overlay}>
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>
              Scan the QR code from CodeTrellis{'\n'}Settings → Devices → Pair
            </Text>
            <TouchableOpacity
              style={styles.manualEntryButton}
              onPress={() => setState('manual')}
            >
              <Text style={styles.manualEntryButtonText}>Enter code manually</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* State: Manual Entry */}
      {state === 'manual' && (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.manualContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.confirmTitle}>Enter Connection Details</Text>
          <Text style={styles.confirmSubtitle}>
            Enter the code and address shown{'\n'}on your desktop
          </Text>

          {/* 6-digit code */}
          <Text style={styles.aliasLabel}>Pairing Code</Text>
          <TextInput
            style={styles.aliasInput}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="e.g. 640428"
            placeholderTextColor="#52525b"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />

          {/* Host address */}
          <Text style={styles.aliasLabel}>Desktop Address</Text>
          <TextInput
            style={styles.aliasInput}
            value={manualHost}
            onChangeText={setManualHost}
            placeholder="e.g. 192.168.0.47"
            placeholderTextColor="#52525b"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Port */}
          <Text style={styles.aliasLabel}>Port</Text>
          <TextInput
            style={styles.aliasInput}
            value={manualPort}
            onChangeText={setManualPort}
            placeholder="e.g. 54321"
            placeholderTextColor="#52525b"
            keyboardType="number-pad"
          />

          <TouchableOpacity
            style={[
              styles.confirmButton,
              { backgroundColor: '#3b82f6', marginTop: 16 },
            ]}
            onPress={handleManualConnect}
          >
            <Text style={styles.confirmButtonText}>Connect</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.manualBackButton}
            onPress={() => setState('scanning')}
          >
            <Text style={styles.manualBackButtonText}>Back to scanner</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* State: Connecting */}
      {state === 'connecting' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.processingText}>Connecting to desktop...</Text>
          <Text style={styles.processingSubtext}>
            Exchanging encryption keys over your network
          </Text>
        </View>
      )}

      {/* State: Connected — show code for desktop entry */}
      {state === 'connected' && (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.confirmContainer}
        >
          <Text style={styles.confirmTitle}>Enter This Code on Desktop</Text>
          <Text style={styles.confirmSubtitle}>
            Type this code into CodeTrellis{'\n'}on your desktop to complete pairing
          </Text>

          {/* Confirmation code — user reads this and types on desktop */}
          {pairingResult && (
            <View style={[styles.codeContainer, { marginBottom: 24 }]}>
              {pairingResult.confirmCode.split('').map((digit, i) => (
                <View key={i} style={[styles.codeDigit, { borderColor: '#22c55e' }]}>
                  <Text style={styles.codeDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.aliasLabel}>Name this desktop</Text>
          <TextInput
            style={styles.aliasInput}
            value={alias}
            onChangeText={setAlias}
            placeholder="e.g. Work iMac"
            placeholderTextColor="#52525b"
          />

          <TouchableOpacity
            style={styles.confirmButton}
            onPress={handleSavePairing}
          >
            <Text style={styles.confirmButtonText}>Save Pairing</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* State: Error */}
      {state === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errorIcon}>{'❌'}</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },

  // Scanner
  scannerContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#3b82f6',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  scanHint: {
    color: '#e4e4e7',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 20,
  },

  // Manual entry button (on scanner overlay)
  manualEntryButton: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  manualEntryButtonText: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '500',
  },

  // Manual entry screen
  manualContainer: {
    alignItems: 'stretch',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },
  manualBackButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  manualBackButtonText: {
    color: '#71717a',
    fontSize: 13,
  },

  // Processing / connecting
  processingText: {
    color: '#a1a1aa',
    fontSize: 16,
    marginTop: 16,
  },
  processingSubtext: {
    color: '#52525b',
    fontSize: 13,
    marginTop: 4,
  },

  // Confirm screen
  confirmContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 40,
  },
  confirmTitle: {
    color: '#e4e4e7',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmSubtitle: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },

  // Confirmation code (Bluetooth-style)
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  codeDigit: {
    width: 48,
    height: 60,
    borderRadius: 10,
    backgroundColor: '#18181b',
    borderWidth: 2,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeDigitText: {
    color: '#e4e4e7',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Device alias
  aliasLabel: {
    color: '#a1a1aa',
    fontSize: 13,
    marginBottom: 8,
    alignSelf: 'stretch',
  },
  aliasInput: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#e4e4e7',
    fontSize: 16,
    alignSelf: 'stretch',
    marginBottom: 16,
  },

  // Waiting indicator
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  waitingText: {
    color: '#71717a',
    fontSize: 13,
  },

  // Connected / success
  connectedForm: {
    width: '100%',
    marginTop: 16,
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  successText: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '700',
  },
  successHint: {
    color: '#71717a',
    fontSize: 14,
    marginTop: 4,
  },
  confirmButton: {
    backgroundColor: '#22c55e',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // Error
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Permission
  permissionTitle: {
    color: '#e4e4e7',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  permissionBody: {
    color: '#71717a',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
});
