/**
 * Plan channel / discussion screen.
 *
 * The per-plan collaboration surface: lists every channel event posted
 * against a plan (the six-type peer-to-peer vocabulary — stuck,
 * need-decision, need-context, handing-off, steer, weigh-in) and lets
 * the user START a new discussion of any type from mobile. Tapping an
 * event opens the threaded event-detail view to reply / resolve.
 *
 * Channel events travel through git via the manifest, so anything
 * posted here surfaces on the desktop too — companion-app principle.
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
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';

// --- Types -------------------------------------------------------------------

interface ChannelEvent {
  uid: string;
  planUid: string;
  eventType: string;
  payload: { message?: string; [key: string]: unknown };
  author: string;
  authorType: string;
  status: string;
  respondsTo: string | null;
  createdAt: number;
}

// The six-type vocabulary (docs/cdev/08-agent-collaboration.md).
const EVENT_TYPES: Array<{ key: string; label: string; fg: string; bg: string; hint: string }> = [
  { key: 'weigh-in', label: 'Weigh-in', fg: '#3b82f6', bg: '#3b82f620', hint: "Here's my thinking — what do others see?" },
  { key: 'need-decision', label: 'Need Decision', fg: '#f59e0b', bg: '#f59e0b20', hint: "A genuine choice I can't make alone." },
  { key: 'need-context', label: 'Need Context', fg: '#8b5cf6', bg: '#8b5cf620', hint: 'Missing knowledge to proceed.' },
  { key: 'stuck', label: 'Stuck', fg: '#ef4444', bg: '#ef444420', hint: 'Failing repeatedly, need help.' },
  { key: 'steer', label: 'Steer', fg: '#22c55e', bg: '#22c55e20', hint: 'Direction in response to stuck / need-decision.' },
  { key: 'handing-off', label: 'Handing Off', fg: '#a1a1aa', bg: '#71717a20', hint: "Someone else should take over; here's what was tried." },
];

function getEventStyle(type: string) {
  return (
    EVENT_TYPES.find((t) => t.key === type) ?? {
      key: type,
      label: type,
      fg: '#a1a1aa',
      bg: '#27272a',
      hint: '',
    }
  );
}

function formatRelative(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// --- Component ---------------------------------------------------------------

export default function PlanChannelScreen() {
  const { planUid, planTitle } = useLocalSearchParams<{
    planUid: string;
    planTitle?: string;
  }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ChannelEvent[]>([]);

  const [composeText, setComposeText] = useState('');
  const [composeType, setComposeType] = useState('weigh-in');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const fetchEvents = useCallback(async () => {
    if (!planUid) return;
    try {
      setError(null);
      const list = await rpc<ChannelEvent[]>('channel.events', {
        planUid,
        limit: 100,
      });
      setEvents(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [planUid]);

  useEffect(() => {
    setLoading(true);
    fetchEvents().finally(() => setLoading(false));
  }, [fetchEvents]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEvents();
    setRefreshing(false);
  }, [fetchEvents]);

  const handlePost = useCallback(async () => {
    if (!planUid || !composeText.trim()) return;
    setSending(true);
    try {
      await rpc('channel.post', {
        planUid,
        eventType: composeType,
        message: composeText.trim(),
        author: 'mobile-user',
      });
      setComposeText('');
      await fetchEvents();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (err: unknown) {
      Alert.alert('Failed to post', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [planUid, composeType, composeText, fetchEvents]);

  // Only top-level events (replies live inside event-detail threads).
  const topLevel = events.filter((e) => !e.respondsTo);
  const composeStyle = getEventStyle(composeType);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{ title: planTitle ? `Discussion · ${planTitle}` : 'Discussion' }}
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
        }
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#3b82f6" size="large" />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchEvents}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : topLevel.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No discussion yet</Text>
            <Text style={styles.emptySubtext}>
              Start a thread below — agents and teammates will see it on the
              desktop and can reply.
            </Text>
          </View>
        ) : (
          topLevel.map((event) => {
            const color = getEventStyle(event.eventType);
            const isOpen = event.status === 'open';
            const replyCount = events.filter((e) => e.respondsTo === event.uid).length;
            return (
              <TouchableOpacity
                key={event.uid}
                style={styles.eventCard}
                activeOpacity={0.7}
                onPress={() => router.push(`/event-detail?uid=${event.uid}`)}
              >
                <View style={styles.eventHeader}>
                  <View style={[styles.eventBadge, { backgroundColor: color.bg }]}>
                    <Text style={[styles.eventBadgeText, { color: color.fg }]}>
                      {color.label}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusDot,
                      isOpen ? styles.statusOpen : styles.statusResolved,
                    ]}
                  />
                  <Text style={styles.eventTime}>
                    {formatRelative(event.createdAt)}
                  </Text>
                </View>

                {event.payload?.message ? (
                  <Text style={styles.eventMessage} numberOfLines={4}>
                    {event.payload.message}
                  </Text>
                ) : null}

                <View style={styles.eventFooter}>
                  <Text style={styles.eventMeta}>
                    {event.author}
                    {event.authorType ? ` (${event.authorType})` : ''}
                    {' · '}
                    {event.status}
                    {replyCount > 0 ? ` · ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}` : ''}
                  </Text>
                  <Text style={styles.eventChevron}>{'>'}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Composer — start a new discussion */}
      <View style={styles.composer}>
        {showTypePicker && (
          <View style={styles.typeDropdown}>
            {EVENT_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[
                  styles.typeOption,
                  t.key === composeType && styles.typeOptionActive,
                ]}
                onPress={() => {
                  setComposeType(t.key);
                  setShowTypePicker(false);
                }}
              >
                <View style={[styles.typeDot, { backgroundColor: t.fg }]} />
                <View style={styles.typeOptionBody}>
                  <Text
                    style={[
                      styles.typeOptionLabel,
                      t.key === composeType && { color: t.fg },
                    ]}
                  >
                    {t.label}
                  </Text>
                  <Text style={styles.typeOptionHint}>{t.hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.composerRow}>
          <TouchableOpacity
            style={[styles.typeChip, { backgroundColor: composeStyle.bg }]}
            onPress={() => setShowTypePicker(!showTypePicker)}
          >
            <Text style={[styles.typeChipText, { color: composeStyle.fg }]}>
              {composeStyle.label}
            </Text>
            <Text style={[styles.typeChipChevron, { color: composeStyle.fg }]}>
              {showTypePicker ? '▾' : '▴'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={composeText}
            onChangeText={setComposeText}
            placeholder={`Start a ${composeStyle.label.toLowerCase()}…`}
            placeholderTextColor="#52525b"
            multiline
            editable={!sending}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!composeText.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={handlePost}
            disabled={!composeText.trim() || sending}
          >
            <Text style={styles.sendBtnText}>{sending ? '…' : 'Post'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- Styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  center: {
    paddingVertical: 60,
    alignItems: 'center',
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

  // Empty
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: '#a1a1aa',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtext: {
    color: '#52525b',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Event cards
  eventCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  eventBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  eventBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 8,
  },
  statusOpen: {
    backgroundColor: '#f59e0b',
  },
  statusResolved: {
    backgroundColor: '#52525b',
  },
  eventTime: {
    color: '#52525b',
    fontSize: 11,
    marginLeft: 'auto',
  },
  eventMessage: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6,
  },
  eventFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eventMeta: {
    color: '#52525b',
    fontSize: 11,
    flex: 1,
  },
  eventChevron: {
    color: '#52525b',
    fontSize: 14,
    marginLeft: 8,
  },

  // Composer
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272a',
    backgroundColor: '#111113',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 28,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  typeChipChevron: {
    fontSize: 10,
  },
  typeDropdown: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    overflow: 'hidden',
    marginBottom: 8,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  typeOptionActive: {
    backgroundColor: '#27272a40',
  },
  typeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    marginRight: 10,
  },
  typeOptionBody: {
    flex: 1,
  },
  typeOptionLabel: {
    color: '#e4e4e7',
    fontSize: 13,
    fontWeight: '600',
  },
  typeOptionHint: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#18181b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#e4e4e7',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  sendBtnDisabled: {
    backgroundColor: '#27272a',
  },
  sendBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
