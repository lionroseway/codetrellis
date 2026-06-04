/**
 * Project browser — navigate the desktop's filesystem from the phone and
 * open any folder as a project. Lists directories via the `fs.browse` RPC
 * (flagging git repos / manifest roots), lets you drill in/out, and opens
 * the chosen folder on the desktop via `project.open` (which also switches
 * the desktop UI — companion-app principle).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';

interface BrowseEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasProjectMarker: boolean;
}
interface BrowseResult {
  path: string;
  parent: string | null;
  home: string;
  entries: BrowseEntry[];
}

export default function ProjectBrowserScreen() {
  const router = useRouter();
  const [dir, setDir] = useState<string | null>(null);
  const [data, setData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const browse = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await rpc<BrowseResult>('fs.browse', target ? { dir: target } : {});
      setData(result);
      setDir(result.path);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { browse(); }, [browse]);

  const openHere = useCallback(async () => {
    if (!dir) return;
    setOpening(true);
    try {
      await rpc('project.open', { projectPath: dir });
      Alert.alert('Opening project', `Opening ${dir.split('/').pop()} on the desktop…`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      Alert.alert('Could not open', err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  }, [dir, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Open Project' }} />

      {/* Current path + up */}
      <View style={styles.pathBar}>
        <Text style={styles.pathText} numberOfLines={1}>
          {dir ?? '…'}
        </Text>
        <View style={styles.pathActions}>
          <TouchableOpacity
            style={[styles.upBtn, !data?.parent && styles.upBtnDisabled]}
            disabled={!data?.parent}
            onPress={() => data?.parent && browse(data.parent)}
          >
            <Text style={styles.upBtnText}>↑ Up</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.homeBtn} onPress={() => browse(data?.home)}>
            <Text style={styles.homeBtnText}>⌂ Home</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Open-this-folder action */}
      <TouchableOpacity style={styles.openHereBtn} onPress={openHere} disabled={opening || !dir}>
        <Text style={styles.openHereText}>
          {opening ? 'Opening…' : '📂 Open this folder as a project'}
        </Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#3b82f6" size="large" /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => browse(dir ?? undefined)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {(data?.entries ?? []).length === 0 ? (
            <Text style={styles.emptyText}>No sub-folders here</Text>
          ) : (
            (data?.entries ?? []).map((e) => {
              const isProj = e.isGitRepo || e.hasProjectMarker;
              return (
                <TouchableOpacity
                  key={e.path}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => browse(e.path)}
                >
                  <Text style={styles.rowIcon}>{isProj ? '📦' : '📁'}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName} numberOfLines={1}>{e.name}</Text>
                    {isProj && (
                      <Text style={styles.rowMeta}>
                        {e.isGitRepo ? 'git repo' : ''}
                        {e.isGitRepo && e.hasProjectMarker ? ' · ' : ''}
                        {e.hasProjectMarker ? 'project' : ''}
                      </Text>
                    )}
                  </View>
                  {isProj && (
                    <TouchableOpacity
                      style={styles.openChip}
                      onPress={async () => {
                        setOpening(true);
                        try {
                          await rpc('project.open', { projectPath: e.path });
                          Alert.alert('Opening project', `Opening ${e.name} on the desktop…`, [
                            { text: 'OK', onPress: () => router.back() },
                          ]);
                        } catch (err: unknown) {
                          Alert.alert('Could not open', err instanceof Error ? err.message : String(err));
                        } finally { setOpening(false); }
                      }}
                    >
                      <Text style={styles.openChipText}>Open</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  pathBar: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  pathText: { color: '#a1a1aa', fontSize: 12, fontFamily: 'Menlo', marginBottom: 8 },
  pathActions: { flexDirection: 'row', gap: 8 },
  upBtn: {
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6,
  },
  upBtnDisabled: { opacity: 0.4 },
  upBtnText: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  homeBtn: {
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6,
  },
  homeBtnText: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  openHereBtn: {
    margin: 12,
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  openHereText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f6',
    borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { color: '#3b82f6', fontWeight: '600', fontSize: 14 },
  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 40 },
  emptyText: { color: '#52525b', fontSize: 13, textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  rowIcon: { fontSize: 18, marginRight: 10 },
  rowBody: { flex: 1 },
  rowName: { color: '#e4e4e7', fontSize: 14, fontWeight: '500' },
  rowMeta: { color: '#22c55e', fontSize: 11, marginTop: 2 },
  openChip: {
    backgroundColor: '#3b82f620',
    borderWidth: 1,
    borderColor: '#3b82f640',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  openChipText: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },
  chevron: { color: '#52525b', fontSize: 18 },
});
