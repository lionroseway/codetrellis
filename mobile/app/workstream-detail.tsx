/**
 * One line of work, on the phone (Phase 32 A4.5b, over A4.3's RPC): what it
 * has changed, how far it is from main, and its recent turns in the
 * Timeline's own words, newest first.
 */

import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getWorkstream, ago, agentNames, type PhoneWorkstreamDetail } from '../lib/awareness';

const STATUS_MARK: Record<string, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

export default function WorkstreamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [w, setW] = useState<PhoneWorkstreamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError('No line of work to show.'); return; }
    try {
      setError(null);
      setW(await getWorkstream(id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!w && !error) return <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>;
  if (!w) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;

  const distance = [
    typeof w.ahead === 'number' ? `${w.ahead} ahead of main` : null,
    typeof w.behind === 'number' ? `${w.behind} behind` : null,
  ].filter(Boolean).join(', ');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{w.name}</Text>
      <Text style={styles.meta}>
        {agentNames(w.agents) || 'No agent now'}
        {distance ? ` · ${distance}` : ''}
      </Text>
      {w.tasks.map((t) => <Text key={t.uid} style={styles.task}>▸ {t.title}</Text>)}

      <Text style={styles.sectionTitle}>CHANGED ({w.files.length}{w.truncated ? '+' : ''})</Text>
      {w.files.length === 0 && <Text style={styles.calm}>Nothing changed against main yet.</Text>}
      {w.files.map((f) => (
        <View key={f.path} style={styles.fileRow} testID="workstream-file">
          <Text style={styles.mark}>{STATUS_MARK[f.status] ?? '?'}</Text>
          <Text style={styles.file} numberOfLines={1}>{f.path}</Text>
          {(typeof f.added === 'number' || typeof f.removed === 'number') && (
            <Text style={styles.lines}><Text style={styles.plus}>+{f.added ?? 0}</Text> <Text style={styles.minus}>−{f.removed ?? 0}</Text></Text>
          )}
        </View>
      ))}

      <Text style={styles.sectionTitle}>RECENT TURNS</Text>
      {w.turns.length === 0 && <Text style={styles.calm}>No agent turns recorded here yet.</Text>}
      {w.turns.map((t) => (
        <View key={`${t.sessionId}-${t.startedAt}`} style={[styles.turn, t.hasError && styles.turnError]} testID="workstream-turn">
          <View style={styles.row}>
            <Text style={styles.turnWho}>{t.agentType ?? 'agent'}</Text>
            <Text style={styles.age}>{ago(t.endedAt)} ago</Text>
          </View>
          <Text style={styles.turnText}>{t.summary}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#fca5a5', fontSize: 13, textAlign: 'center' },
  name: { color: '#fafafa', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  meta: { color: '#a1a1aa', fontSize: 13, marginTop: 4 },
  task: { color: '#93c5fd', fontSize: 13, marginTop: 6 },
  sectionTitle: { fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1, marginTop: 22, marginBottom: 8 },
  calm: { color: '#71717a', fontSize: 13 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#18181b' },
  mark: { color: '#f59e0b', fontSize: 12, fontWeight: '700', width: 14, fontFamily: 'monospace' },
  file: { color: '#d4d4d8', fontSize: 12, fontFamily: 'monospace', flex: 1 },
  lines: { fontSize: 11, fontFamily: 'monospace' },
  plus: { color: '#4ade80' },
  minus: { color: '#f87171' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  turn: { backgroundColor: '#141416', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1f1f23' },
  turnError: { borderColor: '#ef444460' },
  turnWho: { color: '#fafafa', fontSize: 13, fontWeight: '700' },
  age: { color: '#52525b', fontSize: 11 },
  turnText: { color: '#d4d4d8', fontSize: 13, lineHeight: 19, marginTop: 4 },
});
