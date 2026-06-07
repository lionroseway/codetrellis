/**
 * System Doc detail — read + edit a single living doc.
 *
 * Reads via `sysdoc.read` (doc + freshness report), renders the markdown
 * body, and supports inline edit (title + body → `sysdoc.update`), mark
 * verified (`sysdoc.verify`), and delete (`sysdoc.delete`). Mirrors the
 * desktop SystemDocsPanel reading + editing experience.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { rpc } from '../lib/rpc';
import Markdown from '../components/Markdown';

interface SystemDoc {
  uid: string;
  slug: string;
  title: string;
  body: string;
  owner: string | null;
  tags: string[];
  capturedAgainstCommit: string | null;
  lastVerifiedAt: number | null;
  updatedAt: number;
}
interface FreshnessReport {
  status: 'current' | 'moved' | 'stale';
  changedReferencedFiles: string[];
}

export default function SystemDocDetailScreen() {
  const router = useRouter();
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const [doc, setDoc] = useState<SystemDoc | null>(null);
  const [freshness, setFreshness] = useState<FreshnessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    setError(null);
    try {
      const res = await rpc<{ doc: SystemDoc; freshness: FreshnessReport | null }>('sysdoc.read', { uid });
      setDoc(res.doc);
      setFreshness(res.freshness);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const startEdit = useCallback(() => {
    if (!doc) return;
    setTitleDraft(doc.title);
    setBodyDraft(doc.body);
    setEditing(true);
  }, [doc]);

  const save = useCallback(async () => {
    if (!uid) return;
    setSaving(true);
    try {
      const updated = await rpc<SystemDoc>('sysdoc.update', {
        uid,
        title: titleDraft.trim(),
        body: bodyDraft,
      });
      setDoc(updated);
      setEditing(false);
      // Editing clears the verified stamp on the desktop — refresh freshness.
      load();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [uid, titleDraft, bodyDraft, load]);

  const verify = useCallback(async () => {
    if (!uid) return;
    try {
      const updated = await rpc<SystemDoc>('sysdoc.verify', { uid });
      setDoc(updated);
      load();
    } catch (e) {
      Alert.alert('Could not verify', e instanceof Error ? e.message : String(e));
    }
  }, [uid, load]);

  const del = useCallback(() => {
    Alert.alert('Delete doc?', 'This removes the doc and its .md file. Cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await rpc('sysdoc.delete', { uid });
            router.back();
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  }, [uid, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Document' }} />
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }
  if (error || !doc) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Document' }} />
        <Text style={styles.errorText}>{error ?? 'Doc not found'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const badge = freshnessBadge(doc, freshness);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Document',
          headerRight: () =>
            editing ? (
              <TouchableOpacity onPress={save} disabled={saving} hitSlop={12}>
                <Text style={styles.headerAction}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={startEdit} hitSlop={12}>
                <Text style={styles.headerAction}>Edit</Text>
              </TouchableOpacity>
            ),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {editing ? (
          <>
            <Text style={styles.fieldLabel}>Title</Text>
            <TextInput
              style={styles.titleInput}
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder="Doc title"
              placeholderTextColor="#52525b"
            />
            <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Body (markdown)</Text>
            <TextInput
              style={styles.bodyInput}
              value={bodyDraft}
              onChangeText={setBodyDraft}
              placeholder="# Heading\n\nMarkdown content…"
              placeholderTextColor="#52525b"
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>{doc.title}</Text>
            <View style={styles.metaRow}>
              <View style={[styles.badge, { borderColor: badge.color }]}>
                <View style={[styles.badgeDot, { backgroundColor: badge.color }]} />
                <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
              {doc.owner ? <Text style={styles.owner}>{doc.owner}</Text> : null}
            </View>
            {freshness?.status === 'stale' && freshness.changedReferencedFiles.length > 0 && (
              <View style={styles.staleBox}>
                <Text style={styles.staleTitle}>Referenced files changed since last verified:</Text>
                {freshness.changedReferencedFiles.slice(0, 8).map((f) => (
                  <Text key={f} style={styles.staleFile}>• {f}</Text>
                ))}
              </View>
            )}
            <View style={styles.bodyCard}>
              {doc.body.trim() ? (
                <Markdown>{doc.body}</Markdown>
              ) : (
                <Text style={styles.emptyBody}>No content yet. Tap Edit to write.</Text>
              )}
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={verify}>
                <Text style={styles.actionBtnText}>✓ Mark verified</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={del}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function freshnessBadge(
  doc: SystemDoc,
  fr: FreshnessReport | null,
): { label: string; color: string } {
  if (!doc.lastVerifiedAt || !doc.capturedAgainstCommit) return { label: 'Unverified', color: '#71717a' };
  if (fr?.status === 'stale') return { label: 'Stale', color: '#ef4444' };
  if (fr?.status === 'moved') return { label: 'HEAD moved', color: '#f59e0b' };
  return { label: 'Current', color: '#22c55e' };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: 'transparent' },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f6',
    borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { color: '#3b82f6', fontWeight: '600', fontSize: 14 },
  headerAction: { color: '#3b82f6', fontSize: 16, fontWeight: '700' },

  title: { color: '#e4e4e7', fontSize: 22, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  badge: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4, gap: 6,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  owner: { color: '#a1a1aa', fontSize: 13 },

  staleBox: {
    backgroundColor: '#1c1014', borderRadius: 10, borderWidth: 1, borderColor: '#ef444440',
    padding: 12, marginTop: 12,
  },
  staleTitle: { color: '#ef4444', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  staleFile: { color: '#a1a1aa', fontSize: 12, fontFamily: 'Menlo', marginTop: 2 },

  bodyCard: {
    backgroundColor: '#18181b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#27272a', marginTop: 16,
  },
  emptyBody: { color: '#52525b', fontSize: 14, fontStyle: 'italic' },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  actionBtn: {
    flex: 1, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center',
  },
  actionBtnText: { color: '#22c55e', fontSize: 14, fontWeight: '700' },
  deleteBtn: { borderColor: '#ef444440' },
  deleteBtnText: { color: '#ef4444', fontSize: 14, fontWeight: '700' },

  fieldLabel: { color: '#71717a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  fieldLabelSpaced: { marginTop: 18 },
  titleInput: {
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#e4e4e7',
    fontSize: 16, fontWeight: '700', marginTop: 6,
  },
  bodyInput: {
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#e4e4e7',
    fontSize: 14, fontFamily: 'Menlo', marginTop: 6, minHeight: 320, lineHeight: 20,
  },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 10 },
  cancelBtnText: { color: '#71717a', fontSize: 14, fontWeight: '600' },
});
