/**
 * Terminals tab — terminal list cards.
 *
 * Shows all active terminal sessions on the desktop. Each card
 * shows title, cwd, and alive status. Tapping does nothing yet
 * (detail view comes in M3).
 */

import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTerminals, usePendingInputRequests } from '../../lib/store';
import { rpc } from '../../lib/rpc';

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
  const rawTerminals = useTerminals();
  const pendingInputs = usePendingInputRequests();

  // Dedupe by id — state-sync patches can occasionally duplicate an array
  // entry, which would otherwise collide on the React key.
  const terminals = useMemo(() => {
    const seen = new Set<string>();
    return rawTerminals.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [rawTerminals]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const term = await rpc<{ id: string; title?: string }>('terminal.create', {
        preset: 'shell',
      });
      router.push(
        `/terminal-detail?id=${encodeURIComponent(term.id)}&title=${encodeURIComponent(term.title || 'Terminal')}`,
      );
    } catch (err: unknown) {
      Alert.alert('Could not create terminal', err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [router]);

  const handleRespond = useCallback(async (requestId: string, response: string) => {
    setSending(true);
    try {
      await rpc('input.respond', { requestId, response });
      setRespondingTo(null);
      setResponseText('');
    } catch (err: unknown) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, []);

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
                <Text style={styles.inputPrompt} numberOfLines={4}>
                  {req.prompt}
                </Text>

                {/* Option buttons */}
                {req.options && req.options.length > 0 && (
                  <View style={styles.optionRow}>
                    {req.options.map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={styles.optionBtn}
                        onPress={() => handleRespond(req.requestId, opt)}
                        disabled={sending}
                      >
                        <Text style={styles.optionBtnText}>{opt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Free-text response */}
                {respondingTo === req.requestId ? (
                  <View style={styles.respondRow}>
                    <TextInput
                      style={styles.respondInput}
                      value={responseText}
                      onChangeText={setResponseText}
                      placeholder="Type response..."
                      placeholderTextColor="#52525b"
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.respondSend, (!responseText.trim() || sending) && styles.respondSendDisabled]}
                      onPress={() => handleRespond(req.requestId, responseText.trim())}
                      disabled={!responseText.trim() || sending}
                    >
                      <Text style={styles.respondSendText}>{sending ? '...' : 'Send'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.respondBtn}
                    onPress={() => {
                      setRespondingTo(req.requestId);
                      setResponseText('');
                    }}
                  >
                    <Text style={styles.respondBtnText}>Respond</Text>
                  </TouchableOpacity>
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
        <View style={styles.termHeaderRow}>
          <Text style={styles.sectionTitle}>
            TERMINALS ({terminals.length})
          </Text>
          <TouchableOpacity
            style={[styles.newTermBtn, creating && styles.newTermBtnDisabled]}
            onPress={handleCreate}
            disabled={creating}
          >
            <Text style={styles.newTermBtnText}>{creating ? 'Starting…' : '+ New'}</Text>
          </TouchableOpacity>
        </View>

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
              Start one here, or launch a terminal on the desktop.
            </Text>
            <TouchableOpacity
              style={[styles.emptyCreateBtn, creating && styles.newTermBtnDisabled]}
              onPress={handleCreate}
              disabled={creating}
            >
              <Text style={styles.emptyCreateText}>
                {creating ? 'Starting…' : '+ New Terminal'}
              </Text>
            </TouchableOpacity>
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
  termHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  newTermBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 10,
  },
  newTermBtnDisabled: {
    opacity: 0.5,
  },
  newTermBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyCreateBtn: {
    marginTop: 16,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
  },
  emptyCreateText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
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
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  optionBtn: {
    backgroundColor: '#312e81',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4338ca',
  },
  optionBtnText: {
    color: '#c7d2fe',
    fontSize: 12,
    fontWeight: '600',
  },
  respondBtn: {
    marginTop: 8,
    backgroundColor: '#312e81',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4338ca',
  },
  respondBtnText: {
    color: '#818cf8',
    fontSize: 13,
    fontWeight: '600',
  },
  respondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  respondInput: {
    flex: 1,
    backgroundColor: '#1e1b4b',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4338ca',
    color: '#c7d2fe',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  respondSend: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  respondSendDisabled: {
    opacity: 0.4,
  },
  respondSendText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
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
