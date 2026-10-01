/**
 * The stack, on the phone (Phase 32 B6.6, JOURNEYS H1).
 *
 * Every plan under way at once, away from the desk: each plan's progress,
 * where it meets another plan in words, who is on what, and what is waiting
 * on another plan. A plan opens to its detail. The same stack the desktop's
 * Stack tab and any agent's `get_stack` read.
 *
 * Played forward (B9.4, JOURNEYS G3): where the plans will meet if they go
 * ahead, "◇ planned overlap", in the desktop's words with what was decided,
 * and the same three choices as the window's bar: re-sequence the plans, tell
 * the agents, or leave it. Each plan says where it will meet another.
 */

import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getStack, waitsIn, whoIsOn, type Stack, type StackPlan } from '../lib/stack';
import { decideOverlap, decisionLine, getPlayForward, planOverlapLines, type PlannedOverlap, type PlayForward } from '../lib/play-forward';

export default function StackScreen() {
  const router = useRouter();
  const [stack, setStack] = useState<Stack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [forward, setForward] = useState<PlayForward | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setStack(await getStack());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // Play-forward is its own answer: a desktop without it still shows the stack.
    try { setForward(await getPlayForward()); } catch { setForward(null); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (stack === null && !error) return <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>;

  const count = stack?.plans.length ?? 0;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={stack?.plans ?? []}
      keyExtractor={(p) => p.uid}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#71717a" />}
      ListHeaderComponent={
        <>
          {error && <Text style={styles.error}>{error}</Text>}
          {count > 0 && (
            <Text style={styles.intro}>
              {count} {count === 1 ? 'plan' : 'plans'} under way, with who is on what and where they meet.
            </Text>
          )}
          {forward && forward.overlaps.length > 0 && (
            <PlannedOverlaps
              forward={forward}
              onDecided={(pf) => {
                setForward((was) => (was ? { ...was, ...pf } : was));
                // Re-sequencing makes tasks wait on others: the stack's waits change too.
                void getStack().then(setStack, () => {});
              }}
            />
          )}
        </>
      }
      ListEmptyComponent={error ? null : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No plan is under way</Text>
          <Text style={styles.emptyBody}>A plan shows here from when it is created until it is completed or archived.</Text>
        </View>
      )}
      renderItem={({ item }) => <PlanCard plan={item} forward={forward} onOpen={() => router.push(`/plan-detail?uid=${item.uid}`)} />}
    />
  );
}

/**
 * Where the plans will meet, before anyone starts: each planned overlap in the
 * desktop's words, what was last decided, and the window's three choices.
 */
function PlannedOverlaps({ forward, onDecided }: { forward: PlayForward; onDecided: (pf: Omit<PlayForward, 'notices'>) => void }) {
  return (
    <View style={styles.planned} testID="planned-overlaps">
      <Text style={styles.sectionTitle}>PLAYED FORWARD</Text>
      <Text style={styles.plannedWords} testID="planned-words">{forward.words}</Text>
      {forward.notices.map((n) => (
        <Text key={n.id} style={styles.notice} testID="planned-notice">{n.title}</Text>
      ))}
      {forward.overlaps.map((o) => <PlannedOverlapCard key={o.id} overlap={o} onDecided={onDecided} />)}
    </View>
  );
}

function PlannedOverlapCard({ overlap: o, onDecided }: { overlap: PlannedOverlap; onDecided: (pf: Omit<PlayForward, 'notices'>) => void }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decided = decisionLine(o);
  const act = async (action: 'resequence' | 'tell' | 'leave', first?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await decideOverlap(o.id, action, first);
      setChoosing(false);
      onDecided(r.playForward);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const tone = o.sequenced || o.left ? '#a1a1aa' : o.serious ? '#fca5a5' : '#c4b5fd';
  return (
    <View style={[styles.plannedCard, o.sequenced || o.left ? styles.quiet : null]} testID="planned-overlap">
      <Text style={[styles.plannedOverlapWords, { color: tone }]} testID="planned-overlap-words">{o.words}</Text>
      {decided && <Text style={styles.decision} testID="planned-overlap-decision">{decided}</Text>}
      {!o.sequenced && (choosing ? (
        <View style={styles.actions} testID="planned-choose-first">
          <Text style={styles.choose}>Which goes first?</Text>
          {o.plans.map((p) => (
            <TouchableOpacity key={p.uid} style={styles.action} disabled={busy} onPress={() => { void act('resequence', p.uid); }} accessibilityRole="button" testID="planned-first">
              <Text style={styles.actionText}>{p.label} first</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setChoosing(false)} accessibilityRole="button"><Text style={styles.cancel}>Cancel</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.action} disabled={busy} onPress={() => setChoosing(true)} accessibilityRole="button" testID="planned-resequence">
            <Text style={styles.actionText}>Re-sequence</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.action} disabled={busy} onPress={() => { void act('tell'); }} accessibilityRole="button" testID="planned-tell">
            <Text style={styles.actionText}>Tell both agents</Text>
          </TouchableOpacity>
          {!o.left && (
            <TouchableOpacity style={styles.action} disabled={busy} onPress={() => { void act('leave'); }} accessibilityRole="button" testID="planned-leave">
              <Text style={styles.actionText}>Fine, leave it</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {error && <Text style={styles.error} testID="planned-error">{error}</Text>}
    </View>
  );
}

function PlanCard({ plan, forward, onOpen }: { plan: StackPlan; forward: PlayForward | null; onOpen: () => void }) {
  const { done, total } = plan.progress;
  const planned = planOverlapLines(forward, plan.uid);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const onIt = whoIsOn(plan);
  const waits = waitsIn(plan);
  const high = plan.overlaps.some((o) => o.high);
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: high ? '#ef4444' : plan.overlaps.length ? '#f59e0b' : '#3b82f6' }]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${plan.label}, ${done} of ${total} tasks done${plan.overlaps.length ? `, ${plan.overlaps.map((o) => o.words.replace('⚠ ', '')).join(', ')}` : ''}`}
      testID="stack-plan"
    >
      <View style={styles.row}>
        <Text style={[styles.label, plan.ticketKey ? styles.mono : null]} numberOfLines={1}>{plan.label}</Text>
        {plan.needsYou > 0 && (
          <Text style={styles.needsYou} testID="stack-needs-you">{plan.needsYou} {plan.needsYou === 1 ? 'needs' : 'need'} you</Text>
        )}
        <Text style={styles.count}>{done}/{total}</Text>
      </View>
      {plan.ticketKey && <Text style={styles.title} numberOfLines={1}>{plan.title}</Text>}
      {plan.arrival && <Text style={styles.arrival} numberOfLines={1} testID="stack-plan-arrival">{plan.arrival}</Text>}
      <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>

      {plan.overlaps.map((o) => (
        <View key={o.withPlanUid} style={styles.overlap} testID="stack-overlap">
          <Text style={[styles.overlapWords, { color: o.high ? '#fca5a5' : '#fcd34d' }]}>{o.words}</Text>
          <Text style={styles.overlapDetail}>{o.detail}</Text>
        </View>
      ))}

      {planned.map((l) => (
        <Text key={l.id} style={[styles.willOverlap, { color: l.quiet ? '#a1a1aa' : l.serious ? '#fca5a5' : '#c4b5fd' }]} testID="stack-plan-planned">{l.words}</Text>
      ))}

      {onIt.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ON IT</Text>
          {onIt.map((line) => <Text key={line} style={styles.line} testID="stack-on-it">{line}</Text>)}
        </View>
      )}
      {waits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WAITING</Text>
          {waits.map((w) => <Text key={w} style={styles.wait} testID="stack-wait">↑ {w}</Text>)}
        </View>
      )}
    </TouchableOpacity>
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
  label: { color: '#fafafa', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  arrival: { color: '#7dd3fc', fontSize: 12, marginTop: 2 },
  mono: { fontFamily: 'monospace' },
  needsYou: { color: '#fcd34d', backgroundColor: '#f59e0b1a', fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  count: { color: '#a1a1aa', fontSize: 12, fontFamily: 'monospace', marginLeft: 'auto' },
  title: { color: '#a1a1aa', fontSize: 12, marginTop: 2 },
  bar: { height: 3, backgroundColor: '#27272a', borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#3b82f6' },
  overlap: { marginTop: 10 },
  overlapWords: { fontSize: 13, fontWeight: '600' },
  overlapDetail: { color: '#a1a1aa', fontSize: 12, lineHeight: 17, marginTop: 2 },
  section: { marginTop: 10 },
  sectionTitle: { color: '#71717a', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 3 },
  line: { color: '#e4e4e7', fontSize: 13, lineHeight: 19 },
  wait: { color: '#fcd34d', fontSize: 13, lineHeight: 19 },
  planned: { backgroundColor: '#8b5cf60d', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#8b5cf633', borderStyle: 'dashed' },
  plannedWords: { color: '#d4d4d8', fontSize: 12, lineHeight: 17, marginBottom: 6 },
  notice: { color: '#fcd34d', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  plannedCard: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#27272a' },
  quiet: { opacity: 0.75 },
  plannedOverlapWords: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  decision: { color: '#a78bfa', fontSize: 12, marginTop: 3 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  action: { borderWidth: 1, borderColor: '#8b5cf666', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  actionText: { color: '#ddd6fe', fontSize: 12, fontWeight: '600' },
  choose: { color: '#a1a1aa', fontSize: 12 },
  cancel: { color: '#71717a', fontSize: 12, paddingHorizontal: 4 },
  willOverlap: { fontSize: 12, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyTitle: { color: '#d4d4d8', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
