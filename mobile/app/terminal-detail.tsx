/**
 * Terminal detail screen — real terminal via xterm.js (XtermView).
 *
 * Display: raw PTY output is streamed in byte-deltas (terminal.stream) and
 * written into xterm.js, which emulates the screen grid — so TUIs like
 * Claude Code render correctly (boxes, cursor, colour). The grid is fit to
 * the phone width and the PTY resized to match (terminal.resize).
 *
 * Input: the text field + control-key bar (Ctrl/⌥ modifiers, esc/^C/tab/
 * arrows + a key drawer) write raw bytes via terminal.write; the echo
 * streams back through the emulator.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { rpc } from '../lib/rpc';
import XtermView, { type XtermHandle } from '../components/XtermView';

const CONTROL_KEYS: { label: string; seq: string }[] = [
  { label: 'esc', seq: '\x1b' },
  { label: '^C', seq: '\x03' },
  { label: 'tab', seq: '\t' },
  { label: '⇧tab', seq: '\x1b[Z' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
  { label: '^A', seq: '\x01' },
  { label: '^E', seq: '\x05' },
  { label: '^U', seq: '\x15' },
  { label: '^W', seq: '\x17' },
  { label: '^K', seq: '\x0b' },
  { label: '^R', seq: '\x12' },
  { label: '^D', seq: '\x04' },
  { label: '^L', seq: '\x0c' },
  { label: '^Z', seq: '\x1a' },
  { label: '⌥←', seq: '\x1bb' },
  { label: '⌥→', seq: '\x1bf' },
];
const PRIMARY_LABELS = new Set(['esc', '^C', 'tab', '↑', '↓', '←', '→']);
const PRIMARY_KEYS = CONTROL_KEYS.filter((k) => PRIMARY_LABELS.has(k.label));

export default function TerminalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string; title?: string }>();
  const insets = useSafeAreaInsets();

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);

  const xtermRef = useRef<XtermHandle>(null);
  const sinceRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorStreakRef = useRef(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  // Pull incremental raw output and write it into the emulator.
  const pump = useCallback(async () => {
    if (!id || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const r = await rpc<{ data: string; total: number; reset: boolean }>(
        'terminal.stream',
        { id, since: sinceRef.current },
        6000,
      );
      errorStreakRef.current = 0;
      if (r.reset) xtermRef.current?.reset();
      if (r.data) xtermRef.current?.write(r.data);
      sinceRef.current = r.total;
      if (error) setError(null);
    } catch (err: unknown) {
      errorStreakRef.current += 1;
      if (errorStreakRef.current >= 3) {
        setError(err instanceof Error ? err.message : String(err));
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [id, error]);

  // Start streaming once xterm is ready (and on id change).
  useEffect(() => {
    if (!ready || !id) return;
    sinceRef.current = undefined; // force a reset+full replay first
    errorStreakRef.current = 0;
    pump();
    pollRef.current = setInterval(pump, 600);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [ready, id, pump]);

  // Write raw bytes to the PTY (echo streams back via pump).
  const write = useCallback(async (data: string) => {
    if (!id) return;
    try {
      await rpc('terminal.write', { id, data }, 20000);
      setTimeout(pump, 120);
    } catch { /* ignore */ }
  }, [id, pump]);

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

  // Sticky-modifier typing: Ctrl/⌥ + first char of an empty field.
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

  // Resize the PTY to match the emulator grid (debounced).
  const handleResize = useCallback((cols: number, rows: number) => {
    if (!id || cols < 2 || rows < 2) return;
    const last = lastSizeRef.current;
    if (last && last.cols === cols && last.rows === rows) return;
    lastSizeRef.current = { cols, rows };
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      rpc('terminal.resize', { id, cols, rows }, 20000).catch(() => {});
    }, 250);
  }, [id]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Terminal emulator */}
      <View style={styles.termWrap}>
        <XtermView
          ref={xtermRef}
          onReady={() => setReady(true)}
          onData={write}
          onResize={handleResize}
        />
        {!ready && (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator color="#3b82f6" />
            <Text style={styles.overlayText}>Starting terminal…</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
            <TouchableOpacity
              onPress={() => {
                setError(null);
                errorStreakRef.current = 0;
                if (!pollRef.current) pollRef.current = setInterval(pump, 600);
                pump();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Bottom dock: key drawer + compact key row + input */}
      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 8) }]}>
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
                <TouchableOpacity key={k.label} style={styles.keyBtn} activeOpacity={0.6} onPress={() => write(k.seq)}>
                  <Text style={styles.keyBtnText}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

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
              <TouchableOpacity key={k.label} style={styles.keyBtn} activeOpacity={0.6} onPress={() => write(k.seq)}>
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

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0c' },

  termWrap: { flex: 1, position: 'relative' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0c',
  },
  overlayText: { color: '#71717a', fontSize: 13, marginTop: 10 },
  errorBanner: {
    position: 'absolute', top: 8, left: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1c1017', borderWidth: 1, borderColor: '#ef444440',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
  },
  errorText: { color: '#f87171', fontSize: 12, flex: 1, marginRight: 8 },
  retryText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },

  // Bottom dock
  dock: { backgroundColor: '#18181b', borderTopWidth: 1, borderTopColor: '#27272a' },
  compactRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a',
  },
  keyBar: { flex: 1, maxHeight: 48 },
  keyBarContent: { paddingHorizontal: 8, paddingVertical: 8, gap: 6, alignItems: 'center' },
  keyBtn: {
    minWidth: 38, height: 32, paddingHorizontal: 10, borderRadius: 7,
    backgroundColor: '#27272a', borderWidth: 1, borderColor: '#3f3f46',
    alignItems: 'center', justifyContent: 'center',
  },
  keyBtnText: { color: '#d4d4d8', fontSize: 13, fontWeight: '600', fontFamily: MONO },
  modBtn: { backgroundColor: '#1e293b', borderColor: '#3b82f640' },
  modBtnActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  modBtnTextActive: { color: '#ffffff' },
  keyDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 6, backgroundColor: '#3f3f46' },
  moreBtn: {
    width: 44, height: 32, marginRight: 8, borderRadius: 7,
    backgroundColor: '#27272a', borderWidth: 1, borderColor: '#3f3f46',
    alignItems: 'center', justifyContent: 'center',
  },
  moreBtnActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  moreBtnText: { color: '#d4d4d8', fontSize: 16, fontWeight: '700' },
  keyDrawer: {
    backgroundColor: '#141416',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a',
    paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10,
  },
  keyDrawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8, paddingHorizontal: 2,
  },
  keyDrawerTitle: { color: '#71717a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  keyDrawerDone: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  inputBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  inputPrompt: { color: '#22c55e', fontSize: 16, fontFamily: MONO, fontWeight: '700', marginRight: 8 },
  inputField: {
    flex: 1, color: '#e4e4e7', fontSize: 14, fontFamily: MONO,
    paddingVertical: 8, paddingHorizontal: 8, backgroundColor: '#0a0a0c',
    borderRadius: 6, borderWidth: 1, borderColor: '#27272a',
  },
  sendBtn: { marginLeft: 8, backgroundColor: '#3b82f6', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  sendBtnDisabled: { backgroundColor: '#27272a' },
  sendBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
});
