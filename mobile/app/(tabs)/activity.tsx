/**
 * Activity tab — live walkthrough, input requests, agents, channel events.
 *
 * Four sections, shown in priority order:
 *   1. Live walkthrough banner (when walkthroughActive)
 *   2. Pending input requests (actionable — tappable to respond)
 *   3. Connected agents with session info
 *   4. Channel events with type badges
 */

import { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  useChannelEvents,
  usePresence,
  useAgents,
  useWalkthroughActive,
  usePendingInputRequests,
  usePlans,
} from '../../lib/store';
import Markdown from '../../components/Markdown';

// Tone → accent color for walkthrough narration cards.
const PRESENCE_TONE: Record<string, string> = {
  neutral: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  question: '#8b5cf6',
};

// --- Colors ------------------------------------------------------------------

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

// --- Formatters --------------------------------------------------------------

function formatRelative(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatSessionAge(lastSeen: number): string {
  const seconds = Math.floor((Date.now() - lastSeen) / 1000);
  if (seconds < 30) return 'active now';
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// --- Component ---------------------------------------------------------------

export default function ActivityTab() {
  const router = useRouter();
  const events = useChannelEvents();
  const presence = usePresence();
  const agents = useAgents();
  const walkthroughActive = useWalkthroughActive();
  const pendingInputs = usePendingInputRequests();
  const plans = usePlans();

  // Find plan name for an agent's activePlanUid
  const getPlanName = useCallback(
    (planUid: string | null) => {
      if (!planUid) return null;
      return plans.find((p) => p.uid === planUid)?.name ?? null;
    },
    [plans],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Live Walkthrough ──────────────────────────────────────── */}
      {(walkthroughActive || presence.length > 0) && (
        <View style={styles.section}>
          <View style={styles.liveBanner}>
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveLabel}>LIVE WALKTHROUGH</Text>
              {presence.length > 1 && <Text style={styles.liveCount}>{presence.length} steps</Text>}
            </View>
            <Text style={styles.liveSubtext}>
              The desktop is narrating — newest first
            </Text>

            {/* Narration cards: markdown body, tone-colored rail, agent + time. */}
            {[...presence].reverse().map((card, idx) => {
              const accent = PRESENCE_TONE[card.tone] ?? '#3b82f6';
              return (
                <View key={card.id} style={[styles.presenceCard, { borderLeftColor: accent }, idx === 0 && styles.presenceCardCurrent]}>
                  <Markdown compact>{card.text}</Markdown>
                  <View style={styles.presenceFooter}>
                    {card.agentId ? <Text style={[styles.presenceAgent, { color: accent }]}>{card.agentId}</Text> : null}
                    {card.linkTo ? <Text style={styles.presenceLink}>▸ linked</Text> : null}
                    <Text style={styles.presenceMeta}>{formatRelative(card.createdAt)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Pending Input Requests ────────────────────────────────── */}
      {pendingInputs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            AWAITING YOUR INPUT ({pendingInputs.length})
          </Text>

          {pendingInputs.map((input) => (
            <TouchableOpacity
              key={input.requestId}
              style={styles.inputCard}
              activeOpacity={0.7}
              onPress={() =>
                router.push(`/input-request?requestId=${input.requestId}`)
              }
            >
              <View style={styles.inputHeader}>
                <View style={styles.inputBadge}>
                  <Text style={styles.inputBadgeText}>INPUT</Text>
                </View>
                <Text style={styles.inputTime}>
                  {formatRelative(input.receivedAt)}
                </Text>
              </View>
              <Text style={styles.inputPrompt} numberOfLines={3}>
                {input.prompt}
              </Text>
              {input.options && input.options.length > 0 && (
                <Text style={styles.inputChoices}>
                  {input.options.length} choice
                  {input.options.length !== 1 ? 's' : ''} available
                </Text>
              )}
              <View style={styles.inputFooter}>
                <Text style={styles.inputAction}>Tap to respond</Text>
                <Text style={styles.inputChevron}>{'>'}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Connected Agents ──────────────────────────────────────── */}
      {agents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            AGENTS ({agents.length})
          </Text>
          {agents.map((agent) => {
            const planName = getPlanName(agent.activePlanUid);
            const isRecent = Date.now() - agent.lastSeen < 30_000;
            return (
              <View key={agent.sessionId} style={styles.agentCard}>
                <View style={styles.agentRow}>
                  <View
                    style={[
                      styles.agentDot,
                      isRecent ? styles.agentDotActive : styles.agentDotStale,
                    ]}
                  />
                  <View style={styles.agentInfo}>
                    <Text style={styles.agentType}>{agent.agentType}</Text>
                    {agent.model ? (
                      <Text style={styles.agentModel}>{agent.model}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.agentAge}>
                    {formatSessionAge(agent.lastSeen)}
                  </Text>
                </View>
                {planName && (
                  <View style={styles.agentPlanRow}>
                    <Text style={styles.agentPlanLabel}>Working on:</Text>
                    <Text style={styles.agentPlanName} numberOfLines={1}>
                      {planName}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* ── Channel Events ────────────────────────────────────────── */}
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
                  <Text style={styles.eventChevron}>{'>'}</Text>
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

// --- Styles ------------------------------------------------------------------

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

  // ── Live Walkthrough Banner ──
  liveBanner: {
    backgroundColor: '#1e1b4b',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#4f46e5',
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  liveLabel: {
    color: '#c7d2fe',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  liveCount: { color: '#818cf8', fontSize: 11, fontWeight: '600', marginLeft: 'auto' },
  liveSubtext: {
    color: '#818cf8',
    fontSize: 12,
    marginBottom: 8,
  },

  // Presence (narration) cards inside the walkthrough
  presenceCard: {
    backgroundColor: '#1e1b4b',
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  presenceCardCurrent: { backgroundColor: '#312e81' },
  presenceFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  presenceAgent: { fontSize: 11, fontWeight: '700' },
  presenceLink: { color: '#a5b4fc', fontSize: 11, fontWeight: '600' },
  presenceMeta: {
    color: '#6366f1',
    fontSize: 11,
    marginLeft: 'auto',
  },

  // ── Input Request Cards ──
  inputCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3b82f640',
  },
  inputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inputBadge: {
    backgroundColor: '#3b82f620',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  inputBadgeText: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  inputTime: {
    color: '#52525b',
    fontSize: 11,
  },
  inputPrompt: {
    color: '#e4e4e7',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  inputChoices: {
    color: '#8b5cf6',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
  },
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputAction: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
  },
  inputChevron: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Agent Cards ──
  agentCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  agentDotActive: {
    backgroundColor: '#22c55e',
  },
  agentDotStale: {
    backgroundColor: '#52525b',
  },
  agentInfo: {
    flex: 1,
  },
  agentType: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  agentModel: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },
  agentAge: {
    color: '#52525b',
    fontSize: 11,
  },
  agentPlanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272a',
    gap: 6,
  },
  agentPlanLabel: {
    color: '#52525b',
    fontSize: 11,
    fontWeight: '500',
  },
  agentPlanName: {
    color: '#a1a1aa',
    fontSize: 12,
    flex: 1,
  },

  // ── Event Cards ──
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

  // ── Empty ──
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
