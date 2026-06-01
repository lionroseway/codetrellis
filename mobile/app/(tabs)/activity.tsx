/**
 * Activity tab — channel events + presence cards.
 *
 * Shows recent channel events with type badges, grouped by
 * recency. Each event shows type, message, author, and status.
 */

import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useChannelEvents, usePresence, useAgents } from '../../lib/store';

const EVENT_COLORS: Record<string, { bg: string; fg: string }> = {
  stuck: { bg: '#ef444420', fg: '#ef4444' },
  'need-decision': { bg: '#f59e0b20', fg: '#f59e0b' },
  'need-context': { bg: '#8b5cf620', fg: '#8b5cf6' },
  steer: { bg: '#22c55e20', fg: '#22c55e' },
  'weigh-in': { bg: '#3b82f620', fg: '#3b82f6' },
  'handing-off': { bg: '#71717a20', fg: '#a1a1aa' },
  offer: { bg: '#06b6d420', fg: '#06b6d4' },
};

function getEventStyle(type: string) {
  return EVENT_COLORS[type] ?? { bg: '#27272a', fg: '#a1a1aa' };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

export default function ActivityTab() {
  const router = useRouter();
  const events = useChannelEvents();
  const presence = usePresence();
  const agents = useAgents();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Presence cards (if any active walkthrough / narration) */}
      {presence.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PRESENCE</Text>
          {presence.map((card) => (
            <View key={card.id} style={styles.presenceCard}>
              <Text style={styles.presenceText}>{card.text}</Text>
              <Text style={styles.presenceMeta}>
                {card.tone} · {formatRelative(card.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Agent activity summary */}
      {agents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            ACTIVE AGENTS ({agents.length})
          </Text>
          <View style={styles.agentStrip}>
            {agents.map((a) => (
              <View key={a.sessionId} style={styles.agentChip}>
                <View style={styles.agentDot} />
                <Text style={styles.agentChipText}>{a.agentType}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Channel events */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          CHANNEL EVENTS ({events.length})
        </Text>

        {events.length > 0 ? (
          events.map((event) => {
            const color = getEventStyle(event.eventType);
            return (
              <TouchableOpacity
                key={event.uid}
                style={styles.eventCard}
                activeOpacity={0.7}
                onPress={() => router.push(`/event-detail?uid=${event.uid}`)}
              >
                <View style={styles.eventHeader}>
                  <View
                    style={[
                      styles.eventBadge,
                      { backgroundColor: color.bg },
                    ]}
                  >
                    <Text style={[styles.eventBadgeText, { color: color.fg }]}>
                      {event.eventType}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusDot,
                      event.status === 'open'
                        ? styles.statusOpen
                        : styles.statusResolved,
                    ]}
                  />
                  <Text style={styles.eventTime}>
                    {formatRelative(event.createdAt)}
                  </Text>
                </View>

                {event.message ? (
                  <Text style={styles.eventMessage} numberOfLines={3}>
                    {event.message}
                  </Text>
                ) : null}

                <View style={styles.eventFooter}>
                  <Text style={styles.eventMeta}>
                    {event.author}
                    {event.authorType ? ` (${event.authorType})` : ''}
                    {' · '}
                    {event.status}
                  </Text>
                  <Text style={styles.eventChevron}>&gt;</Text>
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No channel events yet</Text>
            <Text style={styles.emptySubtext}>
              Events will appear here when agents post updates
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
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

  // Presence cards
  presenceCard: {
    backgroundColor: '#1e1b4b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3730a3',
  },
  presenceText: {
    color: '#c7d2fe',
    fontSize: 14,
    lineHeight: 20,
  },
  presenceMeta: {
    color: '#6366f1',
    fontSize: 11,
    marginTop: 6,
  },

  // Agent strip
  agentStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  agentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  agentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
    marginRight: 6,
  },
  agentChipText: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '500',
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

  // Empty
  empty: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#52525b',
    fontSize: 14,
    marginBottom: 4,
  },
  emptySubtext: {
    color: '#3f3f46',
    fontSize: 12,
    textAlign: 'center',
  },
});
