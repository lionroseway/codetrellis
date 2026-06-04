/**
 * Projects — manage the desktop's projects from the phone.
 *
 * Lists recent projects (live from the streamed snapshot) with the active
 * one pinned to the top. Per project: open/switch (project.open), pin/unpin
 * (project.pin), rescan (project.rescan), rename alias (project.alias), and
 * remove from recents (project.remove). "Open folder" deep-links into the
 * filesystem browser. Every action mirrors onto the desktop UI.
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useActiveProject, useRecentProjects } from '../lib/store';
import { rpc } from '../lib/rpc';

export default function ProjectsScreen() {
  const router = useRouter();
  const activeProject = useActiveProject();
  const recentProjects = useRecentProjects();
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');

  const act = useCallback(
    async (key: string, fn: () => Promise<unknown>, errTitle: string) => {
      setBusy(key);
      try {
        await fn();
      } catch (e) {
        Alert.alert(errTitle, e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const open = (projectPath: string) =>
    act(`open:${projectPath}`, () => rpc('project.open', { projectPath }), 'Could not open');

  const rescan = (projectPath: string) =>
    act(`rescan:${projectPath}`, async () => {
      await rpc('project.rescan', { projectPath });
      Alert.alert('Rescanning', 'The desktop is re-scanning the project.');
    }, 'Could not rescan');

  const togglePin = (projectPath: string, pinned: boolean) =>
    act(`pin:${projectPath}`, () => rpc('project.pin', { projectPath, pinned: !pinned }), 'Could not pin');

  const remove = (projectPath: string, name: string) =>
    Alert.alert('Remove from recents?', `"${name}" stays on disk — only the recents entry is removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => act(`remove:${projectPath}`, () => rpc('project.remove', { projectPath }), 'Could not remove'),
      },
    ]);

  const saveAlias = (projectPath: string) =>
    act(`alias:${projectPath}`, async () => {
      await rpc('project.alias', { projectPath, alias: aliasDraft.trim() });
      setRenaming(null);
      setAliasDraft('');
    }, 'Could not rename');

  // Active project first, then the rest (newest first — the snapshot is
  // already ordered by lastOpenedAt).
  const others = recentProjects.filter((p) => p.path !== activeProject?.path);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Projects',
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/project-browser')} hitSlop={12}>
              <Text style={styles.headerAction}>＋ Open</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {activeProject && (
          <>
            <Text style={styles.sectionTitle}>ACTIVE</Text>
            <View style={[styles.card, styles.activeCard]}>
              <View style={styles.cardHead}>
                <Text style={styles.name}>{activeProject.displayName}</Text>
                <View style={styles.liveDot} />
              </View>
              {activeProject.branch && <Text style={styles.branch}>{activeProject.branch}</Text>}
              <Text style={styles.path} numberOfLines={1}>{activeProject.path}</Text>
              <View style={styles.actions}>
                <ActionChip
                  label={busy === `rescan:${activeProject.path}` ? 'Rescanning…' : 'Rescan'}
                  onPress={() => rescan(activeProject.path)}
                  disabled={busy !== null}
                />
                <ActionChip label="Rename" onPress={() => { setRenaming(activeProject.path); setAliasDraft(activeProject.displayName); }} disabled={busy !== null} />
              </View>
              {renaming === activeProject.path && (
                <RenameBox
                  value={aliasDraft}
                  onChange={setAliasDraft}
                  onSave={() => saveAlias(activeProject.path)}
                  onCancel={() => { setRenaming(null); setAliasDraft(''); }}
                />
              )}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>RECENT</Text>
        {others.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No other recent projects</Text>
          </View>
        ) : (
          others.map((p) => (
            <View key={p.path} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.name}>
                  {p.pinned ? '★ ' : ''}{p.displayName}
                </Text>
                <TouchableOpacity
                  style={styles.openChip}
                  disabled={busy !== null}
                  onPress={() => open(p.path)}
                >
                  <Text style={styles.openChipText}>
                    {busy === `open:${p.path}` ? 'Opening…' : 'Open'}
                  </Text>
                </TouchableOpacity>
              </View>
              {p.branch && <Text style={styles.branch}>{p.branch}</Text>}
              <Text style={styles.path} numberOfLines={1}>{p.path}</Text>
              <View style={styles.actions}>
                <ActionChip
                  label={p.pinned ? 'Unpin' : 'Pin'}
                  onPress={() => togglePin(p.path, p.pinned)}
                  disabled={busy !== null}
                />
                <ActionChip
                  label="Rename"
                  onPress={() => { setRenaming(p.path); setAliasDraft(p.displayName); }}
                  disabled={busy !== null}
                />
                <ActionChip label="Remove" tone="danger" onPress={() => remove(p.path, p.displayName)} disabled={busy !== null} />
              </View>
              {renaming === p.path && (
                <RenameBox
                  value={aliasDraft}
                  onChange={setAliasDraft}
                  onSave={() => saveAlias(p.path)}
                  onCancel={() => { setRenaming(null); setAliasDraft(''); }}
                />
              )}
            </View>
          ))
        )}

        <TouchableOpacity style={styles.browseCta} onPress={() => router.push('/project-browser')}>
          <Text style={styles.browseCtaText}>📂 Open another folder…</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function ActionChip({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, tone === 'danger' && styles.chipDanger, disabled && styles.chipDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, tone === 'danger' && styles.chipTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

function RenameBox({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (t: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.renameBox}>
      <TextInput
        style={styles.renameInput}
        value={value}
        onChangeText={onChange}
        placeholder="Display name"
        placeholderTextColor="#52525b"
        autoFocus
      />
      <TouchableOpacity style={styles.renameSave} onPress={onSave}>
        <Text style={styles.renameSaveText}>Save</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.renameCancel} onPress={onCancel}>
        <Text style={styles.renameCancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  headerAction: { color: '#3b82f6', fontSize: 15, fontWeight: '700' },

  sectionTitle: {
    fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1,
    marginBottom: 8, marginTop: 10,
  },
  card: {
    backgroundColor: '#18181b', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#27272a', marginBottom: 10,
  },
  activeCard: { borderColor: '#3b82f640' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: '#e4e4e7', fontSize: 16, fontWeight: '700', flex: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e', marginLeft: 8 },
  branch: { color: '#3b82f6', fontSize: 12, marginTop: 4, fontWeight: '500' },
  path: { color: '#52525b', fontSize: 11, marginTop: 2 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7,
  },
  chipDanger: { borderColor: '#ef444440' },
  chipDisabled: { opacity: 0.4 },
  chipText: { color: '#e4e4e7', fontSize: 13, fontWeight: '600' },
  chipTextDanger: { color: '#ef4444' },

  openChip: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f640',
    borderRadius: 6, paddingHorizontal: 14, paddingVertical: 5, marginLeft: 8,
  },
  openChipText: { color: '#3b82f6', fontSize: 13, fontWeight: '700' },

  renameBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  renameInput: {
    flex: 1, backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#3b82f640',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, color: '#e4e4e7', fontSize: 14,
  },
  renameSave: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  renameSaveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  renameCancel: { paddingHorizontal: 6, paddingVertical: 9 },
  renameCancelText: { color: '#71717a', fontSize: 13, fontWeight: '600' },

  empty: {
    backgroundColor: '#18181b', borderRadius: 10, padding: 20, alignItems: 'center',
    borderWidth: 1, borderColor: '#27272a',
  },
  emptyText: { color: '#52525b', fontSize: 13 },

  browseCta: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f6',
    borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 16,
  },
  browseCtaText: { color: '#3b82f6', fontSize: 14, fontWeight: '700' },
});
