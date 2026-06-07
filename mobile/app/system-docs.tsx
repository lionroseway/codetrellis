/**
 * System Docs — browse the active project's living documentation.
 *
 * Lists docs via `sysdoc.list` (with search), shows a freshness dot per doc,
 * lets you create a new doc, and opens each in the detail/editor screen.
 * Per-project; scoped to the desktop's active project.
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { rpc } from '../lib/rpc';

interface SystemDocSummary {
  uid: string;
  slug: string;
  title: string;
  owner: string | null;
  tags: string[];
  updatedAt: number;
  lastVerifiedAt: number | null;
  capturedAgainstCommit: string | null;
}

export default function SystemDocsScreen() {
  const router = useRouter();
  const [docs, setDocs] = useState<SystemDocSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q?: string) => {
    setError(null);
    try {
      const params = q ? { search: q } : {};
      const list = await rpc<SystemDocSummary[]>('sysdoc.list', params);
      setDocs(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload each time the screen regains focus (e.g. returning from the editor).
  useFocusEffect(useCallback(() => { load(search); }, [load, search]));

  const create = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const doc = await rpc<{ uid: string }>('sysdoc.create', { title });
      setCreating(false);
      setNewTitle('');
      router.push(`/system-doc-detail?uid=${doc.uid}`);
    } catch (e) {
      Alert.alert('Could not create', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [newTitle, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'System Docs',
          headerRight: () => (
            <TouchableOpacity onPress={() => setCreating((c) => !c)} hitSlop={12}>
              <Text style={styles.headerAction}>＋ New</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={(t) => { setSearch(t); load(t); }}
          placeholder="Search docs…"
          placeholderTextColor="#52525b"
          autoCapitalize="none"
        />
      </View>

      {creating && (
        <View style={styles.createBox}>
          <TextInput
            style={styles.createInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="New doc title…"
            placeholderTextColor="#52525b"
            autoFocus
          />
          <View style={styles.createActions}>
            <TouchableOpacity onPress={() => { setCreating(false); setNewTitle(''); }}>
              <Text style={styles.createCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.createBtn, (!newTitle.trim() || busy) && styles.createBtnDisabled]}
              onPress={create}
              disabled={!newTitle.trim() || busy}
            >
              <Text style={styles.createBtnText}>{busy ? 'Creating…' : 'Create'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#3b82f6" size="large" /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(search)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(search); }} tintColor="#3b82f6" />
          }
        >
          {docs.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {search ? 'No docs match your search' : 'No system docs in this project yet'}
              </Text>
            </View>
          ) : (
            docs.map((d) => (
              <TouchableOpacity
                key={d.uid}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => router.push(`/system-doc-detail?uid=${d.uid}`)}
              >
                <View style={[styles.freshDot, { backgroundColor: freshnessColor(d) }]} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{d.title}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {d.owner ? `${d.owner} · ` : ''}{d.slug}.md
                    {d.tags.length > 0 ? ` · ${d.tags.join(', ')}` : ''}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** Grey = unverified, green = verified. (Detailed staleness lives in the doc view.) */
function freshnessColor(d: SystemDocSummary): string {
  if (!d.lastVerifiedAt || !d.capturedAgainstCommit) return '#52525b';
  return '#22c55e';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  headerAction: { color: '#3b82f6', fontSize: 15, fontWeight: '700' },

  searchBar: { padding: 12, paddingBottom: 6 },
  searchInput: {
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: '#e4e4e7', fontSize: 14,
  },

  createBox: {
    marginHorizontal: 12, marginBottom: 6, backgroundColor: '#18181b',
    borderRadius: 10, borderWidth: 1, borderColor: '#3b82f640', padding: 12,
  },
  createInput: {
    backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, color: '#e4e4e7', fontSize: 14,
  },
  createActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginTop: 10 },
  createCancel: { color: '#71717a', fontSize: 14, fontWeight: '600' },
  createBtn: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8 },
  createBtnDisabled: { opacity: 0.4 },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f6',
    borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { color: '#3b82f6', fontWeight: '600', fontSize: 14 },

  list: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 40 },
  empty: {
    backgroundColor: '#18181b', borderRadius: 10, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: '#27272a',
  },
  emptyText: { color: '#52525b', fontSize: 13, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181b',
    borderRadius: 10, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: '#27272a',
  },
  freshDot: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  rowBody: { flex: 1 },
  rowTitle: { color: '#e4e4e7', fontSize: 15, fontWeight: '600' },
  rowMeta: { color: '#71717a', fontSize: 12, marginTop: 3 },
  chevron: { color: '#52525b', fontSize: 18 },
});
