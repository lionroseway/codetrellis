/**
 * Plan item detail screen — view and edit a single plan item.
 *
 * Shows item title, description/body, status with quick-change picker,
 * assignee, and subtasks. Editable fields save via RPC.
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
  TextInput,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { rpc } from '../lib/rpc';
import Markdown from '../components/Markdown';
import MarkdownBody from '../components/MarkdownBody';
import CommentComposer from '../components/CommentComposer';
import ItemCreator from '../components/ItemCreator';

// --- Types -------------------------------------------------------------------

interface PlanItem {
  uid: string;
  planUid: string;
  title: string;
  body: string;
  kind: string;
  status: string | null;
  parentUid: string | null;
  sortOrder: number;
  assignee: string | null;
  assigneeType: string | null;
  template: string | null;
  scopePath: string | null;
  dependencies: string[];
  progressPercent: number | null;
  blockedReason: string | null;
}

interface ItemComment {
  uid: string;
  body: string;
  author?: string | null;
  authorType?: string | null;
  commentType?: string | null;
  createdAt: number;
  replies?: ItemComment[];
}

interface ItemExternalRef {
  uid: string;
  url: string;
  title?: string | null;
  kind?: string | null;
}

interface ItemAttachment {
  uid: string;
  kind: string;
  value: string;
  label?: string | null;
  createdAt: number;
}

interface ItemGetResult {
  item: PlanItem;
  comments?: ItemComment[];
  externalRefs?: ItemExternalRef[];
  attachments?: ItemAttachment[];
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

const STATUSES = [
  { key: 'pending', label: 'Pending', color: '#52525b' },
  { key: 'in_progress', label: 'In Progress', color: '#22c55e' },
  { key: 'assigned', label: 'Assigned', color: '#3b82f6' },
  { key: 'blocked', label: 'Blocked', color: '#ef4444' },
  { key: 'done', label: 'Done', color: '#3b82f6' },
];

function statusColor(status: string | null): string {
  const found = STATUSES.find((s) => s.key === status);
  return found?.color ?? '#52525b';
}

// --- Component ---------------------------------------------------------------

export default function ItemDetailScreen() {
  const { uid, planUid } = useLocalSearchParams<{ uid: string; planUid: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<PlanItem | null>(null);
  const [children, setChildren] = useState<PlanItem[]>([]);
  const [comments, setComments] = useState<ItemComment[]>([]);
  const [externalRefs, setExternalRefs] = useState<ItemExternalRef[]>([]);
  const [attachments, setAttachments] = useState<ItemAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [editField, setEditField] = useState<null | 'assignee' | 'blocked'>(null);
  const [draft, setDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const fetchItem = useCallback(async () => {
    if (!uid) return;
    try {
      setError(null);
      // plan.item.get now returns { item, comments, externalRefs, attachments }.
      // Tolerate the legacy bare-item shape too (older desktop builds).
      const result = await rpc<ItemGetResult | PlanItem>('plan.item.get', { uid });
      const wrapped = result as ItemGetResult;
      const bareItem = result as PlanItem;
      const resolved = wrapped.item ?? bareItem;
      setItem(resolved);
      setComments(Array.isArray(wrapped.comments) ? wrapped.comments : []);
      setExternalRefs(Array.isArray(wrapped.externalRefs) ? wrapped.externalRefs : []);
      setAttachments(Array.isArray(wrapped.attachments) ? wrapped.attachments : []);

      // Fetch children (subtasks)
      if (planUid) {
        const allItems = await rpc<PlanItem[]>('plan.items', { planUid });
        setChildren(
          (Array.isArray(allItems) ? allItems : [])
            .filter((i) => i.parentUid === uid)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [uid, planUid]);

  useEffect(() => {
    setLoading(true);
    fetchItem().finally(() => setLoading(false));
  }, [fetchItem]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItem();
    setRefreshing(false);
  }, [fetchItem]);

  // Refetch when returning from the body editor (skip the first focus).
  const didMount = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (didMount.current) fetchItem();
      else didMount.current = true;
    }, [fetchItem]),
  );

  // Generic field patch (assignee / blocked / progress).
  const patchItem = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!uid) return;
      setSaving(true);
      try {
        const updated = await rpc<PlanItem>('plan.item.update', { uid, ...patch });
        setItem(updated);
      } catch (err: unknown) {
        Alert.alert('Update failed', err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [uid],
  );

  const updateStatus = useCallback(
    async (newStatus: string) => {
      if (!uid || !item) return;
      setSaving(true);
      setShowStatusPicker(false);
      try {
        const updated = await rpc<PlanItem>('plan.item.update', {
          uid,
          status: newStatus,
        });
        setItem(updated);
      } catch (err: unknown) {
        Alert.alert('Update failed', err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [uid, item],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" size="large" />
        <Text style={styles.loadingText}>Loading item...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchItem}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!item) return null;

  const currentStatus = item.status ?? 'pending';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
      }
    >
      {/* Kind badge */}
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindText}>{item.kind}</Text>
        </View>
        {item.template && (
          <Text style={styles.templateText}>{item.template}</Text>
        )}
      </View>

      {/* Title */}
      {editingTitle ? (
        <View style={styles.titleEditRow}>
          <TextInput
            style={styles.titleInput}
            value={titleDraft}
            onChangeText={setTitleDraft}
            autoFocus
            multiline
            placeholder="Title"
            placeholderTextColor="#52525b"
          />
          <View style={styles.editActions}>
            <TouchableOpacity onPress={() => setEditingTitle(false)} hitSlop={8}>
              <Text style={styles.cancelLink}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveChip}
              onPress={async () => {
                if (titleDraft.trim()) await patchItem({ title: titleDraft.trim() });
                setEditingTitle(false);
              }}
            >
              <Text style={styles.saveChipText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => { setTitleDraft(item.title); setEditingTitle(true); }}
        >
          <Text style={styles.title}>{item.title}</Text>
        </TouchableOpacity>
      )}

      {/* Status picker */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>STATUS</Text>
        <TouchableOpacity
          style={styles.statusButton}
          onPress={() => setShowStatusPicker(!showStatusPicker)}
          disabled={saving}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor(currentStatus) }]} />
          <Text style={styles.statusValue}>
            {saving ? 'Saving...' : currentStatus.replace(/_/g, ' ')}
          </Text>
          <Text style={styles.statusChevron}>{showStatusPicker ? '^' : 'v'}</Text>
        </TouchableOpacity>

        {showStatusPicker && (
          <View style={styles.statusPicker}>
            {STATUSES.map((s) => (
              <TouchableOpacity
                key={s.key}
                style={[
                  styles.statusOption,
                  s.key === currentStatus && styles.statusOptionActive,
                ]}
                onPress={() => updateStatus(s.key)}
              >
                <View style={[styles.statusDot, { backgroundColor: s.color }]} />
                <Text
                  style={[
                    styles.statusOptionText,
                    s.key === currentStatus && styles.statusOptionTextActive,
                  ]}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Assignee (editable) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>ASSIGNEE</Text>
          {editField !== 'assignee' && (
            <TouchableOpacity
              onPress={() => { setDraft(item.assignee ?? ''); setEditField('assignee'); }}
            >
              <Text style={styles.editLink}>{item.assignee ? 'Edit' : 'Set'}</Text>
            </TouchableOpacity>
          )}
        </View>
        {editField === 'assignee' ? (
          <View>
            <TextInput
              style={styles.fieldInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="name or email"
              placeholderTextColor="#52525b"
              autoCapitalize="none"
              autoFocus
            />
            <View style={styles.editActions}>
              <TouchableOpacity onPress={() => setEditField(null)} hitSlop={8}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveChip}
                onPress={async () => { await patchItem({ assignee: draft.trim() || null }); setEditField(null); }}
              >
                <Text style={styles.saveChipText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.assigneeRow}>
            <Text style={item.assignee ? styles.assigneeText : styles.assigneeEmpty}>
              {item.assignee || 'Unassigned'}
            </Text>
            {item.assigneeType && (
              <Text style={styles.assigneeType}>{item.assigneeType}</Text>
            )}
          </View>
        )}
      </View>

      {/* Progress (editable stepper for actions) */}
      {item.kind === 'action' && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PROGRESS</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${item.progressPercent ?? 0}%` }]} />
          </View>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              disabled={saving}
              onPress={() => patchItem({ progressPercent: Math.max(0, (item.progressPercent ?? 0) - 10) })}
            >
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.progressText}>{item.progressPercent ?? 0}%</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              disabled={saving}
              onPress={() => patchItem({ progressPercent: Math.min(100, (item.progressPercent ?? 0) + 10) })}
            >
              <Text style={styles.stepText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Blocked (editable for actions) */}
      {item.kind === 'action' && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>BLOCKED</Text>
            {editField !== 'blocked' && (
              <View style={styles.blockedActions}>
                {item.status === 'blocked' ? (
                  <TouchableOpacity onPress={() => patchItem({ status: 'pending', blockedReason: null })}>
                    <Text style={styles.editLink}>Unblock</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => { setDraft(item.blockedReason ?? ''); setEditField('blocked'); }}
                  >
                    <Text style={styles.blockLink}>Mark blocked</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          {editField === 'blocked' ? (
            <View>
              <TextInput
                style={styles.fieldInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="What's blocking this?"
                placeholderTextColor="#52525b"
                multiline
                autoFocus
              />
              <View style={styles.editActions}>
                <TouchableOpacity onPress={() => setEditField(null)} hitSlop={8}>
                  <Text style={styles.cancelLink}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveChip}
                  onPress={async () => { await patchItem({ status: 'blocked', blockedReason: draft.trim() }); setEditField(null); }}
                >
                  <Text style={styles.saveChipText}>Block</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : item.blockedReason ? (
            <View style={styles.blockedCard}>
              <Text style={styles.blockedText}>{item.blockedReason}</Text>
            </View>
          ) : (
            <Text style={styles.assigneeEmpty}>Not blocked</Text>
          )}
        </View>
      )}

      {/* Description / Body (markdown — editable, reads like the desktop page) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>DESCRIPTION</Text>
          <TouchableOpacity
            onPress={() =>
              router.push(
                `/body-editor?target=item&uid=${uid}&planUid=${planUid}&label=${encodeURIComponent('Edit description')}`,
              )
            }
          >
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {item.body && item.body.trim().length > 0 ? (
          <View style={styles.bodyCard}>
            <MarkdownBody source={item.body} planUid={planUid} />
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addBodyCard}
            onPress={() =>
              router.push(
                `/body-editor?target=item&uid=${uid}&planUid=${planUid}&label=${encodeURIComponent('Edit description')}`,
              )
            }
          >
            <Text style={styles.addBodyText}>＋ Add a description</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Scope path */}
      {item.scopePath && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SCOPE</Text>
          <Text style={styles.scopeText}>{item.scopePath}</Text>
        </View>
      )}

      {/* Dependencies */}
      {item.dependencies && item.dependencies.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            DEPENDENCIES ({item.dependencies.length})
          </Text>
          {item.dependencies.map((depUid) => (
            <TouchableOpacity
              key={depUid}
              style={styles.depCard}
              onPress={() =>
                router.push(`/item-detail?uid=${depUid}&planUid=${planUid}`)
              }
            >
              <Text style={styles.depText} numberOfLines={1}>
                {depUid}
              </Text>
              <Text style={styles.depAction}>View</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Subtasks / children */}
      <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            SUBTASKS{children.length > 0 ? ` (${children.length})` : ''}
          </Text>
          {children.map((child) => (
            <TouchableOpacity
              key={child.uid}
              style={styles.childCard}
              activeOpacity={0.7}
              onPress={() =>
                router.push(`/item-detail?uid=${child.uid}&planUid=${planUid}`)
              }
            >
              <View
                style={[
                  styles.childDot,
                  { backgroundColor: statusColor(child.status) },
                ]}
              />
              <View style={styles.childBody}>
                <Text
                  style={[
                    styles.childTitle,
                    (child.status === 'done' || child.status === 'completed') &&
                      styles.childTitleDone,
                  ]}
                  numberOfLines={2}
                >
                  {child.title}
                </Text>
                <Text style={styles.childMeta}>
                  {(child.status ?? 'pending').replace(/_/g, ' ')}
                  {child.assignee ? ` · ${child.assignee}` : ''}
                </Text>
              </View>
              <Text style={styles.childChevron}>&gt;</Text>
            </TouchableOpacity>
          ))}
          {planUid && (
            <ItemCreator
              planUid={planUid}
              parentUid={uid}
              allowKindToggle={false}
              defaultKind="action"
              label="＋ Add subtask"
              onCreated={() => fetchItem()}
            />
          )}
      </View>

      {/* External references / links */}
      {externalRefs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LINKS ({externalRefs.length})</Text>
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

      {/* Attachments */}
      {attachments.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ATTACHMENTS ({attachments.length})</Text>
          {attachments.map((att) => (
            <View key={att.uid} style={styles.refCard}>
              <Text style={styles.refKind}>{att.kind.toUpperCase()}</Text>
              <View style={styles.refBody}>
                <Text style={styles.refTitle} numberOfLines={1}>
                  {att.label || att.value}
                </Text>
                {!!att.label && (
                  <Text style={styles.refUrl} numberOfLines={1}>
                    {att.value}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Discussion / comments */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          DISCUSSION{comments.length > 0 ? ` (${comments.length})` : ''}
        </Text>
        {comments.map((c) => (
          <ItemCommentThread key={c.uid} comment={c} depth={0} />
        ))}
        <CommentComposer targetType="item" targetUid={uid!} onPosted={() => fetchItem()} />
      </View>
    </ScrollView>
  );
}

// --- Comment thread (recursive) ----------------------------------------------

function ItemCommentThread({
  comment,
  depth,
}: {
  comment: ItemComment;
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
        <ItemCommentThread key={r.uid} comment={r} depth={depth + 1} />
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

  // Kind badge
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  kindBadge: {
    backgroundColor: '#27272a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  kindText: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  templateText: {
    color: '#52525b',
    fontSize: 11,
  },

  // Title
  title: {
    color: '#e4e4e7',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 16,
  },
  titleEditRow: { marginBottom: 16 },
  titleInput: {
    color: '#e4e4e7',
    fontSize: 20,
    fontWeight: '700',
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3b82f6',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  // Sections
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editLink: { color: '#3b82f6', fontSize: 13, fontWeight: '600', marginBottom: 8 },
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
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: '#e4e4e7', fontSize: 18, fontWeight: '700' },

  // Status
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusValue: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    textTransform: 'capitalize',
  },
  statusChevron: {
    color: '#52525b',
    fontSize: 14,
  },
  statusPicker: {
    marginTop: 6,
    backgroundColor: '#18181b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    overflow: 'hidden',
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  statusOptionActive: {
    backgroundColor: '#3b82f610',
  },
  statusOptionText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '500',
  },
  statusOptionTextActive: {
    color: '#3b82f6',
    fontWeight: '600',
  },

  // Assignee
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assigneeText: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
  },
  assigneeEmpty: {
    color: '#52525b',
    fontSize: 14,
    fontStyle: 'italic',
  },
  assigneeType: {
    color: '#52525b',
    fontSize: 12,
  },

  // Inline field editing
  fieldInput: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#e4e4e7',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 8,
  },
  cancelLink: { color: '#a1a1aa', fontSize: 14 },
  saveChip: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  saveChipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  blockedActions: { flexDirection: 'row' },
  blockLink: { color: '#ef4444', fontSize: 13, fontWeight: '600' },

  // Progress
  progressBar: {
    height: 6,
    backgroundColor: '#27272a',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 3,
  },
  progressText: {
    color: '#71717a',
    fontSize: 12,
  },

  // Blocked
  blockedCard: {
    backgroundColor: '#1c1017',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ef444430',
  },
  blockedText: {
    color: '#ef4444',
    fontSize: 13,
    lineHeight: 18,
  },

  // Body / description
  bodyCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  bodyText: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 22,
  },

  // Scope
  scopeText: {
    color: '#71717a',
    fontSize: 13,
    fontFamily: 'Menlo',
  },

  // Dependencies
  depCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  depText: {
    color: '#a1a1aa',
    fontSize: 12,
    fontFamily: 'Menlo',
    flex: 1,
  },
  depAction: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },

  // Children / subtasks
  childCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  childDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  childBody: {
    flex: 1,
  },
  childTitle: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  childTitleDone: {
    color: '#52525b',
    textDecorationLine: 'line-through',
  },
  childMeta: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  childChevron: {
    color: '#52525b',
    fontSize: 14,
    marginLeft: 8,
  },

  // External ref / attachment cards
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
});
