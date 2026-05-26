/**
 * Pair screen — QR code scanner for pairing with a desktop.
 *
 * Flow:
 *   1. Camera opens → scan QR code from desktop's Settings → Devices.
 *   2. Parse QR payload (WebRTC offer + ICE candidates + nonce).
 *   3. Create WebRTC answer.
 *   4. Send answer back to desktop (ephemeral UDP).
 *   5. Display 6-digit confirmation code.
 *   6. User verifies code matches desktop → tap "Confirm".
 *   7. WebRTC handshake completes → paired device stored.
 */

import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { webrtc } from '../lib/webrtc';
import { upsertPairedDesktop } from '../lib/storage';
import type { PairingQrPayload, PairingAnswer } from '../lib/types';

type PairingState =
  | 'scanning'
  | 'processing'
  | 'confirming'
  | 'sending'
  | 'success'
  | 'error';

export default function PairScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<PairingState>('scanning');
  const [answer, setAnswer] = useState<PairingAnswer | null>(null);
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<PairingQrPayload | null>(null);
  const scannedRef = useRef(false);

  // Request camera permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;

    try {
      setState('processing');

      // Parse the QR payload
      const payload: PairingQrPayload = JSON.parse(data);

      // Validate structure
      if (payload.v !== 1 || !payload.nonce || !payload.offer || !payload.fp) {
        throw new Error('Invalid QR code — not a CodeTrellis pairing code');
      }

      setQrPayload(payload);

      // Create WebRTC answer
      const pairingAnswer = await webrtc.createAnswerFromOffer(payload);
      setAnswer(pairingAnswer);

      setState('confirming');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Failed to process QR code');
      scannedRef.current = false;
    }
  };

  const handleConfirm = async () => {
    if (!answer || !qrPayload) return;

    const deviceAlias = alias.trim() || 'Desktop';

    try {
      setState('sending');

      // Send the answer back to the desktop via ephemeral UDP
      // In React Native, we can't do raw UDP easily, so we use
      // a manual-paste fallback flow. The answer is encoded and
      // the user can also enter it manually on the desktop.
      //
      // For now, we attempt to complete the WebRTC connection
      // directly (which works if ICE candidates resolve).
      await webrtc.connect();

      // Store the paired device
      await upsertPairedDesktop({
        fingerprint: qrPayload.fp,
        alias: deviceAlias,
        sharedSecret: '', // TODO: extract from DTLS handshake
        pairedAt: new Date().toISOString(),
        lastConnected: new Date().toISOString(),
        lastKnownAddress: qrPayload.addr,
        pushToken: null,
      });

      setState('success');

      // Navigate back after a brief pause
      setTimeout(() => {
        router.back();
      }, 1500);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Pairing failed');
    }
  };

  const handleRetry = () => {
    scannedRef.current = false;
    setState('scanning');
    setAnswer(null);
    setError(null);
    setQrPayload(null);
  };

  // Camera permission not yet determined
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  // Camera permission denied
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionBody}>
          CodeTrellis needs camera access to scan the pairing QR code from your desktop.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={requestPermission}>
          <Text style={styles.retryButtonText}>Grant Permission</Text>
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
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarCodeScanned}
          />
          <View style={styles.overlay}>
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>
              Scan the QR code from CodeTrellis{'\n'}Settings → Devices → Pair
            </Text>
          </View>
        </View>
      )}

      {/* State: Processing */}
      {state === 'processing' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.processingText}>Creating secure connection...</Text>
        </View>
      )}

      {/* State: Confirming — show code and alias input */}
      {state === 'confirming' && answer && (
        <View style={styles.confirmContainer}>
          <Text style={styles.confirmTitle}>Verify Connection</Text>

          <Text style={styles.codeLabel}>Confirmation Code</Text>
          <View style={styles.codeContainer}>
            {answer.code.split('').map((digit, i) => (
              <View key={i} style={styles.codeDigit}>
                <Text style={styles.codeDigitText}>{digit}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.codeHint}>
            This code should match the one shown on your desktop
          </Text>

          <Text style={styles.aliasLabel}>Device Name</Text>
          <TextInput
            style={styles.aliasInput}
            value={alias}
            onChangeText={setAlias}
            placeholder="e.g. Work iMac"
            placeholderTextColor="#52525b"
            autoFocus
          />

          <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
            <Text style={styles.confirmButtonText}>Confirm Pairing</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* State: Sending */}
      {state === 'sending' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.processingText}>Completing pairing...</Text>
        </View>
      )}

      {/* State: Success */}
      {state === 'success' && (
        <View style={styles.center}>
          <Text style={styles.successIcon}>{'✅'}</Text>
          <Text style={styles.successText}>Paired Successfully!</Text>
          <Text style={styles.successHint}>Returning to device list...</Text>
        </View>
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
  processingText: {
    color: '#a1a1aa',
    fontSize: 16,
    marginTop: 16,
  },
  confirmContainer: {
    flex: 1,
    padding: 32,
    paddingTop: 48,
  },
  confirmTitle: {
    color: '#e4e4e7',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 32,
    textAlign: 'center',
  },
  codeLabel: {
    color: '#a1a1aa',
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  codeDigit: {
    width: 44,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeDigitText: {
    color: '#e4e4e7',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  codeHint: {
    color: '#71717a',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 32,
  },
  aliasLabel: {
    color: '#a1a1aa',
    fontSize: 13,
    marginBottom: 8,
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
    marginBottom: 24,
  },
  confirmButton: {
    backgroundColor: '#22c55e',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
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
    marginTop: 8,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
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
