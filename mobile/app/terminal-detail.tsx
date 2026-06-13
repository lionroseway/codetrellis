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
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { rpc } from '../lib/rpc';
import { connection } from '../lib/connection';
import {
  getTerminalFontPx,
  setTerminalFontPx,
  TERMINAL_FONT_MIN_PX,
  TERMINAL_FONT_MAX_PX,
} from '../lib/prefs';
import XtermView, { type XtermHandle } from '../components/XtermView';

// Plan item 10.2 — haptics on key tap. Loaded defensively because the
// module isn't part of the EAS dev profile until it's added to package.json
// AND rebuilt; this lets the code run today without the native module.
let haptics: { impactAsync?: (s: number) => void; ImpactFeedbackStyle?: { Light: number } } = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  haptics = require('expo-haptics');
} catch { /* fine — silent no-op until next build */ }
function tapHaptic(): void {
  try {
    const style = haptics.ImpactFeedbackStyle?.Light;
    if (style !== undefined && typeof haptics.impactAsync === 'function') {
      haptics.impactAsync(style);
    }
  } catch { /* */ }
}

// Plan items 10.1 + 10.2 — full modifier + special-key surface, grouped
// semantically. Each group renders its own drawer row so the layout is
// scannable instead of an undifferentiated grid.
interface KeyDef { label: string; seq: string }
interface KeyGroup { name: string; keys: KeyDef[] }

const KEY_GROUPS: KeyGroup[] = [
  {
    name: 'navigation',
    keys: [
      { label: '↑',    seq: '\x1b[A' },
      { label: '↓',    seq: '\x1b[B' },
      { label: '←',    seq: '\x1b[D' },
      { label: '→',    seq: '\x1b[C' },
      { label: 'Home', seq: '\x1bOH' },
      { label: 'End',  seq: '\x1bOF' },
      { label: 'PgUp', seq: '\x1b[5~' },
      { label: 'PgDn', seq: '\x1b[6~' },
    ],
  },
  {
    name: 'editing',
    keys: [
      { label: 'esc',  seq: '\x1b' },
      { label: 'tab',  seq: '\t' },
      { label: '⇧tab', seq: '\x1b[Z' },
      { label: '⏎',    seq: '\r' },
      { label: 'del→', seq: '\x1b[3~' },
      { label: 'ins',  seq: '\x1b[2~' },
      { label: '⌥←',   seq: '\x1bb' },
      { label: '⌥→',   seq: '\x1bf' },
    ],
  },
  {
    name: 'control',
    keys: [
      { label: '^C', seq: '\x03' }, { label: '^D', seq: '\x04' },
      { label: '^A', seq: '\x01' }, { label: '^E', seq: '\x05' },
      { label: '^U', seq: '\x15' }, { label: '^W', seq: '\x17' },
      { label: '^K', seq: '\x0b' }, { label: '^L', seq: '\x0c' },
      { label: '^R', seq: '\x12' }, { label: '^Z', seq: '\x1a' },
    ],
  },
  {
    name: 'function',
    keys: [
      { label: 'F1',  seq: '\x1bOP' },        { label: 'F2',  seq: '\x1bOQ' },
      { label: 'F3',  seq: '\x1bOR' },        { label: 'F4',  seq: '\x1bOS' },
      { label: 'F5',  seq: '\x1b[15~' },      { label: 'F6',  seq: '\x1b[17~' },
      { label: 'F7',  seq: '\x1b[18~' },      { label: 'F8',  seq: '\x1b[19~' },
      { label: 'F9',  seq: '\x1b[20~' },      { label: 'F10', seq: '\x1b[21~' },
      { label: 'F11', seq: '\x1b[23~' },      { label: 'F12', seq: '\x1b[24~' },
    ],
  },
];

// Flattened lookup for the compact bottom row.
const ALL_KEYS: KeyDef[] = KEY_GROUPS.flatMap((g) => g.keys);
const PRIMARY_LABELS = new Set(['esc', '^C', 'tab', '⏎', '↑', '↓', '←', '→']);
const PRIMARY_KEYS = ALL_KEYS.filter((k) => PRIMARY_LABELS.has(k.label));

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
  // Plan item 10.5 — terminal font size. Hydrated from prefs at mount,
  // applied to the WebView once xterm is ready, persisted on change.
  const [fontPx, setFontPx] = useState<number>(getTerminalFontPx());

  const xtermRef = useRef<XtermHandle>(null);
  const sinceRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorStreakRef = useRef(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  // Pull incremental raw output and write it into the emulator.
  // No explicit timeout — inherits the user-configurable default
  // (`getRpcTimeoutMs`, 30s). Previously hardcoded to 6s, which made
  // cold cellular / VPN / post-foreground RPCs falsely time out.
  const pump = useCallback(async () => {
    if (!id || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const r = await rpc<{ data: string; total: number; reset: boolean }>(
        'terminal.stream',
        { id, since: sinceRef.current },
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

  // (Re)start the stream from a clean state — used by mount, the
  // connection-state-change effect, and the Retry button. Resetting
  // `sinceRef` to undefined forces the server to send `reset: true` +
  // the full snapshot so the xterm view rehydrates cleanly.
  const restartStream = useCallback(() => {
    setError(null);
    errorStreakRef.current = 0;
    sinceRef.current = undefined;
    if (!pollRef.current) pollRef.current = setInterval(pump, 600);
    pump();
  }, [pump]);

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

  // Auto-restart on reconnect. The mount-effect above clears the
  // poll after 3 RPC errors (e.g., when the WebRTC transport went
  // stale during backgrounding); without this, the user had to tap
  // Retry. Subscribing to `connection.onStateChange` lets the screen
  // self-heal: on the next `'connected'`, restart polling, reset the
  // cursor to force a snapshot replay, clear the error banner.
  // ConnectionManager only ever emits 'connecting'|'connected'|
  // 'disconnected'|'failed' — 'reconnecting' is in the type but
  // unused. Trigger is 'connected'.
  useEffect(() => {
    if (!ready || !id) return;
    const unsub = connection.onStateChange((state) => {
      if (state === 'connected') restartStream();
    });
    return unsub;
  }, [ready, id, restartStream]);

  // Re-pump when the screen regains focus. Plan item 5.6 — covers the
  // "navigated away, came back, terminal is blank" case. The mount
  // effect alone doesn't fire when the screen is *re-focused* (only
  // re-mounted); `useFocusEffect` does. Triggers an immediate pump so
  // the user doesn't wait up to 600ms for the next poll tick. We
  // don't reset the cursor here — that's reserved for the
  // reconnect-after-error path (`restartStream`).
  useFocusEffect(
    useCallback(() => {
      if (ready && id) pump();
      return () => { /* no teardown on blur */ };
    }, [ready, id, pump]),
  );

  // Plan item 10.5 — apply persisted font size when xterm becomes
  // ready. Subsequent +/- presses call setFontSize directly.
  useEffect(() => {
    if (!ready) return;
    xtermRef.current?.setFontSize(fontPx);
  }, [ready, fontPx]);

  const bumpFont = useCallback((delta: number) => {
    setFontPx((prev) => {
      const next = Math.max(TERMINAL_FONT_MIN_PX, Math.min(TERMINAL_FONT_MAX_PX, prev + delta));
      if (next === prev) return prev;
      setTerminalFontPx(next).catch(() => { /* best-effort */ });
      tapHaptic();
      return next;
    });
  }, []);

  // Plan item 10.2 — haptic on every key tap. Wraps `write` so the
  // existing CONTROL_KEYS rendering doesn't need per-key changes.
  const tapKey = useCallback((seq: string) => {
    tapHaptic();
    write(seq);
  }, [write]);

  // Write raw bytes to the PTY (echo streams back via pump).
  const write = useCallback(async (data: string) => {
    if (!id) return;
    try {
      // No explicit timeout — inherits the user-configurable default.
      await rpc('terminal.write', { id, data });
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
      rpc('terminal.resize', { id, cols, rows }).catch(() => {});
    }, 250);
  }, [id]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      {/* Terminal emulator */}
      <View
        style={styles.termWrap}
        // Plan item 5.6 — when the container resizes (keyboard drawer
        // toggle, orientation flip, KeyboardAvoidingView padding
        // change), tell xterm to re-fit its grid to the new
        // dimensions. The WebView's internal layout observer is
        // unreliable on some RN versions; this is the defensive belt
        // that keeps the terminal visible after any layout shift.
        onLayout={() => { if (ready) xtermRef.current?.fit(); }}
      >
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
            <TouchableOpacity onPress={restartStream}>
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
              {/* Plan item 10.5 — font size +/- */}
              <View style={styles.fontControls}>
                <TouchableOpacity style={styles.fontBtn} onPress={() => bumpFont(-1)} hitSlop={6}>
                  <Text style={styles.fontBtnText}>A−</Text>
                </TouchableOpacity>
                <Text style={styles.fontValue}>{fontPx}px</Text>
                <TouchableOpacity style={styles.fontBtn} onPress={() => bumpFont(+1)} hitSlop={6}>
                  <Text style={styles.fontBtnText}>A+</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setKeysOpen(false)}>
                <Text style={styles.keyDrawerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            {KEY_GROUPS.map((group) => (
              <View key={group.name} style={styles.keyGroup}>
                <Text style={styles.keyGroupLabel}>{group.name}</Text>
                <View style={styles.keyGroupRow}>
                  {group.keys.map((k) => (
                    <TouchableOpacity
                      key={k.label}
                      style={styles.keyBtn}
                      activeOpacity={0.6}
                      onPress={() => tapKey(k.seq)}
                    >
                      <Text style={styles.keyBtnText}>{k.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
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
              <TouchableOpacity key={k.label} style={styles.keyBtn} activeOpacity={0.6} onPress={() => tapKey(k.seq)}>
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
    minWidth: 44, height: 38, paddingHorizontal: 10, borderRadius: 7,
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
  // Plan items 10.1 + 10.2 — semantic key groups with labels.
  keyGroup: { marginTop: 6 },
  keyGroupLabel: {
    color: '#52525b', fontSize: 9, fontWeight: '700', letterSpacing: 1.2,
    textTransform: 'uppercase', marginLeft: 4, marginBottom: 4,
  },
  keyGroupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // Plan item 10.5 — font size +/- inline in the drawer header.
  fontControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fontBtn: {
    paddingHorizontal: 10, height: 28, borderRadius: 6,
    backgroundColor: '#27272a', borderWidth: 1, borderColor: '#3f3f46',
    alignItems: 'center', justifyContent: 'center',
  },
  fontBtnText: { color: '#d4d4d8', fontSize: 12, fontWeight: '700', fontFamily: MONO },
  fontValue: { color: '#71717a', fontSize: 11, minWidth: 30, textAlign: 'center', fontFamily: MONO },

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
