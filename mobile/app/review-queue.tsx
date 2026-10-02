/**
 * The review queue, on the phone (Phase 32 A5.6, awareness spec §9.2).
 *
 * Which line of work to merge first, and why, away from the desk. Each line
 * shows where it stands against the main checkout's branch and its suggested
 * place with the reason. The order is advice: nothing here merges anything.
 * A line opens to its review, compared commit to commit; one waiting for a
 * sign-off also opens the approvals, and one held by an overlap opens the
 * lines of work where the overlap is.
 */

import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getReviewQueue, lineFacts, QUEUE_STATUS, type Queue, type QueueLine } from '../lib/review-queue';

export default function ReviewQueueScreen() {
  const router = useRouter();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setQueue(await getReviewQueue());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (queue === null && !error) return <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>;

  const openReview = (l: QueueLine) => {
    const q = [`planUid=${encodeURIComponent(l.planUid)}`, `planTitle=${encodeURIComponent(l.branch)}`];
    if (queue?.base) q.push(`before=${encodeURIComponent(`commit:${queue.base}`)}`, `after=${encodeURIComponent(`commit:${l.branch}`)}`);
    router.push(`/plan-review?${q.join('&')}`);
  };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={queue?.lines ?? []}
      keyExtractor={(l) => `${l.planUid}:${l.branch}`}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#71717a" />}
      ListHeaderComponent={
        <>
          {error && <Text style={styles.error}>{error}</Text>}
          {queue && queue.lines.length > 0 && (
            <Text style={styles.intro}>
              Each line is reviewed against {queue.base ?? 'the main checkout'}. The order is a suggestion, with its reason; merging stays with you.
            </Text>
          )}
        </>
      }
      ListEmptyComponent={error ? null : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing to review yet</Text>
          <Text style={styles.emptyBody}>When plan items are assigned to a branch, each branch shows here with where it stands and the order to merge in.</Text>
        </View>
      )}
      renderItem={({ item: l }) => {
        const status = QUEUE_STATUS[l.status];
        return (
          <View style={[styles.card, { borderLeftColor: status.colour }]} testID="queue-line">
            <TouchableOpacity
              onPress={() => openReview(l)}
              accessibilityRole="button"
              accessibilityLabel={`${l.position}. ${l.branch}, ${status.label}. ${l.reason}`}
            >
              <View style={styles.row}>
                <Text style={styles.position}>{l.position}</Text>
                <Text style={styles.branch} numberOfLines={1}>{l.branch}</Text>
                <Text style={[styles.status, { color: status.colour, backgroundColor: `${status.colour}1a` }]}>{status.label}</Text>
              </View>
              <Text style={styles.plan}>{l.planTitle} · {l.items === 1 ? '1 item' : `${l.items} items`}</Text>
              <Text style={styles.reason} testID="queue-line-reason">{l.reason}</Text>
              <Text style={styles.meta}>{l.error ? `Could not review: ${l.error}` : l.statusWords}</Text>
              {!l.error && <Text style={styles.facts} testID="queue-line-facts">{lineFacts(l)}</Text>}
            </TouchableOpacity>
            {l.status === 'waiting' && (
              <TouchableOpacity onPress={() => router.push('/approvals')} accessibilityRole="button" style={styles.action}>
                <Text style={styles.actionText}>Sign-offs waiting on you ›</Text>
              </TouchableOpacity>
            )}
            {l.status === 'held' && (
              <TouchableOpacity onPress={() => router.push('/workstreams')} accessibilityRole="button" style={styles.action}>
                <Text style={styles.actionText}>See the overlap ›</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center' },
  error: { color: '#fca5a5', fontSize: 13, marginBottom: 12 },
  intro: { color: '#a1a1aa', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  card: { backgroundColor: '#141416', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1f1f23', borderLeftWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  position: { color: '#71717a', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', width: 18 },
  branch: { color: '#fafafa', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', flexShrink: 1 },
  status: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', marginLeft: 'auto' },
  plan: { color: '#a1a1aa', fontSize: 12, marginTop: 4, marginLeft: 26 },
  reason: { color: '#e4e4e7', fontSize: 13, lineHeight: 19, marginTop: 8, marginLeft: 26 },
  meta: { color: '#a1a1aa', fontSize: 12, lineHeight: 17, marginTop: 6, marginLeft: 26 },
  facts: { color: '#71717a', fontSize: 12, lineHeight: 17, marginTop: 2, marginLeft: 26 },
  action: { marginTop: 10, marginLeft: 26 },
  actionText: { color: '#60a5fa', fontSize: 13, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyTitle: { color: '#d4d4d8', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
