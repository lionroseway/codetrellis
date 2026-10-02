/**
 * Recurring playbooks, on the phone (Phase 32 C4.3a, shared-work doc C-4).
 *
 * Sam's team runs a security review every Monday. Away from the desk, the
 * phone shows each series as the plans list does, "W38 ✓ · W39 ✗ missed ·
 * W40 due", says what is due in the desktop's words, and starts it; a run
 * that a teammate already started is found, not made twice. A run opens its
 * plan. Rules are set in the app window (Settings → Recurring playbooks).
 *
 * C4.3b: when the computer starts an agent on each run, the card says so,
 * and starting says whether it did (only for a phone allowed to open
 * terminals) or why not.
 */

import { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { agentLine, listRecurring, runMark, startRecurring, startedLine, type RecurringRun, type RecurringSeries } from '../lib/recurring';

const TONE: Record<RecurringRun['state'], { color: string; border: string }> = {
  done: { color: '#6ee7b7', border: '#34d39940' },
  in_progress: { color: '#bae6fd', border: '#38bdf84d' },
  missed: { color: '#fda4afcc', border: '#fb718533' },
  due: { color: '#fde68a', border: '#fbbf2466' },
  next: { color: '#a1a1aa', border: '#27272a' },
};

export default function RecurringScreen() {
  const router = useRouter();
  const [series, setSeries] = useState<RecurringSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSeries(await listRecurring());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (series === null && !error) return <View style={styles.center}><ActivityIndicator color="#3b82f6" /></View>;

  const open = (uid: string) => router.push(`/plan-detail?uid=${uid}`);
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={series ?? []}
      keyExtractor={(s) => s.rule.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#71717a" />}
      ListHeaderComponent={
        <>
          {error && <Text style={styles.error} testID="recurring-error">{error}</Text>}
          {(series?.length ?? 0) > 0 && (
            <Text style={styles.intro}>Playbooks that run on a schedule, one run per period. Start the one due now; a run opens its plan.</Text>
          )}
        </>
      }
      ListEmptyComponent={
        error ? null : (
          <View style={styles.empty} testID="recurring-empty">
            <Text style={styles.emptyTitle}>Nothing recurs yet</Text>
            <Text style={styles.emptyBody}>A playbook can run every day, week or month. Set one in the app on your computer: Settings → Recurring playbooks.</Text>
          </View>
        )
      }
      renderItem={({ item }) => <SeriesCard series={item} onOpen={open} onStarted={setSeries} />}
    />
  );
}

function SeriesCard({ series: s, onOpen, onStarted }: {
  series: RecurringSeries;
  onOpen: (uid: string) => void;
  onStarted: (series: RecurringSeries[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [agentSaid, setAgentSaid] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await startRecurring(s.rule.id);
      setSaid(startedLine(run));
      setAgentSaid(run.agent?.words ?? null);
      onStarted(run.series);
      onOpen(run.planUid);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.card} testID="recurring-series">
      <Text style={styles.title}>↻ {s.rule.title}</Text>
      <Text style={styles.words} testID="recurring-series-words">{s.words}</Text>
      {agentLine(s) && <Text style={styles.agent} testID="recurring-agent">{agentLine(s)}</Text>}
      <View style={styles.runs}>
        {s.runs.map((r) => {
          const tone = TONE[r.state];
          return (
            <TouchableOpacity
              key={r.period}
              testID="recurring-run"
              disabled={!r.planUid}
              onPress={() => { if (r.planUid) onOpen(r.planUid); }}
              accessibilityLabel={r.words}
              style={[styles.run, { borderColor: tone.border }]}
            >
              <Text style={[styles.runText, { color: tone.color }]}>{runMark(r)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {s.due && (
        <View style={styles.due} testID="recurring-due">
          <Text style={styles.dueWords} testID="recurring-due-words">{s.due.words}</Text>
          {s.due.dismissed && <Text style={styles.quiet}>Left for now on the computer; it can still be started.</Text>}
          <TouchableOpacity style={[styles.start, busy && styles.disabled]} disabled={busy} onPress={() => { void start(); }} testID="recurring-start">
            <Text style={styles.startText}>{busy ? 'Starting…' : `Start ${s.due.label}`}</Text>
          </TouchableOpacity>
        </View>
      )}
      {said && <Text style={styles.said} testID="recurring-started">{said}</Text>}
      {agentSaid && <Text style={styles.agentSaid} testID="recurring-agent-started">{agentSaid}</Text>}
      {error && <Text style={styles.error} testID="recurring-start-error">{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center' },
  error: { color: '#fca5a5', fontSize: 13, marginTop: 8 },
  intro: { color: '#a1a1aa', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  card: { backgroundColor: '#141416', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1f1f23' },
  title: { color: '#fafafa', fontSize: 15, fontWeight: '700' },
  words: { color: '#a1a1aa', fontSize: 12, marginTop: 2 },
  runs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  run: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  runText: { fontSize: 12, fontFamily: 'monospace' },
  due: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#27272a' },
  dueWords: { color: '#fde68a', fontSize: 13, lineHeight: 18 },
  quiet: { color: '#71717a', fontSize: 12, marginTop: 3 },
  start: { alignSelf: 'flex-start', backgroundColor: '#f59e0b26', borderWidth: 1, borderColor: '#fbbf2466', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, marginTop: 8 },
  startText: { color: '#fde68a', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  said: { color: '#6ee7b7', fontSize: 12, marginTop: 8 },
  agent: { color: '#c4b5fd', fontSize: 12, marginTop: 3 },
  agentSaid: { color: '#a1a1aa', fontSize: 12, marginTop: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80 },
  emptyTitle: { color: '#d4d4d8', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: '#71717a', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
