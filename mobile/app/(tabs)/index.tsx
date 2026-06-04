/**
 * Home tab — project context + attention badges.
 *
 * Shows the active project, agent strip, and attention badges
 * (deviations, stuck events, pending inputs). All data comes
 * from the Zustand store (populated from the v2 snapshot).
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  useActiveProject,
  useRecentProjects,
  useAgents,
  useDeviationCounts,
  usePendingInputRequests,
  useChannelEvents,
  useConnectionState,
  useSnapshot,
} from '../../lib/store';
import { rpc } from '../../lib/rpc';

export default function HomeTab() {
  const router = useRouter();
  const connState = useConnectionState();
  const snapshot = useSnapshot();
  const activeProject = useActiveProject();
  const recentProjects = useRecentProjects();
  const agents = useAgents();
  const deviationCounts = useDeviationCounts();
  const pendingInputs = usePendingInputRequests();
  const channelEvents = useChannelEvents();

  const stuckEvents = channelEvents.filter(
    (e) => e.eventType === 'stuck' && e.status === 'open',
  );
  const needDecision = channelEvents.filter(
    (e) => e.eventType === 'need-decision' && e.status === 'open',
  );

  const [openingProject, setOpeningProject] = useState<string | null>(null);

  const openProject = useCallback(async (projectPath: string) => {
    setOpeningProject(projectPath);
    try {
      await rpc('project.open', { projectPath });
      // The snapshot will update via state sync once the desktop finishes scanning
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Could not open project', msg);
    } finally {
      setOpeningProject(null);
    }
  }, []);

  const hasAttention =
    deviationCounts.pending > 0 ||
    stuckEvents.length > 0 ||
    needDecision.length > 0 ||
    pendingInputs.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Connection indicator */}
      {connState === 'disconnected' || connState === 'failed' ? (
        <TouchableOpacity
          style={styles.disconnectedBanner}
          onPress={() => {
            try { router.dismissAll(); } catch { /* */ }
            router.replace('/');
          }}
        >
          <View style={styles.connectionBar}>
            <View style={[styles.connDot, styles.connDotRed]} />
            <Text style={styles.connText}>
              {connState === 'failed' ? 'Connection failed' : 'Disconnected'}
            </Text>
          </View>
          <Text style={styles.disconnectedAction}>Tap to reconnect</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.connectionBar}
          activeOpacity={0.6}
          onPress={() => router.push('/connection-switcher')}
        >
          <View
            style={[
              styles.connDot,
              connState === 'connected' ? styles.connDotGreen : styles.connDotYellow,
            ]}
          />
          <Text style={styles.connText}>
            {connState === 'connected' ? 'Connected' : connState}
          </Text>
          {snapshot.ts > 0 && (
            <Text style={styles.connAge}>
              Last update: {formatAge(snapshot.ts)}
            </Text>
          )}
          <Text style={styles.connSwitch}>Switch</Text>
        </TouchableOpacity>
      )}

      {/* Active project */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACTIVE PROJECT</Text>
        {activeProject ? (
          <View style={styles.projectCard}>
            <Text style={styles.projectName}>{activeProject.displayName}</Text>
            {activeProject.branch && (
              <Text style={styles.projectBranch}>{activeProject.branch}</Text>
            )}
            <Text style={styles.projectPath}>{activeProject.path}</Text>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No project scanned on desktop</Text>
          </View>
        )}
      </View>

      {/* Attention badges */}
      {hasAttention && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NEEDS ATTENTION</Text>

          {deviationCounts.pending > 0 && (
            <TouchableOpacity
              style={[styles.attentionCard, styles.attentionWarning]}
              onPress={() => router.push('/(tabs)/plans')}
            >
              <Text style={styles.attentionIcon}>!</Text>
              <View style={styles.attentionBody}>
                <Text style={styles.attentionTitle}>
                  {deviationCounts.pending} deviation{deviationCounts.pending !== 1 ? 's' : ''} pending
                </Text>
                <Text style={styles.attentionSub}>
                  {deviationCounts.byPlan.map((p) => p.planName).join(', ')}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {stuckEvents.length > 0 && (
            <TouchableOpacity
              style={[styles.attentionCard, styles.attentionError]}
              onPress={() => router.push('/(tabs)/activity')}
            >
              <Text style={styles.attentionIcon}>!!</Text>
              <View style={styles.attentionBody}>
                <Text style={styles.attentionTitle}>
                  {stuckEvents.length} stuck event{stuckEvents.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {needDecision.length > 0 && (
            <TouchableOpacity
              style={[styles.attentionCard, styles.attentionDecision]}
              onPress={() => router.push('/(tabs)/activity')}
            >
              <Text style={styles.attentionIcon}>?</Text>
              <View style={styles.attentionBody}>
                <Text style={styles.attentionTitle}>
                  {needDecision.length} need{needDecision.length !== 1 ? '' : 's'} decision
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {pendingInputs.length > 0 && (
            <TouchableOpacity
              style={[styles.attentionCard, styles.attentionInput]}
              onPress={() => {
                if (pendingInputs.length === 1) {
                  router.push(`/input-request?requestId=${pendingInputs[0].requestId}`);
                } else {
                  router.push('/(tabs)/activity');
                }
              }}
            >
              <Text style={styles.attentionIcon}>&gt;</Text>
              <View style={styles.attentionBody}>
                <Text style={styles.attentionTitle}>
                  {pendingInputs.length} input request{pendingInputs.length !== 1 ? 's' : ''}
                </Text>
                <Text style={styles.attentionSub} numberOfLines={1}>
                  {pendingInputs[0]?.prompt}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Agent strip */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AGENTS</Text>
        {agents.length > 0 ? (
          agents.map((agent) => (
            <View key={agent.sessionId} style={styles.agentCard}>
              <View style={styles.agentDot} />
              <View style={styles.agentInfo}>
                <Text style={styles.agentType}>{agent.agentType}</Text>
                {agent.model ? (
                  <Text style={styles.agentModel}>{agent.model}</Text>
                ) : null}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No agents connected</Text>
          </View>
        )}
      </View>

      {/* Recent projects + browse */}
      <View style={styles.section}>
        <View style={styles.projectsHeader}>
          <Text style={styles.sectionTitle}>PROJECTS</Text>
          <TouchableOpacity
            style={styles.browseBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/project-browser')}
          >
            <Text style={styles.browseBtnText}>＋ Open folder</Text>
          </TouchableOpacity>
        </View>
        {recentProjects.length > 1 &&
          recentProjects
            .filter((p) => p.path !== activeProject?.path)
            .slice(0, 5)
            .map((proj) => (
              <TouchableOpacity
                key={proj.path}
                style={[
                  styles.recentCard,
                  openingProject === proj.path && styles.recentCardOpening,
                ]}
                activeOpacity={0.7}
                disabled={openingProject !== null}
                onPress={() => openProject(proj.path)}
              >
                <View style={styles.recentHeader}>
                  <Text style={styles.recentName}>
                    {proj.pinned ? '* ' : ''}{proj.displayName}
                  </Text>
                  {openingProject === proj.path ? (
                    <Text style={styles.recentOpening}>Opening...</Text>
                  ) : (
                    <Text style={styles.recentAction}>Open</Text>
                  )}
                </View>
                {proj.branch && (
                  <Text style={styles.recentBranch}>{proj.branch}</Text>
                )}
              </TouchableOpacity>
            ))}
      </View>
    </ScrollView>
  );
}

function formatAge(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
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

  // Connection bar
  connectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  connDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  connDotGreen: { backgroundColor: '#22c55e' },
  connDotYellow: { backgroundColor: '#f59e0b' },
  connDotRed: { backgroundColor: '#ef4444' },
  connText: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '500',
  },
  connAge: {
    color: '#52525b',
    fontSize: 11,
    marginLeft: 'auto',
  },
  connSwitch: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 10,
  },
  disconnectedBanner: {
    backgroundColor: '#1c1017',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ef444440',
  },
  disconnectedAction: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
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
    marginBottom: 8,
  },
  projectsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  browseBtn: {
    backgroundColor: '#3b82f620',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
  },
  browseBtnText: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },

  // Project card
  projectCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  projectName: {
    color: '#e4e4e7',
    fontSize: 17,
    fontWeight: '700',
  },
  projectBranch: {
    color: '#3b82f6',
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
  },
  projectPath: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 4,
  },

  // Attention cards
  attentionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  attentionWarning: {
    borderColor: '#f59e0b40',
  },
  attentionError: {
    borderColor: '#ef444440',
  },
  attentionDecision: {
    borderColor: '#8b5cf640',
  },
  attentionInput: {
    borderColor: '#3b82f640',
  },
  attentionIcon: {
    fontSize: 18,
    width: 32,
    textAlign: 'center',
    color: '#f59e0b',
    fontWeight: '700',
  },
  attentionBody: {
    flex: 1,
  },
  attentionTitle: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  attentionSub: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 2,
  },

  // Agent cards
  agentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    marginRight: 10,
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

  // Recent projects
  recentCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  recentCardOpening: {
    borderColor: '#3b82f640',
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentName: {
    color: '#d4d4d8',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  recentAction: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  recentOpening: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 8,
  },
  recentBranch: {
    color: '#52525b',
    fontSize: 12,
    marginTop: 2,
  },

  // Empty state
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
