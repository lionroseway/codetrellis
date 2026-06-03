/**
 * Input request detail screen — respond to agent await_user_input prompts.
 *
 * When an AI agent calls `await_user_input`, the desktop broadcasts
 * the prompt to mobile. This screen shows the full prompt, optional
 * pre-defined choices, and a free-text input. The response is sent
 * back via the `input.respond` RPC method — first response wins.
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { rpc } from '../lib/rpc';
import { usePendingInputRequests } from '../lib/store';

export default function InputRequestScreen() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const router = useRouter();
  const pendingInputs = usePendingInputRequests();

  // Find the request from the store (live-updating via snapshot)
  const request = pendingInputs.find((r) => r.requestId === requestId);

  const [customResponse, setCustomResponse] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const sendResponse = useCallback(
    async (response: string) => {
      if (!requestId || sending) return;
      setSending(true);
      try {
        await rpc('input.respond', { requestId, response });
        setSent(true);
        // Brief delay to show the success state
        setTimeout(() => router.back(), 600);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert('Failed to send response', msg);
      } finally {
        setSending(false);
      }
    },
    [requestId, sending, router],
  );

  const handleOptionPress = useCallback(
    (option: string) => {
      sendResponse(option);
    },
    [sendResponse],
  );

  const handleCustomSend = useCallback(() => {
    if (!customResponse.trim()) return;
    sendResponse(customResponse.trim());
  }, [customResponse, sendResponse]);

  // Success state
  if (sent) {
    return (
      <View style={styles.center}>
        <View style={styles.successCircle}>
          <Text style={styles.successCheck}>OK</Text>
        </View>
        <Text style={styles.successText}>Response sent</Text>
      </View>
    );
  }

  // Request not found (may have been answered already or expired)
  if (!request) {
    return (
      <View style={styles.center}>
        <Text style={styles.goneIcon}>?</Text>
        <Text style={styles.goneTitle}>Request not found</Text>
        <Text style={styles.goneBody}>
          This input request may have already been answered or expired.
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const hasOptions = request.options && request.options.length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Agent prompt header */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.agentBadge}>
              <View style={styles.agentDot} />
              <Text style={styles.agentBadgeText}>Agent Input Request</Text>
            </View>
            <Text style={styles.headerTime}>{formatAge(request.receivedAt)}</Text>
          </View>

          {request.planUid && (
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Plan:</Text>
              <Text style={styles.contextValue}>{request.planUid}</Text>
            </View>
          )}
        </View>

        {/* Prompt */}
        <View style={styles.promptCard}>
          <Text style={styles.promptLabel}>PROMPT</Text>
          <Text style={styles.promptText} selectable>
            {request.prompt}
          </Text>
        </View>

        {/* Pre-defined options */}
        {hasOptions && (
          <View style={styles.optionsSection}>
            <Text style={styles.sectionLabel}>CHOICES</Text>
            {request.options!.map((option, idx) => (
              <TouchableOpacity
                key={`${option}-${idx}`}
                style={styles.optionCard}
                activeOpacity={0.7}
                disabled={sending}
                onPress={() => handleOptionPress(option)}
              >
                <View style={styles.optionNumber}>
                  <Text style={styles.optionNumberText}>{idx + 1}</Text>
                </View>
                <Text style={styles.optionText}>{option}</Text>
                {sending && (
                  <ActivityIndicator
                    size="small"
                    color="#3b82f6"
                    style={styles.optionSpinner}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Divider if both options and free-text */}
        {hasOptions && (
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or type a custom response</Text>
            <View style={styles.dividerLine} />
          </View>
        )}
      </ScrollView>

      {/* Free-text input */}
      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={customResponse}
          onChangeText={setCustomResponse}
          placeholder={hasOptions ? 'Custom response...' : 'Type your response...'}
          placeholderTextColor="#52525b"
          multiline
          maxLength={4000}
          editable={!sending}
          autoFocus={!hasOptions}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!customResponse.trim() || sending) && styles.sendBtnDisabled,
          ]}
          onPress={handleCustomSend}
          disabled={!customResponse.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function formatAge(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 16,
  },
  center: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },

  // Success state
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#22c55e20',
    borderWidth: 2,
    borderColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successCheck: {
    color: '#22c55e',
    fontSize: 20,
    fontWeight: '700',
  },
  successText: {
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '600',
  },

  // Gone state (request not found)
  goneIcon: {
    fontSize: 48,
    color: '#52525b',
    fontWeight: '700',
    marginBottom: 12,
  },
  goneTitle: {
    color: '#a1a1aa',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  goneBody: {
    color: '#71717a',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  backBtn: {
    backgroundColor: '#27272a',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: {
    color: '#d4d4d8',
    fontSize: 14,
    fontWeight: '600',
  },

  // Header card
  headerCard: {
    backgroundColor: '#18181b',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3b82f630',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3b82f615',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 6,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
  agentBadgeText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
  },
  headerTime: {
    color: '#52525b',
    fontSize: 11,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  contextLabel: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '500',
  },
  contextValue: {
    color: '#a1a1aa',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Prompt card
  promptCard: {
    backgroundColor: '#141416',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1f1f23',
  },
  promptLabel: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  promptText: {
    color: '#e4e4e7',
    fontSize: 15,
    lineHeight: 23,
  },

  // Options
  optionsSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  optionNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3b82f620',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  optionNumberText: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '700',
  },
  optionText: {
    color: '#e4e4e7',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  optionSpinner: {
    marginLeft: 8,
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#27272a',
  },
  dividerText: {
    color: '#52525b',
    fontSize: 11,
    fontWeight: '500',
  },

  // Input area
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    backgroundColor: '#111113',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 28,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#e4e4e7',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#27272a',
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
