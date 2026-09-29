/**
 * Waiting on you: agent calls held at a breakpoint (Phase 32 B4.4).
 *
 * Each card says, in the desktop's words, who wants to do what, why it is
 * waiting on the person, and the note they left on the breakpoint. Three
 * answers: continue, continue with a note the agent reads, or stop. A
 * breach says what happened instead: it could not be paused, and the agent
 * was told to stop and wait.
 *
 * Oldest first, as they happened. The list re-reads when the screen comes
 * into view and when the desktop's live count of held calls moves, so an
 * answer given on the desktop drops a card here too.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useWaitingBreakpointCount } from '../lib/store';
import { answerBreakpoint, heldFor, listWaitingBreakpoints, type BreakpointDecision, type PhoneHit } from '../lib/breakpoints';

export default function BreakpointsScreen() {
  const count = useWaitingBreakpointCount();
  const [hits, setHits] = useState<PhoneHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setHits(await listWaitingBreakpoints());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { void load(); }, [load, count]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (hits === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={hits ?? []}
      keyExtractor={(h) => h.ref}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#71717a" />}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={
        error ? null : (
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✓</Text>
            <Text style={styles.emptyTitle}>No agent is waiting on you</Text>
            <Text style={styles.emptyBody}>
              When an agent reaches a breakpoint you set — “ask me before this changes” — it waits here until you answer,
              and your lock screen says so if notifications are on.
            </Text>
          </View>
        )
      }
      renderItem={({ item }) => <HeldCard hit={item} onAnswered={load} />}
    />
  );
}

function HeldCard({ hit, onAnswered }: { hit: PhoneHit; onAnswered: () => void }) {
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<BreakpointDecision | null>(null);

  const send = async (decision: BreakpointDecision) => {
    setBusy(decision);
    try {
      const r = await answerBreakpoint(hit.ref, decision, decision === 'steer' ? note.trim() : undefined);
      if (r.alreadyAnswered) {
        Alert.alert('Already answered', `Someone answered first: ${hit.labels[r.hit.decision ?? 'continue']}${r.hit.note ? ` — “${r.hit.note}”` : ''}.`);
      }
      onAnswered();
    } catch (err: unknown) {
      Alert.alert('Not answered', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const stop = () => {
    Alert.alert(hit.labels.stop, hit.breach ? 'The agent is told not to carry on with this change.' : 'The agent is told not to do this.', [
      { text: 'Cancel', style: 'cancel' },
      { text: hit.labels.stop, style: 'destructive', onPress: () => { void send('stop'); } },
    ]);
  };

  const colour = hit.breach ? '#ef4444' : '#f59e0b';
  return (
    <View style={[styles.card, { borderLeftColor: colour }]}>
      <View style={styles.row}>
        <Text style={[styles.kind, { color: colour }]}>{hit.breach ? '⚠ Breach' : '⏸ Waiting on you'}</Text>
        <Text style={styles.age}>{heldFor(hit.hitAt)}</Text>
      </View>
      <Text style={styles.headline}>{hit.headline}</Text>
      <Text style={styles.why}>{hit.why}</Text>
      {!!hit.breakpointNote && <Text style={styles.quote}>Your note: “{hit.breakpointNote}”</Text>}

      {writing ? (
        <View style={styles.noteBox}>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="A note the agent will read"
            placeholderTextColor="#52525b"
            multiline
            autoFocus
            accessibilityLabel="A note the agent will read"
          />
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.secondary} onPress={() => { setWriting(false); setNote(''); }}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primary, (!note.trim() || busy) && styles.disabled]}
              disabled={!note.trim() || busy !== null}
              onPress={() => { void send('steer'); }}
            >
              <Text style={styles.primaryText}>{busy === 'steer' ? 'Sending…' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} disabled={busy !== null} onPress={() => { void send('continue'); }}>
            <Text style={styles.primaryText}>{busy === 'continue' ? 'Sending…' : hit.labels.continue}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondary, busy && styles.disabled]} disabled={busy !== null} onPress={() => setWriting(true)}>
            <Text style={styles.secondaryText}>{hit.labels.steer}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.danger, busy && styles.disabled]} disabled={busy !== null} onPress={stop}>
            <Text style={styles.dangerText}>{busy === 'stop' ? 'Sending…' : hit.labels.stop}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center' },
  error: { color: '#fca5a5', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  card: {
    backgroundColor: '#141416', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1f1f23', borderLeftWidth: 3,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  kind: { fontSize: 12, fontWeight: '700' },
  age: { color: '#52525b', fontSize: 11 },
  headline: { color: '#fafafa', fontSize: 15, fontWeight: '600', lineHeight: 21, marginTop: 6 },
  why: { color: '#a1a1aa', fontSize: 13, lineHeight: 19, marginTop: 6 },
  quote: { color: '#d4d4d8', fontSize: 13, fontStyle: 'italic', marginTop: 6 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  primary: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  secondary: { backgroundColor: '#27272a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  secondaryText: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  danger: { borderColor: '#ef444480', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  dangerText: { color: '#fca5a5', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  noteBox: { marginTop: 12 },
  noteInput: {
    backgroundColor: '#09090b', borderColor: '#27272a', borderWidth: 1, borderRadius: 8,
    color: '#fafafa', fontSize: 14, padding: 10, minHeight: 64, textAlignVertical: 'top',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyMark: { color: '#22c55e', fontSize: 34, fontWeight: '800', marginBottom: 10 },
  emptyTitle: { color: '#d4d4d8', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
