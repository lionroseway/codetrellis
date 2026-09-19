/**
 * Channel event detail screen — view event + thread, reply, resolve.
 *
 * Shows the full event with its thread of replies. Users can:
 *   - Reply to the event (any of the 6 event types)
 *   - Resolve/close open events (stuck, need-decision, etc.)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';
import Markdown from '../components/Markdown';

// --- Types -------------------------------------------------------------------

interface ChannelEvent {
  uid: string;
  planUid: string;
  eventType: string;
  payload: { message?: string; [key: string]: unknown };
  author: string;
  authorType: string;
  status: string;
  parentUid: string | null;
  createdAt: string;
}

const EVENT_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  stuck: { bg: '#ef444420', fg: '#ef4444', label: 'Stuck' },
  'need-decision': { bg: '#f59e0b20', fg: '#f59e0b', label: 'Need Decision' },
  'need-context': { bg: '#8b5cf620', fg: '#8b5cf6', label: 'Need Context' },
  steer: { bg: '#22c55e20', fg: '#22c55e', label: 'Steer' },
  'weigh-in': { bg: '#3b82f620', fg: '#3b82f6', label: 'Weigh-in' },
  'handing-off': { bg: '#71717a20', fg: '#a1a1aa', label: 'Handing Off' },
  offer: { bg: '#06b6d420', fg: '#06b6d4', label: 'Offer' },
};

const REPLY_TYPES = [
  { key: 'steer', label: 'Steer' },
  { key: 'weigh-in', label: 'Weigh-in' },
  { key: 'need-context', label: 'Need Context' },
  { key: 'offer', label: 'Offer' },
];

function getEventStyle(type: string) {
  return EVENT_COLORS[type] ?? { bg: '#27272a', fg: '#a1a1aa', label: type };
}

function formatRelative(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// --- Component ---------------------------------------------------------------

export default function EventDetailScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const router = useRouter();
  // Explicit, guaranteed back — the default header back was unreliable here.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/activity');
  }, [router]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<ChannelEvent | null>(null);
  const [thread, setThread] = useState<ChannelEvent[]>([]);
  const [replyText, setReplyText] = useState('');
  const [replyType, setReplyType] = useState('steer');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const fetchEvent = useCallback(async () => {
    if (!uid) return;
    try {
      setError(null);
      const ev = await rpc<ChannelEvent>('channel.get', { uid });
      setEvent(ev);
      const replies = await rpc<ChannelEvent[]>('channel.thread', { rootUid: uid });
      setThread(replies.filter((r) => r.uid !== uid));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [uid]);

  useEffect(() => {
    setLoading(true);
    fetchEvent().finally(() => setLoading(false));
  }, [fetchEvent]);

  const handleReply = useCallback(async () => {
    if (!event || !replyText.trim()) return;
    setSending(true);
    try {
      await rpc('channel.post', {
        planUid: event.planUid,
        eventType: replyType,
        message: replyText.trim(),
        parentUid: event.uid,
        author: 'mobile-user',
      });
      setReplyText('');
      await fetchEvent();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (err: unknown) {
      Alert.alert('Failed to send', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [event, replyText, replyType, fetchEvent]);

  const handleResolve = useCallback(async () => {
    if (!event) return;
    setResolving(true);
    try {
      await rpc('channel.resolve', { uid: event.uid, status: 'resolved' });
      await fetchEvent();
    } catch (err: unknown) {
      Alert.alert('Failed to resolve', err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }, [event, fetchEvent]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchEvent}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!event) return null;

  const color = getEventStyle(event.eventType);
  const isOpen = event.status === 'open';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          headerLeft: () => (
            <TouchableOpacity onPress={goBack} hitSlop={16} style={{ paddingHorizontal: 4 }}>
              <Text style={{ color: '#e4e4e7', fontSize: 30, marginTop: -2 }}>‹</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {/* Root event */}
        <View style={[styles.eventCard, { borderColor: color.fg + '30' }]}>
          <View style={styles.eventHeader}>
            <View style={[styles.eventBadge, { backgroundColor: color.bg }]}>
              <Text style={[styles.eventBadgeText, { color: color.fg }]}>
                {color.label}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                isOpen ? styles.statusOpen : styles.statusResolved,
              ]}
            >
              <Text style={[styles.statusPillText, isOpen ? styles.statusOpenText : styles.statusResolvedText]}>
                {event.status}
              </Text>
            </View>
          </View>

          <View style={styles.eventMessage}>
            <Markdown compact>{event.payload?.message ?? '(no message)'}</Markdown>
          </View>

          <View style={styles.eventMeta}>
            <Text style={styles.metaText}>
              {event.author}
              {event.authorType ? ` (${event.authorType})` : ''}
            </Text>
            <Text style={styles.metaTime}>{formatRelative(event.createdAt)}</Text>
          </View>

          {/* Resolve button */}
          {isOpen && (
            <TouchableOpacity
              style={styles.resolveBtn}
              onPress={handleResolve}
              disabled={resolving}
            >
              <Text style={styles.resolveBtnText}>
                {resolving ? 'Resolving...' : 'Mark Resolved'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Thread replies */}
        {thread.length > 0 && (
          <View style={styles.threadSection}>
            <Text style={styles.threadLabel}>
              REPLIES ({thread.length})
            </Text>
            {thread.map((reply) => {
              const rc = getEventStyle(reply.eventType);
              return (
                <View key={reply.uid} style={styles.replyCard}>
                  <View style={styles.replyHeader}>
                    <View style={[styles.replyBadge, { backgroundColor: rc.bg }]}>
                      <Text style={[styles.replyBadgeText, { color: rc.fg }]}>
                        {rc.label}
                      </Text>
                    </View>
                    <Text style={styles.replyTime}>
                      {formatRelative(reply.createdAt)}
                    </Text>
                  </View>
                  <View style={styles.replyMessage}>
                    <Markdown compact>{reply.payload?.message ?? ''}</Markdown>
                  </View>
                  <Text style={styles.replyAuthor}>
                    {reply.author}
                    {reply.authorType ? ` (${reply.authorType})` : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Reply composer */}
      <View style={styles.composer}>
        {/* Type picker toggle */}
        <TouchableOpacity
          style={styles.typePicker}
          onPress={() => setShowTypePicker(!showTypePicker)}
        >
          <Text style={[styles.typePickerText, { color: getEventStyle(replyType).fg }]}>
            {getEventStyle(replyType).label}
          </Text>
          <Text style={styles.typePickerChevron}>v</Text>
        </TouchableOpacity>

        {showTypePicker && (
          <View style={styles.typePickerDropdown}>
            {REPLY_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[
                  styles.typeOption,
                  t.key === replyType && styles.typeOptionActive,
                ]}
                onPress={() => {
                  setReplyType(t.key);
                  setShowTypePicker(false);
                }}
              >
                <View
                  style={[
                    styles.typeOptionDot,
                    { backgroundColor: getEventStyle(t.key).fg },
                  ]}
                />
                <Text style={styles.typeOptionText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={replyText}
            onChangeText={setReplyText}
            placeholder="Reply..."
            placeholderTextColor="#52525b"
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!replyText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleReply}
            disabled={!replyText.trim() || sending}
          >
            <Text style={styles.sendBtnText}>{sending ? '...' : 'Send'}</Text>
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
    paddingBottom: 16,
  },
  center: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
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
  },

  // Root event
  eventCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eventBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  eventBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusOpen: {
    backgroundColor: '#f59e0b20',
  },
  statusResolved: {
    backgroundColor: '#52525b20',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  statusOpenText: {
    color: '#f59e0b',
  },
  statusResolvedText: {
    color: '#71717a',
  },
  eventMessage: {
    color: '#e4e4e7',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  eventMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaText: {
    color: '#71717a',
    fontSize: 12,
  },
  metaTime: {
    color: '#52525b',
    fontSize: 11,
  },
  resolveBtn: {
    marginTop: 12,
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resolveBtnText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '600',
  },

  // Thread
  threadSection: {
    marginBottom: 16,
  },
  threadLabel: {
    fontSize: 11,
    color: '#71717a',
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  replyCard: {
    backgroundColor: '#141416',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1f1f23',
    marginLeft: 12,
  },
  replyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  replyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  replyBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  replyTime: {
    color: '#52525b',
    fontSize: 10,
  },
  replyMessage: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  replyAuthor: {
    color: '#52525b',
    fontSize: 11,
  },

  // Composer
  composer: {
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    backgroundColor: '#111113',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 28,
  },
  typePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
  },
  typePickerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  typePickerChevron: {
    color: '#52525b',
    fontSize: 10,
  },
  typePickerDropdown: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    marginBottom: 8,
    overflow: 'hidden',
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
    gap: 8,
  },
  typeOptionActive: {
    backgroundColor: '#3b82f610',
  },
  typeOptionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  typeOptionText: {
    color: '#a1a1aa',
    fontSize: 13,
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
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
