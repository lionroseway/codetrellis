/**
 * The lines of work, on the phone (Phase 32 A4.5b, over A4.3's RPC).
 *
 * The desktop's strip, as a list: each worktree, shared folder, branch or
 * clone with work in it, its agents, the tasks they hold, what it has changed
 * and the overlaps naming it. One opens to its files and recent turns.
 */

import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listWorkstreams, agentNames, type PhoneWorkstream } from '../lib/awareness';

const SHAPE: Record<PhoneWorkstream['shape'], string> = {
  worktree: 'Worktree', shared: 'Shared folder', branch: 'Branch, no checkout here', clone: 'Clone',
};

export default function WorkstreamsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<PhoneWorkstream[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setItems(await listWorkstreams());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (items === null && !error) return <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={items ?? []}
      keyExtractor={(w) => w.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#71717a" />}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={error ? null : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>One line of work</Text>
          <Text style={styles.emptyBody}>When agents work in more than one worktree, branch or folder, each shows here with what it has changed.</Text>
        </View>
      )}
      renderItem={({ item: w }) => (
        <TouchableOpacity
          style={[styles.card, w.needsYou > 0 && styles.flagged]}
          onPress={() => router.push(`/workstream-detail?id=${encodeURIComponent(w.id)}`)}
          accessibilityRole="button"
          accessibilityLabel={`${w.name}, ${w.agents.length} agents, ${w.changedFiles} files changed`}
          testID="workstream"
        >
          <View style={styles.row}>
            <Text style={styles.name}>{w.name}{w.main ? ' · main checkout' : ''}</Text>
            {w.needsYou > 0 && <Text style={styles.badge}>⚠ {w.needsYou}</Text>}
          </View>
          <Text style={styles.meta}>
            {SHAPE[w.shape]} · {w.changedFiles === 1 ? '1 file changed' : `${w.changedFiles} files changed`}
            {w.signals > 0 ? ` · ${w.signals} overlap${w.signals === 1 ? '' : 's'}` : ''}
          </Text>
          {w.agents.length > 0 && <Text style={styles.agents}>{agentNames(w.agents)}</Text>}
          {w.tasks.map((t) => <Text key={t.uid} style={styles.task}>▸ {t.title}</Text>)}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center' },
  error: { color: '#fca5a5', fontSize: 13, marginBottom: 12 },
  card: { backgroundColor: '#141416', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1f1f23' },
  flagged: { borderColor: '#ef444460' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  name: { color: '#fafafa', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', flexShrink: 1 },
  badge: { color: '#fca5a5', fontSize: 12, fontWeight: '700' },
  meta: { color: '#a1a1aa', fontSize: 12, marginTop: 4 },
  agents: { color: '#d4d4d8', fontSize: 13, marginTop: 6 },
  task: { color: '#93c5fd', fontSize: 13, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyTitle: { color: '#d4d4d8', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
