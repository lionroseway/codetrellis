/**
 * Plan detail screen — shows full plan data fetched via RPC.
 *
 * Navigated to from the Plans tab when tapping a plan card.
 * Uses `plan.get` RPC to fetch items, deviations, and channel events
 * from the desktop in real-time.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { rpc } from '../lib/rpc';
import Markdown from '../components/Markdown';
import MarkdownBody from '../components/MarkdownBody';
import CommentComposer from '../components/CommentComposer';

// --- Types (from desktop plan-service / plan-item-service) -------------------

interface PlanDetail {
  uid: string;
  title: string;
  status: string;
  description?: string | null;
  projectPath: string;
  createdAt: number;
  updatedAt: number | null;
}

interface PlanItem {
  uid: string;
  planUid: string;
  title: string;
  status: string;
  type: string;
  parentUid: string | null;
  sortOrder: number;
  assignee: string | null;
  description: string | null;
}

interface Deviation {
  id: number;
  planUid: string;
  type: string;
  summary: string;
  resolution: string | null;
  createdAt: number;
}

interface PlanPhase {
  uid: string;
  title: string;
  status?: string | null;
  phaseNumber?: number;
  scope?: string;
  acceptanceCriteria?: string;
}

interface PlanDocSummary {
  uid: string;
  docType: string;
  title: string;
  version?: number;
  bodyLength?: number;
  updatedAt?: number | null;
}

interface ExternalRef {
  uid: string;
  url: string;
  title?: string | null;
  kind?: string | null;
}

interface PlanComment {
  uid: string;
  body: string;
  author?: string | null;
  authorType?: string | null;
  commentType?: string | null;
  createdAt: number;
  replies?: PlanComment[];
}

interface PlanGetResult {
  plan: PlanDetail;
  items: PlanItem[];
  deviations: Deviation[];
  phases?: PlanPhase[];
  documents?: PlanDocSummary[];
  externalRefs?: ExternalRef[];
  comments?: PlanComment[];
}

// --- Status helpers ----------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'done':
    case 'completed':
      return '#3b82f6';
    case 'in_progress':
    case 'assigned':
      return '#22c55e';
    case 'blocked':
      return '#ef4444';
    default:
      return '#52525b';
  }
}

function deviationTypeColor(type: string): string {
  switch (type) {
    case 'scope_creep':
      return '#f59e0b';
    case 'off_plan':
      return '#ef4444';
    case 'skipped':
      return '#8b5cf6';
    default:
      return '#71717a';
  }
}

function phaseStatusColor(status?: string | null): string {
  switch (status) {
    case 'complete':
    case 'completed':
    case 'done':
      return '#3b82f6';
    case 'in_progress':
    case 'active':
      return '#22c55e';
    case 'blocked':
      return '#ef4444';
    default:
      return '#52525b';
  }
}

function docTypeLabel(docType: string): string {
  return docType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function relTime(ts?: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// --- Component ---------------------------------------------------------------

export default function PlanDetailScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlanGetResult | null>(null);

  const fetchPlan = useCallback(async () => {
    if (!uid) return;
    try {
      setError(null);
      const result = await rpc<PlanGetResult>('plan.get', { uid });
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [uid]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchPlan().finally(() => setLoading(false));
  }, [fetchPlan]);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPlan();
    setRefreshing(false);
  }, [fetchPlan]);

  // Refetch when returning from the body editor (skip the initial focus —
  // the mount effect already loaded it).
  const didMount = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (didMount.current) fetchPlan();
      else didMount.current = true;
    }, [fetchPlan]),
  );

  // Resolve deviation
  const resolveDeviation = useCallback(
    async (id: number, resolution: 'accepted' | 'reverted' | 'ignored') => {
      try {
        await rpc('deviation.resolve', { id, resolution });
        // Refetch to update
        await fetchPlan();
      } catch {
        // Silently ignore — the user can pull to refresh
      }
    },
    [fetchPlan],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" size="large" />
        <Text style={styles.loadingText}>Loading plan...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchPlan}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;

  const { plan, items, deviations } = data;
  const phases = data.phases ?? [];
  const documents = data.documents ?? [];
  const externalRefs = data.externalRefs ?? [];
  const comments = data.comments ?? [];
  const totalItems = items.length;
  const doneItems = items.filter((i) => i.status === 'done' || i.status === 'completed').length;
  const inProgress = items.filter((i) => i.status === 'in_progress' || i.status === 'assigned').length;
  const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
  const pendingDeviations = deviations.filter((d) => !d.resolution);

  // Group items by parent (null = top-level)
  const topLevelItems = items
    .filter((i) => !i.parentUid)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const childrenOf = (parentUid: string) =>
    items
      .filter((i) => i.parentUid === parentUid)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#3b82f6"
        />
      }
    >
      {/* Plan header */}
      <Text style={styles.planTitle}>{plan.title}</Text>
      <View style={styles.metaRow}>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                plan.status === 'active' || plan.status === 'in_progress'
                  ? '#22c55e20'
                  : plan.status === 'completed' || plan.status === 'done'
                    ? '#3b82f620'
                    : '#71717a20',
            },
          ]}
        >
          <Text style={styles.statusText}>{plan.status}</Text>
        </View>
        <Text style={styles.metaText}>
          {doneItems}/{totalItems} done
          {inProgress > 0 ? ` · ${inProgress} active` : ''}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>

      {/* Discussion entry point */}
      <TouchableOpacity
        style={styles.discussionBtn}
        activeOpacity={0.7}
        onPress={() =>
          router.push(
            `/plan-channel?planUid=${plan.uid}&planTitle=${encodeURIComponent(plan.title)}`,
          )
        }
      >
        <Text style={styles.discussionIcon}>{'\u{1F4AC}'}</Text>
        <View style={styles.discussionBody}>
          <Text style={styles.discussionTitle}>Discussion</Text>
          <Text style={styles.discussionSub}>
            Channel threads · ask, decide, steer, hand off
          </Text>
        </View>
        <Text style={styles.itemChevron}>&gt;</Text>
      </TouchableOpacity>

      {/* Plan overview (editable markdown body) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>OVERVIEW</Text>
          <TouchableOpacity
            onPress={() =>
              router.push(
                `/body-editor?target=plan&uid=${plan.uid}&label=${encodeURIComponent('Plan overview')}`,
              )
            }
          >
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {plan.description && plan.description.trim().length > 0 ? (
          <View style={styles.markdownCard}>
            <MarkdownBody source={plan.description} planUid={plan.uid} />
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addBodyCard}
            onPress={() =>
              router.push(
                `/body-editor?target=plan&uid=${plan.uid}&label=${encodeURIComponent('Plan overview')}`,
              )
            }
          >
            <Text style={styles.addBodyText}>＋ Add an overview</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Pending deviations */}
      {pendingDeviations.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            DEVIATIONS ({pendingDeviations.length})
          </Text>
          {pendingDeviations.map((dev) => (
            <View key={dev.id} style={styles.deviationCard}>
              <View style={styles.devHeader}>
                <View
                  style={[
                    styles.devTypeBadge,
                    { backgroundColor: deviationTypeColor(dev.type) + '20' },
                  ]}
                >
                  <Text
                    style={[
                      styles.devTypeText,
                      { color: deviationTypeColor(dev.type) },
                    ]}
                  >
                    {dev.type.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>
              <Text style={styles.devSummary}>{dev.summary}</Text>
              <View style={styles.devActions}>
                <TouchableOpacity
                  style={[styles.devBtn, styles.devBtnAccept]}
                  onPress={() => resolveDeviation(dev.id, 'accepted')}
                >
                  <Text style={styles.devBtnText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devBtn, styles.devBtnIgnore]}
                  onPress={() => resolveDeviation(dev.id, 'ignored')}
                >
                  <Text style={styles.devBtnText}>Ignore</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devBtn, styles.devBtnRevert]}
                  onPress={() => resolveDeviation(dev.id, 'reverted')}
                >
                  <Text style={styles.devBtnText}>Revert</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Spec documents */}
      {documents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SPEC DOCS ({documents.length})</Text>
          {documents.map((doc) => (
            <TouchableOpacity
              key={doc.uid}
              style={styles.docCard}
              activeOpacity={0.7}
              onPress={() =>
                router.push(
                  `/doc-viewer?docUid=${doc.uid}&title=${encodeURIComponent(doc.title)}`,
                )
              }
            >
              <Text style={styles.docIcon}>{'\u{1F4C4}'}</Text>
              <View style={styles.docBody}>
                <Text style={styles.docTitle} numberOfLines={2}>
                  {doc.title}
                </Text>
                <Text style={styles.docMeta}>
                  {docTypeLabel(doc.docType)}
                  {doc.version ? ` · v${doc.version}` : ''}
                  {doc.updatedAt ? ` · ${relTime(doc.updatedAt)}` : ''}
                </Text>
              </View>
              <Text style={styles.itemChevron}>&gt;</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Phases */}
      {phases.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PHASES ({phases.length})</Text>
          {phases
            .slice()
            .sort((a, b) => (a.phaseNumber ?? 0) - (b.phaseNumber ?? 0))
            .map((phase) => (
              <View key={phase.uid} style={styles.phaseCard}>
                <View
                  style={[
                    styles.phaseDot,
                    { backgroundColor: phaseStatusColor(phase.status) },
                  ]}
                />
                <View style={styles.phaseBody}>
                  <Text style={styles.phaseTitle} numberOfLines={2}>
                    {phase.phaseNumber != null ? `${phase.phaseNumber}. ` : ''}
                    {phase.title}
                  </Text>
                  {!!phase.status && (
                    <Text style={styles.phaseMeta}>{phase.status}</Text>
                  )}
                </View>
              </View>
            ))}
        </View>
      )}

      {/* Plan items */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ITEMS ({totalItems})</Text>
        {topLevelItems.map((item) => {
          const children = childrenOf(item.uid);
          return (
            <View key={item.uid}>
              <TouchableOpacity
                style={styles.itemCard}
                activeOpacity={0.7}
                onPress={() =>
                  router.push(`/item-detail?uid=${item.uid}&planUid=${plan.uid}`)
                }
              >
                <View
                  style={[
                    styles.itemDot,
                    { backgroundColor: statusColor(item.status) },
                  ]}
                />
                <View style={styles.itemBody}>
                  <Text
                    style={[
                      styles.itemTitle,
                      (item.status === 'done' || item.status === 'completed') &&
                        styles.itemTitleDone,
                    ]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {item.status}
                    {item.assignee ? ` · ${item.assignee}` : ''}
                  </Text>
                </View>
                <Text style={styles.itemChevron}>&gt;</Text>
              </TouchableOpacity>

              {/* Subtasks */}
              {children.map((child) => (
                <TouchableOpacity
                  key={child.uid}
                  style={styles.subItemCard}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push(`/item-detail?uid=${child.uid}&planUid=${plan.uid}`)
                  }
                >
                  <View
                    style={[
                      styles.itemDot,
                      styles.subItemDot,
                      { backgroundColor: statusColor(child.status) },
                    ]}
                  />
                  <View style={styles.itemBody}>
                    <Text
                      style={[
                        styles.subItemTitle,
                        (child.status === 'done' ||
                          child.status === 'completed') &&
                          styles.itemTitleDone,
                      ]}
                      numberOfLines={2}
                    >
                      {child.title}
                    </Text>
                    <Text style={styles.itemMeta}>{child.status}</Text>
                  </View>
                  <Text style={styles.itemChevron}>&gt;</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}

        {totalItems === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No items in this plan yet</Text>
          </View>
        )}
      </View>

      {/* External references / links */}
      {externalRefs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>LINKS ({externalRefs.length})</Text>
          {externalRefs.map((ref) => (
            <View key={ref.uid} style={styles.refCard}>
              <Text style={styles.refKind}>
                {(ref.kind ?? 'link').toUpperCase()}
              </Text>
              <View style={styles.refBody}>
                <Text style={styles.refTitle} numberOfLines={1}>
                  {ref.title || ref.url}
                </Text>
                <Text style={styles.refUrl} numberOfLines={1}>
                  {ref.url}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Discussion / comments */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          DISCUSSION{comments.length > 0 ? ` (${comments.length})` : ''}
        </Text>
        {comments.map((c) => (
          <CommentThread key={c.uid} comment={c} depth={0} />
        ))}
        <CommentComposer
          targetType="plan"
          targetUid={plan.uid}
          onPosted={() => fetchPlan()}
        />
      </View>
    </ScrollView>
  );
}

// --- Comment thread (recursive) ----------------------------------------------

function CommentThread({
  comment,
  depth,
}: {
  comment: PlanComment;
  depth: number;
}) {
  const isAgent = comment.authorType && comment.authorType !== 'human';
  return (
    <View style={[styles.commentCard, depth > 0 && styles.commentReply]}>
      <View style={styles.commentHeader}>
        <View
          style={[
            styles.commentDot,
            { backgroundColor: isAgent ? '#8b5cf6' : '#3b82f6' },
          ]}
        />
        <Text style={styles.commentAuthor}>
          {comment.author || (isAgent ? 'agent' : 'you')}
        </Text>
        {!!comment.commentType && comment.commentType !== 'comment' && (
          <Text style={styles.commentType}>{comment.commentType}</Text>
        )}
        <Text style={styles.commentTime}>{relTime(comment.createdAt)}</Text>
      </View>
      <Markdown compact>{comment.body}</Markdown>
      {comment.replies?.map((r) => (
        <CommentThread key={r.uid} comment={r} depth={depth + 1} />
      ))}
    </View>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    color: '#71717a',
    fontSize: 14,
    marginTop: 12,
  },
  errorIcon: {
    fontSize: 36,
    color: '#ef4444',
    fontWeight: '700',
    marginBottom: 12,
  },
  errorText: {
    color: '#a1a1aa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: '#3b82f620',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  retryText: {
    color: '#3b82f6',
    fontWeight: '600',
    fontSize: 14,
  },

  // Plan header
  planTitle: {
    color: '#e4e4e7',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#a1a1aa',
    textTransform: 'capitalize',
  },
  metaText: {
    color: '#71717a',
    fontSize: 13,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#27272a',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 24,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 3,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Deviation cards
  deviationCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f59e0b30',
  },
  devHeader: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  devTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  devTypeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  devSummary: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  devActions: {
    flexDirection: 'row',
    gap: 8,
  },
  devBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
  },
  devBtnAccept: {
    backgroundColor: '#22c55e15',
    borderColor: '#22c55e40',
  },
  devBtnIgnore: {
    backgroundColor: '#71717a15',
    borderColor: '#71717a40',
  },
  devBtnRevert: {
    backgroundColor: '#ef444415',
    borderColor: '#ef444440',
  },
  devBtnText: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
  },

  // Item cards
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  subItemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#141416',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
    marginLeft: 20,
    borderWidth: 1,
    borderColor: '#1f1f23',
  },
  itemDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
    marginRight: 10,
  },
  subItemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  itemBody: {
    flex: 1,
  },
  itemTitle: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  subItemTitle: {
    color: '#d4d4d8',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  itemTitleDone: {
    color: '#52525b',
    textDecorationLine: 'line-through',
  },
  itemMeta: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  itemChevron: {
    color: '#52525b',
    fontSize: 14,
    marginLeft: 8,
    alignSelf: 'center',
  },

  // Discussion entry point
  discussionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#3b82f640',
  },
  discussionIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  discussionBody: {
    flex: 1,
  },
  discussionTitle: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
  },
  discussionSub: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },

  // Editable-section affordances
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  editLink: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
  addBodyCard: {
    backgroundColor: '#141416',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#3f3f46',
    alignItems: 'center',
  },
  addBodyText: { color: '#71717a', fontSize: 13, fontWeight: '500' },

  // Markdown body card (plan overview)
  markdownCard: {
    backgroundColor: '#141416',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#27272a',
  },

  // Spec doc cards
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  docIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  docBody: {
    flex: 1,
  },
  docTitle: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  docMeta: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
  },

  // Phase cards
  phaseCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
    marginRight: 10,
  },
  phaseBody: {
    flex: 1,
  },
  phaseTitle: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  phaseMeta: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'capitalize',
  },

  // External ref cards
  refCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  refKind: {
    color: '#8b5cf6',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginRight: 10,
    minWidth: 48,
  },
  refBody: {
    flex: 1,
  },
  refTitle: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '500',
  },
  refUrl: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
  },

  // Comment cards
  commentCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  commentReply: {
    marginLeft: 20,
    backgroundColor: '#141416',
    borderColor: '#1f1f23',
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  commentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  commentAuthor: {
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '600',
  },
  commentType: {
    color: '#8b5cf6',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  commentTime: {
    color: '#52525b',
    fontSize: 11,
    marginLeft: 'auto',
  },
  commentBody: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 19,
  },

  // Empty
  emptyCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  emptyText: {
    color: '#52525b',
    fontSize: 13,
  },
});
