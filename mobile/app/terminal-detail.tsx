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

// --- Sticky modifier keys ----------------------------------------------------
// Four modifiers, each a 3-state toggle: off → armed (one-shot) → locked
// (sticky) → off. `armed` clears after the next key; `locked` persists so you
// can fire several shortcuts. They combine freely: ⌃⇧→, ⌃⌥c, etc.
//
// ⌘ has no native meaning to a PTY, so we map it to Meta (the same ESC-prefix /
// modifier bit a Mac terminal sends for ⌘), which is the closest real behaviour.
type ModState = 'off' | 'armed' | 'locked';
type ModKey = 'ctrl' | 'alt' | 'shift' | 'meta';
type Mods = Record<ModKey, ModState>;
const MOD_OFF: Mods = { ctrl: 'off', alt: 'off', shift: 'off', meta: 'off' };

interface ModFlags { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
const flagsOf = (m: Mods): ModFlags => ({
  ctrl: m.ctrl !== 'off', alt: m.alt !== 'off', shift: m.shift !== 'off', meta: m.meta !== 'off',
});
const anyArmed = (m: Mods): boolean =>
  m.ctrl !== 'off' || m.alt !== 'off' || m.shift !== 'off' || m.meta !== 'off';

const MOD_BUTTONS: { key: ModKey; symbol: string; name: string }[] = [
  { key: 'ctrl',  symbol: '⌃', name: 'ctrl' },
  { key: 'alt',   symbol: '⌥', name: 'opt' },
  { key: 'shift', symbol: '⇧', name: 'shift' },
  { key: 'meta',  symbol: '⌘', name: 'cmd' },
];

// xterm modifier parameter: 1 + Shift(1) + Alt(2) + Ctrl(4) + Meta(8).
function modParam(f: ModFlags): number {
  return 1 + (f.shift ? 1 : 0) + (f.alt ? 2 : 0) + (f.ctrl ? 4 : 0) + (f.meta ? 8 : 0);
}

/** Encode a plain typed character under the active modifiers. */
function encodeChar(ch: string, f: ModFlags): string {
  let c = f.shift ? ch.toUpperCase() : ch;
  if (f.ctrl && /^[A-Za-z@[\]\\^_ ]$/.test(c)) {
    c = String.fromCharCode(c.toUpperCase().charCodeAt(0) & 0x1f);
  }
  if (f.alt || f.meta) c = '\x1b' + c; // Meta/Alt (incl. ⌘→Meta) → ESC prefix
  return c;
}

/**
 * Encode a special-key sequence under the active modifiers using the standard
 * xterm CSI modifier forms — `\x1b[1;PA` for arrows/Home/End, `\x1b[N;P~` for
 * tilde keys (Del/PgUp/…). Keys with no CSI form (esc/tab/⏎) just take an ESC
 * prefix under Meta/Alt.
 */
function encodeSpecial(seq: string, f: ModFlags): string {
  const p = modParam(f);
  if (p === 1) return seq;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-control-regex
  if ((m = /^\x1b\[([0-9]+)~$/.exec(seq))) return `\x1b[${m[1]};${p}~`;
  // eslint-disable-next-line no-control-regex
  if ((m = /^\x1b\[([A-Z])$/.exec(seq))) return `\x1b[1;${p}${m[1]}`;
  // eslint-disable-next-line no-control-regex
  if ((m = /^\x1bO([A-Z])$/.exec(seq))) return `\x1b[1;${p}${m[1]}`;
  return (f.alt || f.meta) ? '\x1b' + seq : seq;
}

export default function TerminalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string; title?: string }>();
  const insets = useSafeAreaInsets();

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [mods, setMods] = useState<Mods>(MOD_OFF);
  const [keysOpen, setKeysOpen] = useState(false);
  // Plan item 10.5 — terminal font size. Hydrated from prefs at mount,
  // applied to the WebView once xterm is ready, persisted on change.
  const [fontPx, setFontPx] = useState<number>(getTerminalFontPx());

  // Plan items 7.5/7.6 — persistent history overlay. The on-disk log
  // can hold hours of output that the in-memory ring (256KB) lost.
  // Tap the history button → fetch the tail of the log → "Load older"
  // walks backwards in 64KB chunks. Closes back to the live xterm.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyText, setHistoryText] = useState(''); // raw text, oldest-at-top
  const [historyOffset, setHistoryOffset] = useState<number | undefined>(undefined);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFileSize, setHistoryFileSize] = useState<number | null>(null);

  const loadHistoryChunk = useCallback(async (before: number | undefined) => {
    if (!id) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const r = await rpc<{ data: string; prevOffset: number; hasMore: boolean; fileSize: number; capped: boolean }>(
        'terminal.history',
        { id, ...(before !== undefined ? { before } : {}) },
      );
      // Strip ANSI escapes for readability — the overlay is a plain
      // text view, not an xterm grid. Keep newlines + tabs.
      const ansi = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\].*?\x07|\x1b[()][A-Z0-9]/g;
      // eslint-disable-next-line no-control-regex
      const ctrlChars = /[\x00-\x09\x0b\x0c\x0e-\x1f]/g;
      const clean = r.data.replace(ansi, '').replace(ctrlChars, '');
      // Prepend (oldest chunk goes at the top so combined text is in order).
      setHistoryText((prev) => clean + prev);
      setHistoryOffset(r.prevOffset);
      setHistoryHasMore(r.hasMore);
      setHistoryFileSize(r.fileSize);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [id]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    // Reset and load the tail chunk on each open so the user always
    // sees the most-recent history first.
    setHistoryText('');
    setHistoryOffset(undefined);
    setHistoryHasMore(true);
    setHistoryError(null);
    loadHistoryChunk(undefined);
  }, [loadHistoryChunk]);

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

  // Write raw bytes to the PTY (echo streams back via pump).
  const write = useCallback(async (data: string) => {
    if (!id) return;
    try {
      // No explicit timeout — inherits the user-configurable default.
      await rpc('terminal.write', { id, data });
      setTimeout(pump, 120);
    } catch { /* ignore */ }
  }, [id, pump]);

  // Cycle a modifier off → armed → locked → off, and clear the one-shot
  // (`armed`) modifiers after a key fires (keeping any `locked` ones).
  const cycleMod = useCallback((k: ModKey) => {
    tapHaptic();
    setMods((m) => ({ ...m, [k]: m[k] === 'off' ? 'armed' : m[k] === 'armed' ? 'locked' : 'off' }));
  }, []);
  const clearArmed = useCallback(() => {
    setMods((m) => ({
      ctrl: m.ctrl === 'armed' ? 'off' : m.ctrl,
      alt: m.alt === 'armed' ? 'off' : m.alt,
      shift: m.shift === 'armed' ? 'off' : m.shift,
      meta: m.meta === 'armed' ? 'off' : m.meta,
    }));
  }, []);

  // Plan item 10.2 — haptic on every key tap. Special keys now fold in any
  // active modifiers (⌃→, ⇧Tab, ⌥End…) via the xterm CSI encoding.
  const tapKey = useCallback((seq: string) => {
    tapHaptic();
    write(encodeSpecial(seq, flagsOf(mods)));
    if (anyArmed(mods)) clearArmed();
  }, [mods, write, clearArmed]);

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

  // Sticky-modifier typing: when ⌃/⌥/⌘ is active, the next character from the
  // keyboard becomes a key event (e.g. ⌃ + c → 0x03) instead of literal text.
  // ⇧ alone doesn't intercept (the soft keyboard already does case); it only
  // modifies a combo or a special key.
  const handleChangeText = useCallback((text: string) => {
    const f = flagsOf(mods);
    if ((f.ctrl || f.alt || f.meta) && inputText === '' && text.length >= 1) {
      const ch = text[text.length - 1];
      write(encodeChar(ch, f));
      clearArmed();
      setInputText('');
      return;
    }
    setInputText(text);
  }, [mods, inputText, write, clearArmed]);

  // Symbols of the currently-active modifiers, for the input hint.
  const activeModSymbols = MOD_BUTTONS.filter((b) => mods[b.key] !== 'off').map((b) => b.symbol).join('');

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
        {/* Plan items 7.5/7.6 — full-history overlay. Sits over the
            xterm view; tapping Done restores the live terminal. */}
        {historyOpen && (
          <View style={styles.historyOverlay}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>HISTORY</Text>
              <Text style={styles.historyMeta}>
                {historyFileSize != null
                  ? `${(historyFileSize / 1024).toFixed(0)} KB on disk`
                  : ''}
              </Text>
              <TouchableOpacity onPress={() => setHistoryOpen(false)}>
                <Text style={styles.keyDrawerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.historyScroll}
              contentContainerStyle={styles.historyScrollContent}
            >
              {historyHasMore && (
                <TouchableOpacity
                  style={styles.historyLoadMore}
                  onPress={() => loadHistoryChunk(historyOffset)}
                  disabled={historyLoading}
                >
                  <Text style={styles.historyLoadMoreText}>
                    {historyLoading ? 'Loading…' : 'Load older'}
                  </Text>
                </TouchableOpacity>
              )}
              {historyError && (
                <Text style={styles.historyErrorText}>{historyError}</Text>
              )}
              <Text style={styles.historyBody} selectable>
                {historyText || (historyLoading ? '' : '(no history yet)')}
              </Text>
            </ScrollView>
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
            {/* Sticky modifiers — tap to arm (one-shot), tap again to lock. */}
            <View style={styles.keyGroup}>
              <Text style={styles.keyGroupLabel}>modifiers · tap to arm, again to lock</Text>
              <View style={styles.keyGroupRow}>
                <ModKeyRow mods={mods} onCycle={cycleMod} />
              </View>
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
            <ModKeyRow mods={mods} onCycle={cycleMod} />
            <View style={styles.keyDivider} />
            {PRIMARY_KEYS.map((k) => (
              <TouchableOpacity key={k.label} style={styles.keyBtn} activeOpacity={0.6} onPress={() => tapKey(k.seq)}>
                <Text style={styles.keyBtnText}>{k.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {/* Plan items 7.5/7.6 — full-history overlay launcher. */}
          <TouchableOpacity
            style={[styles.moreBtn, historyOpen && styles.moreBtnActive]}
            activeOpacity={0.6}
            onPress={openHistory}
            accessibilityLabel="Open full terminal history"
          >
            <Text style={styles.moreBtnText}>⌚</Text>
          </TouchableOpacity>
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
            placeholder={activeModSymbols ? `${activeModSymbols} + type a key…` : 'Type command...'}
            placeholderTextColor={activeModSymbols ? '#3b82f6' : '#52525b'}
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

/** The four sticky modifier keys (⌃ ⌥ ⇧ ⌘). Used in both the compact bar and
 *  the expanded KEYS drawer. Tap cycles off → armed → locked. */
function ModKeyRow({ mods, onCycle }: { mods: Mods; onCycle: (k: ModKey) => void }) {
  return (
    <>
      {MOD_BUTTONS.map((b) => {
        const st = mods[b.key];
        const active = st !== 'off';
        return (
          <TouchableOpacity
            key={b.key}
            style={[styles.modKey, st === 'armed' && styles.modKeyArmed, st === 'locked' && styles.modKeyLocked]}
            activeOpacity={0.7}
            onPress={() => onCycle(b.key)}
            accessibilityRole="button"
            accessibilityLabel={`${b.name} modifier ${st}. Tap to ${st === 'off' ? 'arm' : st === 'armed' ? 'lock' : 'clear'}.`}
          >
            <Text style={[styles.modKeySymbol, active && styles.modKeyTextActive]}>{b.symbol}</Text>
            <Text style={[styles.modKeyName, active && styles.modKeyTextActive]}>{b.name}</Text>
            {st === 'locked' && <View style={styles.modLockDot} />}
          </TouchableOpacity>
        );
      })}
    </>
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
  // Sticky modifier keys — symbol over a small name, with armed/locked states.
  modKey: {
    minWidth: 46, height: 40, paddingHorizontal: 8, borderRadius: 9,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#3b82f655',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  modKeyArmed: { backgroundColor: '#3b82f6', borderColor: '#60a5fa' },
  modKeyLocked: { backgroundColor: '#1d4ed8', borderColor: '#fde047' },
  modKeySymbol: { color: '#93c5fd', fontSize: 15, fontWeight: '700', lineHeight: 17 },
  modKeyName: { color: '#64748b', fontSize: 8, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  modKeyTextActive: { color: '#ffffff' },
  modLockDot: { position: 'absolute', top: 3, right: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: '#fde047' },
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

  // Plan items 7.5/7.6 — full-history overlay.
  historyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0a0a0c',
  },
  historyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a',
    backgroundColor: '#141416', gap: 8,
  },
  historyTitle: { color: '#71717a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  historyMeta: { color: '#52525b', fontSize: 10, flex: 1, textAlign: 'right' },
  historyScroll: { flex: 1 },
  historyScrollContent: { padding: 12 },
  historyLoadMore: {
    paddingVertical: 10, alignItems: 'center', borderRadius: 8,
    backgroundColor: '#1a1a1d', borderWidth: 1, borderColor: '#27272a',
    marginBottom: 10,
  },
  historyLoadMoreText: { color: '#3b82f6', fontSize: 12, fontWeight: '600' },
  historyErrorText: { color: '#ef4444', fontSize: 11, marginBottom: 8 },
  historyBody: {
    color: '#d4d4d8', fontSize: 11, lineHeight: 16, fontFamily: MONO,
  },

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
