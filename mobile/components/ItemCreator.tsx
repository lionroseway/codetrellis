/**
 * ItemCreator — inline "add item / add subtask" affordance. Collapsed it's a
 * single button; expanded it shows an optional kind toggle (Object/Action) and
 * a title field. Creates via the plan.item.create RPC and calls onCreated.
 */

import { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { rpc } from '../lib/rpc';

export default function ItemCreator({
  planUid,
  parentUid,
  allowKindToggle = true,
  label = '＋ Add item',
  defaultKind = 'action',
  onCreated,
}: {
  planUid: string;
  parentUid?: string;
  allowKindToggle?: boolean;
  label?: string;
  defaultKind?: 'object' | 'action';
  onCreated: (item: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'object' | 'action'>(defaultKind);
  const [busy, setBusy] = useState(false);

  const create = useCallback(async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const item = await rpc('plan.item.create', {
        planUid,
        kind,
        title: title.trim(),
        ...(parentUid ? { parentUid } : {}),
      });
      setTitle('');
      setOpen(false);
      onCreated(item);
    } catch (err: unknown) {
      Alert.alert('Could not create', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [title, kind, planUid, parentUid, onCreated]);

  if (!open) {
    return (
      <TouchableOpacity style={styles.addBtn} activeOpacity={0.7} onPress={() => setOpen(true)}>
        <Text style={styles.addText}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.box}>
      {allowKindToggle && (
        <View style={styles.kindRow}>
          {(['object', 'action'] as const).map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.kindChip, kind === k && styles.kindChipActive]}
              onPress={() => setKind(k)}
            >
              <Text style={[styles.kindText, kind === k && styles.kindTextActive]}>
                {k === 'object' ? '▢ Page' : '⚡ Task'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Title…"
        placeholderTextColor="#52525b"
        autoFocus
      />
      <View style={styles.actions}>
        <TouchableOpacity onPress={() => { setOpen(false); setTitle(''); }} hitSlop={8}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.createBtn, (!title.trim() || busy) && styles.createBtnDisabled]}
          onPress={create}
          disabled={!title.trim() || busy}
        >
          <Text style={styles.createText}>{busy ? '…' : 'Create'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#3f3f46',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  addText: { color: '#71717a', fontSize: 13, fontWeight: '600' },
  box: {
    backgroundColor: '#141416',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    marginTop: 6,
  },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  kindChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 7,
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
  },
  kindChipActive: { backgroundColor: '#3b82f620', borderColor: '#3b82f6' },
  kindText: { color: '#a1a1aa', fontSize: 12, fontWeight: '600' },
  kindTextActive: { color: '#3b82f6' },
  input: {
    backgroundColor: '#18181b', borderRadius: 8, borderWidth: 1, borderColor: '#27272a',
    color: '#e4e4e7', fontSize: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginTop: 10 },
  cancel: { color: '#a1a1aa', fontSize: 14 },
  createBtn: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  createBtnDisabled: { backgroundColor: '#27272a' },
  createText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
