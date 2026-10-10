/**
 * "Needs you" (Phase 32 A4.5b, awareness spec §8.1): the top of Activity.
 *
 * One place for what is waiting on the person away from the desk: agents
 * held at a breakpoint, then overlaps between lines of work in the digest's
 * words, each opening its detail. The counts ride in the live snapshot
 * (`waitingBreakpoints`, `openSignals`); the words are pulled when they move.
 * Nothing waiting says so in a line, not a blank.
 *
 * Phase 33 G10: a check run that blocks is here too, the latest from each
 * place it ran (CI, a terminal, an agent's session), with what it found and
 * what to do instead. A place whose latest run passes is not.
 */

import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useOpenSignalCount, useWaitingBreakpointCount } from '../lib/store';
import { getNeedsYou, severityColour, ago, type PhoneNeedsYou } from '../lib/awareness';

export default function NeedsYou() {
  const router = useRouter();
  const held = useWaitingBreakpointCount();
  const open = useOpenSignalCount();
  const [data, setData] = useState<PhoneNeedsYou | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await getNeedsYou());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { void load(); }, [load, open]);

  const signals = data?.signals ?? [];
  const checks = data?.checks ?? [];
  const nothing = held === 0 && open === 0 && signals.length === 0 && checks.length === 0;
  const count = held + open + checks.length;

  return (
    <View style={styles.section} testID="needs-you">
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>NEEDS YOU{count > 0 ? ` (${count})` : ''}</Text>
        <TouchableOpacity onPress={() => router.push('/workstreams')} accessibilityRole="button" accessibilityLabel="All lines of work">
          <Text style={styles.link}>Lines of work ›</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>Could not read what overlaps: {error}</Text>}

      {nothing && !error && (
        <Text style={styles.calm}>Nothing is waiting on you. Agents held at a breakpoint, overlaps between lines of work and checks that block show here.</Text>
      )}

      {held > 0 && (
        <TouchableOpacity
          style={[styles.card, { borderLeftColor: '#f59e0b' }]}
          onPress={() => router.push('/breakpoints')}
          accessibilityRole="button"
          accessibilityLabel={`${held} waiting on you at a breakpoint`}
        >
          <Text style={[styles.kind, { color: '#f59e0b' }]}>⏸ At a breakpoint</Text>
          <Text style={styles.headline}>{held === 1 ? 'An agent is waiting on you' : `${held} agents are waiting on you`}</Text>
        </TouchableOpacity>
      )}

      {checks.map((c) => (
        <View
          key={c.id}
          style={[styles.card, { borderLeftColor: '#ef4444' }]}
          accessible
          accessibilityLabel={`A check blocks: ${c.outcome}, ${c.who} in ${c.ranIn}`}
          testID="needs-you-check"
        >
          <View style={styles.row}>
            <Text style={[styles.kind, { color: '#ef4444' }]}>✗ A check blocks{c.scope ? ` · ${c.scope}` : ''}</Text>
            <Text style={styles.age}>{ago(c.at)}</Text>
          </View>
          <Text style={styles.headline}>{c.who} in {c.ranIn}: {c.outcome}</Text>
          {c.findings.map((f) => (
            <View key={`${f.rule}${f.where}`} style={styles.finding}>
              <Text style={styles.findingWhere}>{f.where} · {f.rule}</Text>
              {f.fix ? <Text style={styles.summary}>→ {f.fix}</Text> : null}
            </View>
          ))}
          {c.more > 0 && <Text style={styles.more}>and {c.more} more; the desktop's Checks view has them all</Text>}
        </View>
      ))}

      {data && data.digest.lines.length > 0 && (
        <View style={styles.digest} testID="needs-you-digest">
          {data.digest.lines.map((l) => (
            <View key={l.signalIds[0]} style={styles.digestLine}>
              <Text style={styles.digestText}>{l.text.replace(/`/g, '')}</Text>
              <Text style={styles.digestQuestion}>Waiting on you: {l.question}{l.told ? ' · agents told' : ''}</Text>
            </View>
          ))}
          {data.digest.moreLines > 0 && <Text style={styles.more}>and {data.digest.moreLines} more</Text>}
        </View>
      )}

      {signals.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.card, { borderLeftColor: severityColour(s.severity) }, s.state !== 'open' && styles.seen]}
          onPress={() => router.push(`/signal-detail?id=${encodeURIComponent(s.id)}`)}
          accessibilityRole="button"
          accessibilityLabel={`${s.severity} ${s.heading}: ${s.sides.join(' and ')}`}
          testID="needs-you-signal"
        >
          <View style={styles.row}>
            <Text style={[styles.kind, { color: severityColour(s.severity) }]}>
              {s.severity === 'high' ? '⚠ ' : ''}{s.heading}
            </Text>
            <Text style={styles.age}>{s.state === 'open' ? ago(s.firstSeen) : 'seen'}</Text>
          </View>
          <Text style={styles.headline}>{s.sides.join(s.kind === 'contract' && !s.material ? ' → ' : ' ↔ ')}</Text>
          <Text style={styles.summary} numberOfLines={3}>{s.summary.replace(/`/g, '')}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1 },
  link: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },
  error: { color: '#fca5a5', fontSize: 13, marginBottom: 10 },
  calm: { color: '#71717a', fontSize: 13, lineHeight: 19 },
  card: {
    backgroundColor: '#141416', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1f1f23', borderLeftWidth: 3,
  },
  seen: { opacity: 0.7 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  kind: { fontSize: 12, fontWeight: '700' },
  age: { color: '#52525b', fontSize: 11 },
  headline: { color: '#fafafa', fontSize: 15, fontWeight: '600', lineHeight: 21, marginTop: 6 },
  summary: { color: '#a1a1aa', fontSize: 13, lineHeight: 19, marginTop: 4 },
  digest: { backgroundColor: '#101012', borderRadius: 12, padding: 12, marginBottom: 10, gap: 8 },
  digestLine: { gap: 2 },
  digestText: { color: '#e4e4e7', fontSize: 13, lineHeight: 18 },
  digestQuestion: { color: '#a1a1aa', fontSize: 12, lineHeight: 17 },
  more: { color: '#71717a', fontSize: 12 },
  finding: { marginTop: 8, gap: 2 },
  findingWhere: { color: '#e4e4e7', fontSize: 12, fontFamily: 'monospace' },
});
