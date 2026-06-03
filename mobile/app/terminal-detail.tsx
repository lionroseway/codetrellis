/**
 * Terminal detail screen — view output and send input via RPC.
 *
 * Navigated to from the Terminals tab when tapping a terminal card.
 * Uses `terminal.read` RPC to fetch recent output and `terminal.write`
 * RPC to send input. Output is ANSI-colour parsed. A control-key bar
 * exposes the keys needed to drive a TUI / coding agent (Esc, Ctrl-C,
 * Tab, arrows, etc.). Auto-refreshes output every 2s while open.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { rpc } from '../lib/rpc';
import { parseAnsi } from '../lib/ansi';

// Control keys an agent / TUI needs. `seq` is the raw byte sequence sent
// to the PTY (no trailing newline).
const CONTROL_KEYS: { label: string; seq: string }[] = [
  { label: 'esc', seq: '\x1b' },
  { label: '^C', seq: '\x03' },
  { label: 'tab', seq: '\t' },
  { label: '⇧tab', seq: '\x1b[Z' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: '^A', seq: '\x01' }, // line start
  { label: '^E', seq: '\x05' }, // line end
  { label: '^U', seq: '\x15' }, // clear line
  { label: '^W', seq: '\x17' }, // delete word
  { label: '^K', seq: '\x0b' }, // kill to end
  { label: '^R', seq: '\x12' }, // reverse search
  { label: '^D', seq: '\x04' }, // EOF
  { label: '^L', seq: '\x0c' }, // clear screen
  { label: '^Z', seq: '\x1a' }, // suspend
  { label: '⌥←', seq: '\x1bb' }, // word back
  { label: '⌥→', seq: '\x1bf' }, // word forward
];

// The few keys shown inline; the rest live in the expandable drawer.
const PRIMARY_LABELS = new Set(['esc', '^C', 'tab', '↑', '↓', '←', '→']);
const PRIMARY_KEYS = CONTROL_KEYS.filter((k) => PRIMARY_LABELS.has(k.label));

// --- Component ---------------------------------------------------------------

export default function TerminalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string; title?: string }>();
  const insets = useSafeAreaInsets();

  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [ctrl, setCtrl] = useState(false); // sticky Ctrl modifier
  const [alt, setAlt] = useState(false);   // sticky Option/Alt modifier
  const [keysOpen, setKeysOpen] = useState(false); // full key drawer

  const scrollViewRef = useRef<ScrollView>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const errorStreakRef = useRef(0);

  // ANSI-parsed output spans (memoised — parsing 200 lines per render is wasteful).
  const spans = useMemo(() => parseAnsi(output || ''), [output]);

  // Fetch terminal output. Guards against overlapping polls, short timeout
  // so a stale terminal can't stack up 15s hangs. Depends ONLY on `id`.
  const fetchOutput = useCallback(async (isInitial = false) => {
    if (!id || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await rpc<{ output: string | null }>(
        'terminal.read',
        { id, lines: 200 },
        6000,
      );
      errorStreakRef.current = 0;
      if (result.output !== null) {
        setOutput(result.output);
        setError(null);
      }
    } catch (err: unknown) {
      errorStreakRef.current += 1;
      if (isInitial || errorStreakRef.current >= 3) {
        setError(err instanceof Error ? err.message : String(err));
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [id]);

  // Initial fetch + 2s polling — keyed on `id` only (runs once per terminal).
  useEffect(() => {
    setLoading(true);
    fetchOutput(true).finally(() => setLoading(false));

    pollingRef.current = setInterval(() => fetchOutput(false), 2000);
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    const t = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
    return () => clearTimeout(t);
  }, [output]);

  // Write raw bytes to the PTY, then refresh shortly after.
  const write = useCallback(async (data: string) => {
    if (!id) return;
    try {
      await rpc('terminal.write', { id, data }, 6000);
      setTimeout(() => fetchOutput(false), 250);
    } catch {
      // Silently ignore — user can retry
    }
  }, [id, fetchOutput]);

  const sendInput = useCallback(async () => {
    if (!inputText.trim()) return;
    setSending(true);
    try {
      await write(inputText + '\n');
      setInputText('');
    } finally {
      setSending(false);
    }
  }, [inputText, write]);

  // When Ctrl/⌥ is armed and the user types a single char into an empty
  // field, send it as a modified key sequence instead of buffering it:
  //   Ctrl+<letter> → control byte (A→\x01)   ⌥+<key> → ESC-prefixed.
  // (RN can't intercept the soft keyboard, so we transform via the empty
  // field. Modifiers only apply to the first char of an empty input.)
  const handleChangeText = useCallback((text: string) => {
    if ((ctrl || alt) && inputText === '' && text.length >= 1) {
      const ch = text[text.length - 1];
      let seq = ch;
      if (ctrl && /^[a-zA-Z@[\]\\^_]$/.test(ch)) {
        seq = String.fromCharCode(ch.toUpperCase().charCodeAt(0) & 0x1f);
      }
      if (alt) seq = '\x1b' + seq;
      write(seq);
      setCtrl(false);
      setAlt(false);
      setInputText('');
      return;
    }
    setInputText(text);
  }, [ctrl, alt, inputText, write]);

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
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setError(null);
            setLoading(true);
            fetchOutput(true).finally(() => setLoading(false));
          }}
        >
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
          {spans.length === 0 ? (
            '(no output)'
          ) : (
            spans.map((s, i) => (
              <Text
                key={i}
                style={{
                  color: s.color ?? '#d4d4d8',
                  fontWeight: s.bold ? '700' : '400',
                  opacity: s.dim ? 0.55 : 1,
                }}
              >
                {s.text}
              </Text>
            ))
          )}
        </Text>
      </ScrollView>

      {/* Bottom dock: key drawer + compact key row + input, safe-area padded */}
      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {/* Expandable full key drawer */}
        {keysOpen && (
          <View style={styles.keyDrawer}>
            <View style={styles.keyDrawerHeader}>
              <Text style={styles.keyDrawerTitle}>KEYS</Text>
              <TouchableOpacity onPress={() => setKeysOpen(false)}>
                <Text style={styles.keyDrawerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.keyGrid}>
              {CONTROL_KEYS.map((k) => (
                <TouchableOpacity
                  key={k.label}
                  style={styles.keyBtn}
                  activeOpacity={0.6}
                  onPress={() => write(k.seq)}
                >
                  <Text style={styles.keyBtnText}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Compact row: modifiers + common keys + drawer toggle */}
        <View style={styles.compactRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.keyBar}
            contentContainerStyle={styles.keyBarContent}
            keyboardShouldPersistTaps="always"
          >
            <TouchableOpacity
              style={[styles.keyBtn, styles.modBtn, ctrl && styles.modBtnActive]}
              activeOpacity={0.6}
              onPress={() => setCtrl((v) => !v)}
            >
              <Text style={[styles.keyBtnText, ctrl && styles.modBtnTextActive]}>Ctrl</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.keyBtn, styles.modBtn, alt && styles.modBtnActive]}
              activeOpacity={0.6}
              onPress={() => setAlt((v) => !v)}
            >
              <Text style={[styles.keyBtnText, alt && styles.modBtnTextActive]}>⌥</Text>
            </TouchableOpacity>
            <View style={styles.keyDivider} />
            {PRIMARY_KEYS.map((k) => (
              <TouchableOpacity
                key={k.label}
                style={styles.keyBtn}
                activeOpacity={0.6}
                onPress={() => write(k.seq)}
              >
                <Text style={styles.keyBtnText}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.moreBtn, keysOpen && styles.moreBtnActive]}
            activeOpacity={0.6}
            onPress={() => setKeysOpen((v) => !v)}
          >
            <Text style={styles.moreBtnText}>{keysOpen ? '⌄' : '⌨'}</Text>
          </TouchableOpacity>
        </View>

        {/* Input bar */}
        <View style={styles.inputBar}>
          <Text style={styles.inputPrompt}>&gt;</Text>
          <TextInput
            style={styles.inputField}
            value={inputText}
            onChangeText={handleChangeText}
            onSubmitEditing={sendInput}
            placeholder={ctrl || alt ? `${ctrl ? 'Ctrl' : ''}${ctrl && alt ? '+' : ''}${alt ? '⌥' : ''} + type a key…` : 'Type command...'}
            placeholderTextColor={ctrl || alt ? '#3b82f6' : '#52525b'}
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
      </View>
    </KeyboardAvoidingView>
  );
}

// --- Styles ------------------------------------------------------------------

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

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
  loadingText: { color: '#71717a', fontSize: 14, marginTop: 12 },
  errorIcon: { fontSize: 36, color: '#52525b', fontFamily: MONO, fontWeight: '700', marginBottom: 12 },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f620', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8, borderWidth: 1, borderColor: '#3b82f6',
  },
  retryText: { color: '#3b82f6', fontWeight: '600', fontSize: 14 },

  // Output area
  outputScroll: { flex: 1 },
  outputContent: { padding: 12, paddingBottom: 8 },
  outputText: { color: '#d4d4d8', fontSize: 12, fontFamily: MONO, lineHeight: 18 },

  // Bottom dock
  dock: {
    backgroundColor: '#18181b',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },

  // Compact key row (modifiers + common keys + drawer toggle)
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  keyBar: {
    flex: 1,
    maxHeight: 48,
  },
  keyBarContent: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
    alignItems: 'center',
  },
  moreBtn: {
    width: 44,
    height: 32,
    marginRight: 8,
    borderRadius: 7,
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBtnActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  moreBtnText: {
    color: '#d4d4d8',
    fontSize: 16,
    fontWeight: '700',
  },

  // Full key drawer
  keyDrawer: {
    backgroundColor: '#141416',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  keyDrawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  keyDrawerTitle: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  keyDrawerDone: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '600',
  },
  keyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  keyBtn: {
    minWidth: 38,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 7,
    backgroundColor: '#27272a',
    borderWidth: 1,
    borderColor: '#3f3f46',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBtnText: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: MONO,
  },
  modBtn: {
    backgroundColor: '#1e293b',
    borderColor: '#3b82f640',
  },
  modBtnActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  modBtnTextActive: {
    color: '#ffffff',
  },
  keyDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: 6,
    backgroundColor: '#3f3f46',
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  inputPrompt: {
    color: '#22c55e', fontSize: 16, fontFamily: MONO, fontWeight: '700', marginRight: 8,
  },
  inputField: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 14,
    fontFamily: MONO,
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: '#0a0a0c',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  sendBtn: {
    marginLeft: 8, backgroundColor: '#3b82f6',
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6,
  },
  sendBtnDisabled: { backgroundColor: '#27272a' },
  sendBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
});
