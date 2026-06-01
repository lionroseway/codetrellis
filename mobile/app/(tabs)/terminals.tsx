/**
 * Terminals tab — terminal list cards.
 *
 * Shows all active terminal sessions on the desktop. Each card
 * shows title, cwd, and alive status. Tapping does nothing yet
 * (detail view comes in M3).
 */

import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTerminals, usePendingInputRequests } from '../../lib/store';

function formatAge(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TerminalsTab() {
  const router = useRouter();
  const terminals = useTerminals();
  const pendingInputs = usePendingInputRequests();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Pending input requests banner */}
      {pendingInputs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AWAITING RESPONSE</Text>
          {pendingInputs.map((req) => (
            <View key={req.requestId} style={styles.inputCard}>
              <View style={styles.inputDot} />
              <View style={styles.inputBody}>
                <Text style={styles.inputPrompt} numberOfLines={2}>
                  {req.prompt}
                </Text>
                {req.options && req.options.length > 0 && (
                  <Text style={styles.inputOptions} numberOfLines={1}>
                    Options: {req.options.join(' / ')}
                  </Text>
                )}
                <Text style={styles.inputMeta}>
                  {formatAge(req.receivedAt)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Terminal list */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          TERMINALS ({terminals.length})
        </Text>

        {terminals.length > 0 ? (
          terminals.map((term) => (
            <TouchableOpacity
              key={term.id}
              style={styles.termCard}
              activeOpacity={0.7}
              onPress={() =>
                router.push(
                  `/terminal-detail?id=${encodeURIComponent(term.id)}&title=${encodeURIComponent(term.title || `Terminal ${term.id}`)}`
                )
              }
            >
              <View style={styles.termHeader}>
                <View
                  style={[
                    styles.termDot,
                    term.alive ? styles.termAlive : styles.termDead,
                  ]}
                />
                <Text style={styles.termTitle} numberOfLines={1}>
                  {term.title || `Terminal ${term.id}`}
                </Text>
                <Text style={styles.termAction}>Open</Text>
              </View>
              <Text style={styles.termCwd} numberOfLines={1}>
                {term.cwd}
              </Text>
              <Text style={styles.termMeta}>
                {term.alive ? 'Running' : 'Exited'}
                {' · '}
                {formatAge(term.createdAt)}
              </Text>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>&gt;_</Text>
            <Text style={styles.emptyText}>No terminals running</Text>
            <Text style={styles.emptySubtext}>
              Start a terminal on the desktop to see it here
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

  // Input request cards
  inputCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1e1b4b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3730a3',
  },
  inputDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#818cf8',
    marginTop: 4,
    marginRight: 10,
  },
  inputBody: {
    flex: 1,
  },
  inputPrompt: {
    color: '#c7d2fe',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  inputOptions: {
    color: '#6366f1',
    fontSize: 12,
    marginTop: 4,
  },
  inputMeta: {
    color: '#4338ca',
    fontSize: 11,
    marginTop: 4,
  },

  // Terminal cards
  termCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  termHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  termDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  termAlive: {
    backgroundColor: '#22c55e',
  },
  termDead: {
    backgroundColor: '#52525b',
  },
  termTitle: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Menlo',
    flex: 1,
  },
  termAction: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  termCwd: {
    color: '#71717a',
    fontSize: 12,
    fontFamily: 'Menlo',
    marginBottom: 4,
  },
  termMeta: {
    color: '#52525b',
    fontSize: 11,
  },

  // Empty
  empty: {
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 28,
    color: '#3f3f46',
    fontFamily: 'Menlo',
    marginBottom: 12,
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
