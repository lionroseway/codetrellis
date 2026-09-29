/**
 * One overlap, on the phone (Phase 32 A4.5b, journey C2).
 *
 * What the push opens: both sides in plain words, the files, who was told and
 * what they said, then the person's answers — Acknowledge, Intended, and
 * Reply to agent, whose words each agent in either line of work reads on its
 * next step. The words are the desktop's (A4.2); an answer from here is the
 * person's, from the phone, and needs a pairing confirmed on the desktop.
 */

import { useCallback, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  getSignal, answerSignal, replyToSignal, severityColour, ago, replyReadWords, type PhoneSignalDetail,
} from '../lib/awareness';

const STATE_WORDS: Record<string, string> = {
  acknowledged: 'You acknowledged it',
  intended: 'You marked it intended',
  dismissed: 'You dismissed it',
};

export default function SignalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [signal, setSignal] = useState<PhoneSignalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!id) { setError('No signal to show.'); return; }
    try {
      setError(null);
      setSignal(await getSignal(id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (what: string, run: () => Promise<PhoneSignalDetail>) => {
    setBusy(what);
    try {
      setError(null);
      setSignal(await run());
      if (what === 'reply') { setWriting(false); setMessage(''); }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!signal && !error) {
    return <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>;
  }
  if (!signal) {
    return (
      <View style={styles.center}>
        <Text style={styles.gone}>{error}</Text>
        <Text style={styles.goneBody}>It may have resolved: when its cause goes, a signal closes on its own.</Text>
      </View>
    );
  }

  const colour = severityColour(signal.severity);
  const answered = STATE_WORDS[signal.state];
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { borderLeftColor: colour }]}>
        <View style={styles.row}>
          <Text style={[styles.kind, { color: colour }]}>{signal.severity.toUpperCase()} · {signal.heading}</Text>
          <Text style={styles.age}>since {ago(signal.firstSeen)}</Text>
        </View>
        <Text style={styles.summary}>{signal.summary.replace(/`/g, '')}</Text>
      </View>

      <Text style={styles.sectionTitle}>BOTH SIDES</Text>
      {signal.sideWords.map((side, i) => (
        <View key={side.root} style={styles.side} testID="signal-side">
          <Text style={styles.sideName}>{i === 0 ? '' : signal.kind === 'contract' ? '→ ' : '↔ '}{side.name}</Text>
          <Text style={styles.sideWords}>{side.words}</Text>
        </View>
      ))}

      {signal.files.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>FILES</Text>
          {signal.files.map((f) => <Text key={f} style={styles.file}>{f}</Text>)}
        </>
      )}

      {(signal.told.length > 0 || signal.replies.length > 0) && (
        <>
          <Text style={styles.sectionTitle}>SAID</Text>
          {signal.told.map((t) => (
            <View key={`${t.agentType}-${t.toldAt}`} style={styles.said}>
              <Text style={styles.saidWho}>{t.agentType}{t.toldAt ? ` · told ${ago(t.toldAt)} ago` : ''}</Text>
              {t.note && <Text style={styles.saidText}>“{t.note}”</Text>}
            </View>
          ))}
          {signal.replies.map((r) => (
            <View key={r.id} style={[styles.said, styles.mine]} testID="signal-reply">
              <Text style={styles.saidWho}>You{r.by.channel === 'phone' ? ', from your phone' : ''} · {ago(r.at)} ago</Text>
              <Text style={styles.saidText}>“{r.message}”</Text>
              <Text style={styles.readWords}>{replyReadWords(r)}</Text>
            </View>
          ))}
        </>
      )}

      {signal.reopened && signal.state === 'open' && (
        <Text style={styles.reopened}>Back: it changed since you {signal.reopened.from === 'intended' ? 'marked it intended' : 'acknowledged it'}.</Text>
      )}
      {answered && <Text style={styles.answered}>{answered}{signal.stateAt ? ` · ${ago(signal.stateAt)} ago` : ''}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {writing ? (
        <View style={styles.noteBox}>
          <TextInput
            style={styles.noteInput}
            value={message}
            onChangeText={setMessage}
            placeholder="Each agent in both lines of work reads this on its next step"
            placeholderTextColor="#52525b"
            multiline
            autoFocus
            maxLength={1000}
            accessibilityLabel="Message to the agents"
          />
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.secondary} onPress={() => { setWriting(false); setMessage(''); }} accessibilityRole="button">
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primary, (!message.trim() || busy) && styles.disabled]}
              disabled={!message.trim() || busy !== null}
              onPress={() => { void act('reply', () => replyToSignal(signal.id, message.trim())); }}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{busy === 'reply' ? 'Sending…' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          {signal.state !== 'acknowledged' && (
            <TouchableOpacity style={styles.primary} disabled={busy !== null} accessibilityRole="button"
              onPress={() => { void act('ack', () => answerSignal(signal.id, 'acknowledged')); }}>
              <Text style={styles.primaryText}>{busy === 'ack' ? 'Saving…' : 'Acknowledge'}</Text>
            </TouchableOpacity>
          )}
          {signal.kind !== 'stale-base' && signal.state !== 'intended' && (
            <TouchableOpacity style={styles.secondary} disabled={busy !== null} accessibilityRole="button"
              onPress={() => { void act('intended', () => answerSignal(signal.id, 'intended')); }}>
              <Text style={styles.secondaryText}>{busy === 'intended' ? 'Saving…' : 'Intended'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.secondary} disabled={busy !== null} onPress={() => setWriting(true)} accessibilityRole="button">
            <Text style={styles.secondaryText}>Reply to agent</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center', padding: 24 },
  gone: { color: '#d4d4d8', fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  goneBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: '#141416', borderRadius: 12, padding: 14, marginBottom: 18,
    borderWidth: 1, borderColor: '#1f1f23', borderLeftWidth: 3,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  kind: { fontSize: 12, fontWeight: '700' },
  age: { color: '#52525b', fontSize: 11 },
  summary: { color: '#e4e4e7', fontSize: 14, lineHeight: 20, marginTop: 8 },
  sectionTitle: { fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 14 },
  side: { backgroundColor: '#101012', borderRadius: 10, padding: 12, marginBottom: 8 },
  sideName: { color: '#fafafa', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  sideWords: { color: '#d4d4d8', fontSize: 13, lineHeight: 19, marginTop: 4 },
  file: { color: '#a1a1aa', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  said: { borderLeftWidth: 2, borderLeftColor: '#3f3f46', paddingLeft: 10, marginBottom: 10, marginTop: 4 },
  mine: { borderLeftColor: '#3b82f6' },
  saidWho: { color: '#71717a', fontSize: 11 },
  saidText: { color: '#e4e4e7', fontSize: 13, lineHeight: 19, marginTop: 2 },
  readWords: { color: '#71717a', fontSize: 11, marginTop: 2 },
  reopened: { color: '#f59e0b', fontSize: 13, marginTop: 8 },
  answered: { color: '#a1a1aa', fontSize: 12, fontStyle: 'italic', marginTop: 8 },
  error: { color: '#fca5a5', fontSize: 13, marginTop: 10 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  primary: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  secondary: { backgroundColor: '#27272a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  secondaryText: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  noteBox: { marginTop: 16 },
  noteInput: {
    backgroundColor: '#09090b', borderColor: '#27272a', borderWidth: 1, borderRadius: 8,
    color: '#fafafa', fontSize: 14, padding: 10, minHeight: 72, textAlignVertical: 'top',
  },
});
