/**
 * Plan review — Phase 29 mobile flow.
 *
 * "Did the agent do what it said?", on a phone.
 *
 * Phase 25 built the whole review surface — `review`, `pr-draft`,
 * `comparands`, `compare` — and shipped it REST + MCP only. Phase 29
 * §4.13 gave it a desktop panel. **None of it was ever bridged to the
 * phone**: of the 63 RPC methods the desktop exposed, not one was
 * review, pr-draft or compare. So someone watching an agent from their
 * phone could read the plan and talk in the channel, and had no way to
 * ask the one question that matters when you are away from the
 * machine.
 *
 * Four sections, in the order the question is actually asked:
 *
 *   1. **Verdict** — the counts. Landed / partial / untouched, and the
 *      number of changed files no item claimed. That last one is the
 *      finding: work nobody planned.
 *   2. **Next** — what to pick up, from `plan.nextItem`. It is the
 *      first pending Action whose dependencies are done, which a status
 *      list cannot show.
 *   3. **Items** — the walkthrough. Each Action with its verdict and
 *      which declared files landed or did not.
 *   4. **Compare** — the two points being diffed, changeable. This is
 *      the playback: the review is always *against* something, and
 *      being able to move that is what makes it a walk rather than a
 *      snapshot.
 *
 * Plus the PR draft, copied to the clipboard rather than posted —
 * CodeTrellis holds no GitHub credentials, by design.
 *
 * The channel is one tap away at the bottom, because the answer to a
 * bad review is usually to say something to the agent.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';

interface ReviewedItem {
  uid: string;
  title: string;
  status: string | null;
  landed: string[];
  missing: string[];
  verdict: 'landed' | 'partial' | 'untouched' | 'no-targets';
}

interface PlanReview {
  planUid: string;
  items: ReviewedItem[];
  unclaimedChanges: string[];
  unplannedEdges: Array<{ source: string; target: string }>;
  summary: {
    itemsLanded: number;
    itemsPartial: number;
    itemsUntouched: number;
    filesChanged: number;
    unclaimedCount: number;
    unplannedEdgeCount: number;
  };
}

interface PrDraft {
  title: string;
  body: string;
  head: string | null;
  base: string | null;
  warnings: string[];
}

interface Comparand { spec: string; label: string; kind: string }

interface NextItem { uid?: string; title?: string; description?: string; none?: boolean }

const VERDICT = {
  landed: { color: '#22c55e', label: 'Landed' },
  partial: { color: '#f59e0b', label: 'Partial' },
  untouched: { color: '#71717a', label: 'Untouched' },
  'no-targets': { color: '#52525b', label: 'No targets' },
} as const;

/** The label a next-item row shows. A V1 task carries `description`. */
export function nextItemLabel(next: NextItem): string {
  return (next.title ?? next.description ?? '').trim() || 'untitled';
}

export default function PlanReviewScreen() {
  const router = useRouter();
  const { planUid, planTitle } = useLocalSearchParams<{
    planUid: string; planTitle?: string;
  }>();

  const [review, setReview] = useState<PlanReview | null>(null);
  const [next, setNext] = useState<NextItem | null>(null);
  const [comparands, setComparands] = useState<Comparand[]>([]);
  // 'baseline' only resolves when a baseline snapshot has been captured —
  // `listComparands` omits it otherwise, so it was a default that failed on
  // any project without one, and the error state replaces the very switcher
  // that could have changed it. The desktop panel defaults to commit:HEAD,
  // which always resolves; match it.
  const [before, setBefore] = useState('commit:HEAD');
  const [after, setAfter] = useState('live');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    if (!planUid) return;
    setError(null);
    try {
      const [rev, nxt, cmp] = await Promise.all([
        rpc<PlanReview>('review.get', { planUid, before, after }),
        rpc<NextItem>('plan.nextItem', { planUid }).catch(() => null),
        rpc<Comparand[]>('review.comparands').catch(() => [] as Comparand[]),
      ]);
      setReview(rev);
      setNext(nxt);
      setComparands(Array.isArray(cmp) ? cmp : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the review');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [planUid, before, after]);

  useEffect(() => { load(); }, [load]);

  const copyPrDraft = useCallback(async () => {
    setCopying(true);
    try {
      const draft = await rpc<PrDraft>('review.prDraft', { planUid, before, after });
      await Clipboard.setStringAsync(`${draft.title}\n\n${draft.body}`);
      Alert.alert(
        'PR description copied',
        draft.warnings.length > 0
          ? `${draft.warnings.length} warning(s) are included in the body.`
          : 'Paste it into your pull request.',
      );
    } catch (e) {
      Alert.alert('Could not build the draft', e instanceof Error ? e.message : String(e));
    } finally {
      setCopying(false);
    }
  }, [planUid, before, after]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Review' }} />
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Review' }} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const s = review?.summary;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor="#3b82f6"
        />
      }
    >
      <Stack.Screen options={{ title: planTitle ? `Review · ${planTitle}` : 'Review' }} />

      {/* 1 — the verdict */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>
          {s ? `${s.itemsLanded} landed · ${s.itemsPartial} partial · ${s.itemsUntouched} untouched` : '—'}
        </Text>
        <Text style={styles.headerMeta}>
          {s ? `${s.filesChanged} file${s.filesChanged === 1 ? '' : 's'} changed between ${before} and ${after}` : ''}
        </Text>

        {/* The finding: changed files no item claimed. Amber rather than
            red — unclaimed work is worth a look, not an alarm. */}
        {s && s.unclaimedCount > 0 && (
          <View style={styles.findingRow}>
            <Text style={styles.findingText}>
              {s.unclaimedCount} changed file{s.unclaimedCount === 1 ? '' : 's'} no item claimed
            </Text>
          </View>
        )}
        {s && s.unplannedEdgeCount > 0 && (
          <View style={styles.findingRow}>
            <Text style={styles.findingText}>
              {s.unplannedEdgeCount} new dependenc{s.unplannedEdgeCount === 1 ? 'y' : 'ies'} nothing planned
            </Text>
          </View>
        )}
      </View>

      {/* 2 — what to pick up */}
      {next && !next.none && (
        <TouchableOpacity
          style={styles.nextCard}
          activeOpacity={0.7}
          onPress={() => next.uid && router.push(`/item-detail?uid=${next.uid}&planUid=${planUid}`)}
        >
          <Text style={styles.sectionLabel}>NEXT UP</Text>
          <Text style={styles.nextTitle}>{nextItemLabel(next)}</Text>
        </TouchableOpacity>
      )}

      {/* 3 — the walkthrough */}
      <Text style={styles.sectionLabel}>ITEMS</Text>
      {(review?.items ?? []).length === 0 ? (
        <Text style={styles.emptyText}>This plan has no items with file targets to check.</Text>
      ) : (
        (review?.items ?? []).map((item) => {
          const v = VERDICT[item.verdict];
          return (
            <TouchableOpacity
              key={item.uid}
              style={styles.itemCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/item-detail?uid=${item.uid}&planUid=${planUid}`)}
            >
              <View style={styles.itemHeaderRow}>
                <View style={[styles.verdictChip, { backgroundColor: `${v.color}1a`, borderColor: `${v.color}40` }]}>
                  <Text style={[styles.verdictText, { color: v.color }]}>{v.label}</Text>
                </View>
                <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
              </View>
              {item.landed.length > 0 && (
                <Text style={styles.fileLine} numberOfLines={2}>
                  <Text style={{ color: '#22c55e' }}>✓ </Text>
                  {item.landed.join(', ')}
                </Text>
              )}
              {item.missing.length > 0 && (
                <Text style={styles.fileLine} numberOfLines={2}>
                  <Text style={{ color: '#71717a' }}>· </Text>
                  {item.missing.join(', ')}
                </Text>
              )}
            </TouchableOpacity>
          );
        })
      )}

      {/* 4 — what it is being compared against. The review is always
          against two points; moving them is what makes this a walk. */}
      {comparands.length > 1 && (
        <>
          <Text style={styles.sectionLabel}>COMPARING</Text>
          <View style={styles.compareCard}>
            <Text style={styles.compareHint}>From</Text>
            <View style={styles.chipRow}>
              {comparands.map((c) => (
                <TouchableOpacity
                  key={`b-${c.spec}`}
                  style={[styles.chip, before === c.spec && styles.chipActive]}
                  onPress={() => setBefore(c.spec)}
                >
                  <Text style={[styles.chipText, before === c.spec && styles.chipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.compareHint, { marginTop: 12 }]}>To</Text>
            <View style={styles.chipRow}>
              {comparands.map((c) => (
                <TouchableOpacity
                  key={`a-${c.spec}`}
                  style={[styles.chip, after === c.spec && styles.chipActive]}
                  onPress={() => setAfter(c.spec)}
                >
                  <Text style={[styles.chipText, after === c.spec && styles.chipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </>
      )}

      {/* Actions. Copy, not "open a PR" — the desktop holds no GitHub
          credentials and neither does the phone. */}
      <TouchableOpacity style={styles.primaryBtn} onPress={copyPrDraft} disabled={copying}>
        <Text style={styles.primaryBtnText}>
          {copying ? 'Building…' : 'Copy PR description'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() =>
          router.push(
            `/plan-channel?planUid=${planUid}&planTitle=${encodeURIComponent(String(planTitle ?? ''))}`,
          )
        }
      >
        <Text style={styles.secondaryBtnText}>Discuss with the agent →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  errorText: { color: '#ef4444', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f618', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
    borderWidth: 1, borderColor: '#3b82f630',
  },
  retryText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  headerCard: {
    backgroundColor: '#141416', borderRadius: 16, borderWidth: 1, borderColor: '#27272a',
    padding: 16, marginBottom: 20,
  },
  headerTitle: { color: '#e4e4e7', fontSize: 17, fontWeight: '700' },
  headerMeta: { color: '#71717a', fontSize: 12, marginTop: 4 },
  findingRow: {
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#27272a',
  },
  findingText: { color: '#f59e0b', fontSize: 12.5 },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#52525b', letterSpacing: 1, marginBottom: 10,
  },
  emptyText: { color: '#71717a', fontSize: 13, fontStyle: 'italic', marginBottom: 20 },

  nextCard: {
    backgroundColor: '#3b82f60d', borderRadius: 12, borderWidth: 1, borderColor: '#3b82f630',
    padding: 14, marginBottom: 20,
  },
  nextTitle: { color: '#e4e4e7', fontSize: 15, fontWeight: '600' },

  itemCard: {
    backgroundColor: '#141416', borderRadius: 12, borderWidth: 1, borderColor: '#27272a',
    padding: 12, marginBottom: 8,
  },
  itemHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  verdictChip: {
    borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2,
  },
  verdictText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  itemTitle: { color: '#e4e4e7', fontSize: 14, flex: 1 },
  fileLine: { color: '#a1a1aa', fontSize: 11.5, fontFamily: 'monospace', marginTop: 6 },

  compareCard: {
    backgroundColor: '#141416', borderRadius: 12, borderWidth: 1, borderColor: '#27272a',
    padding: 14, marginBottom: 20,
  },
  compareHint: { color: '#52525b', fontSize: 11, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 999, borderWidth: 1, borderColor: '#27272a', backgroundColor: '#0d0d0f',
    paddingHorizontal: 11, paddingVertical: 5,
  },
  chipActive: { borderColor: '#3b82f660', backgroundColor: '#3b82f61a' },
  chipText: { color: '#a1a1aa', fontSize: 12 },
  chipTextActive: { color: '#60a5fa', fontWeight: '600' },

  primaryBtn: {
    backgroundColor: '#3b82f6', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10,
    borderWidth: 1, borderColor: '#27272a',
  },
  secondaryBtnText: { color: '#a1a1aa', fontSize: 14 },
});
