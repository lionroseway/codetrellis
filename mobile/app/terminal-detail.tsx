/**
 * Terminal detail screen — view output and send input via RPC.
 *
 * Navigated to from the Terminals tab when tapping a terminal card.
 * Uses `terminal.read` RPC to fetch recent output and
 * `terminal.write` RPC to send input to the terminal.
 *
 * Auto-refreshes output every 2 seconds while the screen is open.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { rpc } from '../lib/rpc';

// --- Component ---------------------------------------------------------------

export default function TerminalDetailScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();

  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch terminal output
  const fetchOutput = useCallback(async () => {
    if (!id) return;
    try {
      const result = await rpc<{ output: string | null }>('terminal.read', {
        id,
        lines: 200,
      });
      if (result.output !== null) {
        setOutput(result.output);
        setError(null);
      }
    } catch (err: unknown) {
      if (loading) {
        setError(err instanceof Error ? err.message : String(err));
      }
      // During polling, silently ignore errors
    }
  }, [id, loading]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchOutput().finally(() => setLoading(false));
  }, [fetchOutput]);

  // Poll for new output every 2s
  useEffect(() => {
    pollingRef.current = setInterval(fetchOutput, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchOutput]);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: false });
    }, 100);
  }, [output]);

  // Send input
  const sendInput = useCallback(async () => {
    if (!id || !inputText.trim()) return;
    setSending(true);
    try {
      await rpc('terminal.write', { id, data: inputText + '\n' });
      setInputText('');
      // Immediately fetch to show the effect
      setTimeout(fetchOutput, 300);
    } catch {
      // Silently ignore — user can retry
    } finally {
      setSending(false);
    }
  }, [id, inputText, fetchOutput]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" size="large" />
        <Text style={styles.loadingText}>Connecting to terminal...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>&gt;_</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchOutput}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Terminal output */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.outputScroll}
        contentContainerStyle={styles.outputContent}
      >
        <Text style={styles.outputText} selectable>
          {output || '(no output)'}
        </Text>
      </ScrollView>

      {/* Input bar */}
      <View style={styles.inputBar}>
        <Text style={styles.inputPrompt}>&gt;</Text>
        <TextInput
          style={styles.inputField}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={sendInput}
          placeholder="Type command..."
          placeholderTextColor="#52525b"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="send"
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendInput}
          disabled={!inputText.trim() || sending}
        >
          <Text style={styles.sendBtnText}>{sending ? '...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0c',
  },
  center: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#71717a',
    fontSize: 14,
    marginTop: 12,
  },
  errorIcon: {
    fontSize: 36,
    color: '#52525b',
    fontFamily: 'Menlo',
    fontWeight: '700',
    marginBottom: 12,
  },
  errorText: {
    color: '#a1a1aa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#3b82f620',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  retryText: {
    color: '#3b82f6',
    fontWeight: '600',
    fontSize: 14,
  },

  // Output area
  outputScroll: {
    flex: 1,
  },
  outputContent: {
    padding: 12,
    paddingBottom: 8,
  },
  outputText: {
    color: '#d4d4d8',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inputPrompt: {
    color: '#22c55e',
    fontSize: 16,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '700',
    marginRight: 8,
  },
  inputField: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#0a0a0c',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  sendBtnDisabled: {
    backgroundColor: '#27272a',
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
