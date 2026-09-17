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
  /**
   * The reconnect secret, once the desktop hands it over on the control
   * channel — which it does when the user confirms the code there.
   *
   * Empty means we cannot save a usable pairing yet: without it every future
   * reconnect is refused (Phase 19, finding 1.2), and a pairing that looks
   * saved but can never reconnect is worse than one that visibly failed.
   */
  const [sharedSecret, setSharedSecret] = useState('');
  /** Stable pairing identity. Delivered with the secret, not in the QR. */
  const [pairingId, setPairingId] = useState('');
  const [secretTimedOut, setSecretTimedOut] = useState(false);
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

      // Validate v5 structure. Every field is required: the QR now carries
      // the desktop's WebRTC parameters rather than a pointer to fetch them
      // (Phase 19, finding 18), so a payload missing any of them cannot pair.
      const missing = (['hs', 'p', 'c', 'iu', 'ip', 'fp', 'cp', 'mms', 'n'] as const)
        .filter((k) => payload[k] === undefined || payload[k] === null);
      if (payload.v !== 5 || !Array.isArray(payload.hs) || payload.hs.length === 0 || missing.length > 0) {
        throw new Error(
          'This QR code is from an older version of CodeTrellis, or is not a pairing code. ' +
          'Update the desktop app and try again.',
        );
      }

      console.log(`[Pair] Valid v5 QR — ${payload.hs.length} address(es), port ${payload.p}`);

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

      // Show the code. The desktop hands over the reconnect secret once the
      // user types it there, so the save step waits on that rather than
      // completing on the HTTP exchange alone.
      setState('connected');
      awaitSecret(result2);

    } catch (err) {
      console.error('[Pair] Error:', err);
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to connect');
      scannedRef.current = false;
    }
  };

  /**
   * Wait for the desktop's confirmation to deliver the reconnect secret.
   *
   * The pairing id arrives with it, on the DTLS channel rather than in the QR
   * — one less thing to fit in a code the user has to scan.
   */
  const awaitSecret = (result: PairingResult) => {
    setSharedSecret('');
    setPairingId('');
    setSecretTimedOut(false);
    result.awaitSecret().then(({ secret, pairingId }) => {
      if (secret) {
        setSharedSecret(secret);
        setPairingId(pairingId);
      } else {
        setSecretTimedOut(true);
      }
    });
  };

  const handleSavePairing = async () => {
    if (!pairingResult) return;
    if (!sharedSecret) {
      // Belt and braces — the button is disabled without it.
      setError('Confirm the code on your desktop first.');
      return;
    }

    const deviceAlias = alias.trim() || 'Desktop';

    try {
      await upsertPairedDesktop({
        fingerprint: pairingResult.desktopFingerprint,
        pairingId,
        alias: deviceAlias,
        sharedSecret,
        pairedAt: new Date().toISOString(),
        lastConnected: new Date().toISOString(),
        lastKnownAddress: pairingResult.desktopAddress,
        // All addresses the desktop advertised (LAN + Tailscale/VPN), so a
        // pairing made on the LAN can later reconnect over a VPN without
        // re-pairing. Refreshed from the desktop snapshot on every connect.
        candidateAddresses: pairingResult.candidateAddresses,
        lastKnownPort: 19480, // Default — will be updated on reconnection via mDNS
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

    console.log(`[Pair] Manual connect — ${host}:${port}`);

    // Reuse the same flow as QR scanning
    scannedRef.current = true;
    setState('connecting');

    try {
      timeoutRef.current = setTimeout(() => {
        setState('error');
        setError('Pairing timed out. Please try again.');
        webrtc.disconnect();
      }, PAIRING_TIMEOUT_MS);

      // The manual path fetches the offer over plaintext HTTP, so it leaks
      // handshake metadata to anyone on the network in a way the QR path no
      // longer does. It exists because simulators have no camera and some
      // users cannot scan; the confirmation code still catches substitution.
      const result2 = await webrtc.pairWithDesktopManual({ host, port, code });
      setPairingResult(result2);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setState('connected');
      awaitSecret(result2);
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
    setSharedSecret('');
    setSecretTimedOut(false);
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
  if (!permission.granted && state !== 'manual' && state !== 'connecting' && state !== 'connected' && state !== 'error') {
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
          keyboardShouldPersistTaps="handled"
        >
          {/* Success indicator */}
          <View style={styles.successBadge}>
            <Text style={styles.successBadgeText}>Paired</Text>
          </View>

          <Text style={styles.confirmTitle}>Enter This Code on Desktop</Text>
          <Text style={styles.confirmSubtitle}>
            Type this code into CodeTrellis{'\n'}on your desktop to complete pairing
          </Text>

          {/* Confirmation code — user reads this and types on desktop */}
          {pairingResult && (
            <View style={styles.codeContainer}>
              {pairingResult.confirmCode.split('').map((digit, i) => (
                <View key={i} style={[styles.codeDigit, { borderColor: '#22c55e' }]}>
                  <Text style={styles.codeDigitText}>{digit}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.divider} />

          <Text style={styles.aliasLabel}>Name this desktop</Text>
          <TextInput
            style={styles.aliasInput}
            value={alias}
            onChangeText={setAlias}
            placeholder="e.g. Work iMac"
            placeholderTextColor="#52525b"
          />

          {/* The desktop sends the reconnect secret when the user confirms
              there, so waiting for it IS waiting for confirmation. Saving
              without it would store a pairing that can never reconnect. */}
          {!sharedSecret && !secretTimedOut && (
            <View style={styles.waitingRow}>
              <ActivityIndicator size="small" color="#3b82f6" />
              <Text style={styles.waitingText}>Waiting for confirmation on desktop…</Text>
            </View>
          )}
          {secretTimedOut && (
            <Text style={styles.waitingError}>
              The desktop never confirmed. Start pairing again from Settings → Devices.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.confirmButton, !sharedSecret && styles.confirmButtonDisabled]}
            onPress={handleSavePairing}
            disabled={!sharedSecret}
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
    ...StyleSheet.absoluteFill,
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

  // Success badge
  successBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 100,
    marginBottom: 20,
  },
  successBadgeText: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '600',
  },

  // Divider
  divider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#27272a',
    marginVertical: 24,
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
  confirmButtonDisabled: {
    backgroundColor: '#3f3f46',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  waitingError: {
    color: '#f87171',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
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
