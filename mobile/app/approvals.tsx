/**
 * Everything waiting on you, across every plan (Phase 31 §12).
 *
 * Work an agent submitted for a person to judge, and approvals whose files
 * have changed since. Newest first; tap one to decide it. Refreshes when
 * the screen comes back into view, so a decision taken here or on the
 * desktop drops it from the list.
 */

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { listAwaiting, stateColour, stateLabel, type AwaitingEntry } from '../lib/approvals';

export default function ApprovalsScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<AwaitingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setEntries(await listAwaiting());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (entries === null && !error) {
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
      data={entries ?? []}
      keyExtractor={(e) => e.uid}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#71717a" />}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      ListEmptyComponent={
        error ? null : (
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✓</Text>
            <Text style={styles.emptyTitle}>Nothing is waiting for you</Text>
            <Text style={styles.emptyBody}>
              When an agent submits work for you to judge, or something you approved changes, it shows up here — and on
              your lock screen if notifications are on.
            </Text>
          </View>
        )
      }
      renderItem={({ item: e }) => {
        const colour = stateColour(e.state);
        const files = e.evidence.filter((x) => x.attachmentUid).length;
        const by = e.evidence[0]?.submittedBy;
        return (
          <TouchableOpacity
            style={[styles.card, { borderLeftColor: colour }]}
            activeOpacity={0.75}
            onPress={() => router.push(
              `/approval?criterionUid=${encodeURIComponent(e.uid)}&itemUid=${encodeURIComponent(e.itemUid)}`,
            )}
          >
            <View style={styles.row}>
              <Text style={[styles.state, { color: colour }]}>{stateLabel(e.state)}</Text>
              {!!by && <Text style={styles.by} numberOfLines={1}>{by}</Text>}
            </View>
            <Text style={styles.text} numberOfLines={3}>{e.text}</Text>
            <Text style={styles.where} numberOfLines={1}>{e.itemTitle} · {e.planTitle}</Text>
            {files > 0 && (
              <Text style={styles.files} numberOfLines={1}>
                {files === 1 ? e.evidence.find((x) => x.attachmentUid)?.name : `${files} files`}
                {files === 1 && e.evidence[0]?.where ? ` · ${e.evidence[0].where}` : ''}
              </Text>
            )}
          </TouchableOpacity>
        );
      }}
    />
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
  state: { fontSize: 12, fontWeight: '700' },
  by: { color: '#52525b', fontSize: 11, flexShrink: 1 },
  text: { color: '#fafafa', fontSize: 15, fontWeight: '600', lineHeight: 21, marginTop: 6 },
  where: { color: '#a1a1aa', fontSize: 12, marginTop: 6 },
  files: { color: '#3b82f6', fontSize: 12, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyMark: { color: '#22c55e', fontSize: 34, fontWeight: '800', marginBottom: 10 },
  emptyTitle: { color: '#d4d4d8', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
