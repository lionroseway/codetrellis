/**
 * Approve, or send back, one criterion (Phase 31 §12).
 *
 * Opened from a push ("Approval needed"), the approvals list, or an item's
 * criteria. It shows what the work is judged on, what the agent said, and
 * the evidence at the place it cited — read on the desktop and streamed
 * here — with the two decisions always in reach at the bottom.
 *
 * A send-back needs a note: it is what the agent reads next. It can point
 * at the file being looked at, so the agent is told where, not only what.
 * After deciding, the next thing waiting is one tap away.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import EvidencePreview from '../components/EvidencePreview';
import {
  decide,
  listAwaiting,
  listItemCriteria,
  clearPreviewCache,
  stateColour,
  stateLabel,
  type AwaitingEntry,
  type PhoneCriterion,
  type PhoneEvidence,
} from '../lib/approvals';

type Done = { decision: 'approved' | 'sent_back'; next: AwaitingEntry | null; remaining: number };

export default function ApprovalScreen() {
  const { criterionUid, itemUid } = useLocalSearchParams<{ criterionUid: string; itemUid: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [itemTitle, setItemTitle] = useState('');
  const [criterion, setCriterion] = useState<PhoneCriterion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<number>(0);
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');
  const [pointAtFile, setPointAtFile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const load = useCallback(async () => {
    if (!criterionUid || !itemUid) { setError('Nothing to approve was named.'); return; }
    try {
      setError(null);
      const { item, criteria } = await listItemCriteria(itemUid);
      setItemTitle(item.title);
      const found = criteria.find((c) => c.uid === criterionUid) ?? null;
      setCriterion(found);
      if (!found) setError('This criterion is no longer on the item — it may have been removed on the desktop.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [criterionUid, itemUid]);

  useEffect(() => {
    setLoading(true);
    setDone(null);
    setSendingBack(false);
    setNote('');
    setOpen(0);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    navigation.setOptions({ title: criterion?.state === 'stale' ? 'Still met?' : 'Approval' });
  }, [navigation, criterion?.state]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    clearPreviewCache();
    await load();
    setRefreshing(false);
  }, [load]);

  const files = useMemo(() => (criterion?.evidence ?? []).filter((e) => e.attachmentUid), [criterion]);
  const agentNote = criterion?.evidence.find((e) => e.note)?.note ?? null;
  const submitted = criterion?.evidence[0] ?? null;
  const anchorFile: PhoneEvidence | null = files[open] ?? files[0] ?? null;

  const act = useCallback(async (decision: 'approved' | 'sent_back') => {
    if (!criterion || busy) return;
    setBusy(true);
    setDecideError(null);
    try {
      const anchor = decision === 'sent_back' && pointAtFile && anchorFile?.attachmentUid
        ? { attachmentUid: anchorFile.attachmentUid, locator: anchorFile.locator ?? null }
        : null;
      await decide(criterion.uid, decision, { note: decision === 'sent_back' ? note.trim() : undefined, anchor });
      void Haptics.notificationAsync(
        decision === 'approved' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
      clearPreviewCache();
      // What is next — best effort; the decision is already recorded.
      const waiting = await listAwaiting().catch(() => [] as AwaitingEntry[]);
      const others = waiting.filter((w) => w.uid !== criterion.uid);
      setDone({ decision, next: others[0] ?? null, remaining: others.length });
    } catch (err: unknown) {
      setDecideError(err instanceof Error ? err.message : String(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, [criterion, busy, note, pointAtFile, anchorFile]);

  // ── States ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  if (done) {
    const approved = done.decision === 'approved';
    return (
      <View style={styles.center}>
        <View style={[styles.doneCircle, { borderColor: approved ? '#22c55e' : '#ef4444' }]}>
          <Text style={[styles.doneMark, { color: approved ? '#22c55e' : '#ef4444' }]}>{approved ? '✓' : '↩'}</Text>
        </View>
        <Text style={styles.doneTitle}>{approved ? 'Approved' : 'Sent back'}</Text>
        <Text style={styles.doneBody}>
          {approved
            ? 'Recorded as yours, from this phone.'
            : 'The agent reads your note next time it looks at its work.'}
        </Text>
        {done.next ? (
          <>
            <Text style={styles.nextLabel}>
              {done.remaining} more waiting for you
            </Text>
            <TouchableOpacity
              style={styles.nextCard}
              activeOpacity={0.8}
              onPress={() => router.replace(
                `/approval?criterionUid=${encodeURIComponent(done.next!.uid)}&itemUid=${encodeURIComponent(done.next!.itemUid)}`,
              )}
            >
              <Text style={styles.nextText} numberOfLines={2}>{done.next.text}</Text>
              <Text style={styles.nextSub} numberOfLines={1}>{done.next.itemTitle} · {done.next.planTitle}</Text>
              <Text style={styles.nextGo}>Next →</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.nextLabel}>Nothing else is waiting for you.</Text>
        )}
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
          <Text style={styles.secondaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (error || !criterion) {
    return (
      <View style={styles.center}>
        <Text style={styles.goneTitle}>Can't show this approval</Text>
        <Text style={styles.goneBody}>{error ?? 'Not found.'}</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
          <Text style={styles.secondaryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const colour = stateColour(criterion.state);
  const stale = criterion.state === 'stale';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#71717a" />}
      >
        {/* What is being judged */}
        <View style={[styles.card, { borderColor: `${colour}40` }]}>
          <View style={styles.row}>
            <View style={[styles.pill, { backgroundColor: `${colour}20` }]}>
              <View style={[styles.dot, { backgroundColor: colour }]} />
              <Text style={[styles.pillText, { color: colour }]}>{stateLabel(criterion.state)}</Text>
            </View>
            {submitted && <Text style={styles.age}>{formatAge(submitted.submittedAt)}</Text>}
          </View>
          <Text style={styles.criterionText} selectable>{criterion.text}</Text>
          {!!itemTitle && <Text style={styles.itemTitle} numberOfLines={2}>{itemTitle}</Text>}
        </View>

        {stale && criterion.changedFiles.length > 0 && (
          <View style={[styles.card, styles.staleCard]}>
            <Text style={styles.label}>CHANGED SINCE IT WAS APPROVED</Text>
            {criterion.changedFiles.map((f) => (
              <Text key={f} style={styles.staleFile} numberOfLines={1}>{f}</Text>
            ))}
            <Text style={styles.staleHint}>Look at them again: approve if it is still met, or send it back.</Text>
          </View>
        )}

        {/* What the agent said */}
        {(agentNote || submitted) && (
          <View style={styles.card}>
            <Text style={styles.label}>
              {submitted ? `${submitted.submittedBy.toUpperCase()} SAID` : 'NOTE'}
            </Text>
            <Text style={styles.agentNote} selectable>{agentNote ?? 'No note — see the evidence below.'}</Text>
          </View>
        )}

        {/* The evidence, at the place cited */}
        {files.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>EVIDENCE ({files.length})</Text>
            {files.map((e, i) => {
              const expanded = open === i;
              return (
                <View key={`${e.attachmentUid}-${i}`} style={styles.evidenceCard}>
                  <TouchableOpacity
                    style={styles.evidenceHead}
                    activeOpacity={0.7}
                    onPress={() => setOpen(expanded ? -1 : i)}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.fileName} numberOfLines={1}>{e.name ?? 'file'}</Text>
                      {!!e.where && <Text style={styles.fileWhere} numberOfLines={1}>{e.where}</Text>}
                    </View>
                    <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
                  </TouchableOpacity>
                  {expanded && e.attachmentUid && (
                    <View style={styles.evidenceBody}>
                      <EvidencePreview attachmentUid={e.attachmentUid} locator={e.locator} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {criterion.lastDecision && criterion.state !== 'submitted' && (
          <Text style={styles.history}>
            {criterion.lastDecision.decision === 'approved' ? 'Approved' : 'Sent back'} by {criterion.lastDecision.actor}
            {' '}on the {criterion.lastDecision.channel} · {formatAge(criterion.lastDecision.at)}
            {criterion.lastDecision.note ? ` — “${criterion.lastDecision.note}”` : ''}
          </Text>
        )}
      </ScrollView>

      {/* The decision, always in reach */}
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
        {decideError && <Text style={styles.decideError}>{decideError}</Text>}
        {sendingBack ? (
          <View>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="What's wrong? The agent reads this next."
              placeholderTextColor="#52525b"
              multiline
              autoFocus
              maxLength={4000}
              editable={!busy}
            />
            {anchorFile && (
              <TouchableOpacity style={styles.anchorRow} onPress={() => setPointAtFile((v) => !v)} activeOpacity={0.7}>
                <View style={[styles.checkbox, pointAtFile && styles.checkboxOn]}>
                  {pointAtFile && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.anchorText} numberOfLines={1}>
                  About {anchorFile.name}{anchorFile.where ? `, ${anchorFile.where}` : ''}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.buttons}>
              <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={() => setSendingBack(false)} disabled={busy}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.sendBackSolid, (!note.trim() || busy) && styles.disabled]}
                onPress={() => act('sent_back')}
                disabled={!note.trim() || busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>Send back</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.buttons}>
            {criterion.canSendBack && (
              <TouchableOpacity
                style={[styles.btn, styles.sendBackBtn]}
                onPress={() => { setDecideError(null); setSendingBack(true); }}
                disabled={busy}
              >
                <Text style={styles.sendBackText}>{criterion.state === 'met' ? 'Take back' : 'Send back'}</Text>
              </TouchableOpacity>
            )}
            {criterion.canApprove && (
              <TouchableOpacity
                style={[styles.btn, styles.approveBtn, busy && styles.disabled]}
                onPress={() => act('approved')}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.solidText}>{stale ? 'Still met' : 'Approve'}</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function formatAge(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center', padding: 28 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: {
    backgroundColor: '#141416', borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#1f1f23',
  },
  section: { marginBottom: 12 },
  label: { fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '600' },
  age: { color: '#52525b', fontSize: 11 },
  criterionText: { color: '#fafafa', fontSize: 19, fontWeight: '600', lineHeight: 26, marginTop: 12 },
  itemTitle: { color: '#a1a1aa', fontSize: 13, marginTop: 8 },
  staleCard: { borderColor: '#f59e0b40', backgroundColor: '#1a160c' },
  staleFile: { color: '#fbbf24', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
  staleHint: { color: '#a1a1aa', fontSize: 12, marginTop: 8, lineHeight: 18 },
  agentNote: { color: '#e4e4e7', fontSize: 15, lineHeight: 22 },
  evidenceCard: {
    backgroundColor: '#141416', borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1f1f23', overflow: 'hidden',
  },
  evidenceHead: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  fileName: { color: '#e4e4e7', fontSize: 14, fontWeight: '600' },
  fileWhere: { color: '#3b82f6', fontSize: 12, marginTop: 2 },
  chevron: { color: '#71717a', fontSize: 14 },
  evidenceBody: { paddingHorizontal: 14, paddingBottom: 14 },
  history: { color: '#71717a', fontSize: 12, lineHeight: 18, marginTop: 4 },
  bar: {
    borderTopWidth: 1, borderTopColor: '#27272a', backgroundColor: '#111113',
    paddingHorizontal: 16, paddingTop: 12,
  },
  buttons: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  approveBtn: { backgroundColor: '#16a34a' },
  sendBackBtn: { borderWidth: 1.5, borderColor: '#ef4444', backgroundColor: 'transparent' },
  sendBackText: { color: '#f87171', fontSize: 16, fontWeight: '700' },
  sendBackSolid: { backgroundColor: '#dc2626' },
  solidText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { backgroundColor: '#27272a', flex: 0.6 },
  cancelText: { color: '#d4d4d8', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  decideError: { color: '#fca5a5', fontSize: 13, marginBottom: 10, lineHeight: 18 },
  noteInput: {
    backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#3f3f46',
    color: '#e4e4e7', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, minHeight: 72, maxHeight: 160,
    textAlignVertical: 'top',
  },
  anchorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#52525b',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  anchorText: { color: '#a1a1aa', fontSize: 13, flex: 1 },
  doneCircle: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  doneMark: { fontSize: 30, fontWeight: '800' },
  doneTitle: { color: '#fafafa', fontSize: 20, fontWeight: '700' },
  doneBody: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  nextLabel: { color: '#71717a', fontSize: 12, fontWeight: '600', marginTop: 28, marginBottom: 10 },
  nextCard: {
    alignSelf: 'stretch', backgroundColor: '#141416', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#3b82f640',
  },
  nextText: { color: '#e4e4e7', fontSize: 15, fontWeight: '600', lineHeight: 21 },
  nextSub: { color: '#71717a', fontSize: 12, marginTop: 4 },
  nextGo: { color: '#3b82f6', fontSize: 14, fontWeight: '700', marginTop: 10, textAlign: 'right' },
  secondaryBtn: { backgroundColor: '#27272a', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10, marginTop: 20 },
  secondaryBtnText: { color: '#d4d4d8', fontSize: 15, fontWeight: '600' },
  goneTitle: { color: '#d4d4d8', fontSize: 17, fontWeight: '600', marginBottom: 8 },
  goneBody: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
