/**
 * CommentComposer — post a comment on a plan or item from mobile.
 * Used at the bottom of the Discussion sections in plan-detail / item-detail.
 * Posts via the comment.add RPC and hands the created comment back so the host
 * can append it without a full refetch.
 */

import { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { rpc } from '../lib/rpc';

const KINDS: Array<{ key: string; label: string; fg: string }> = [
  { key: 'note', label: 'Note', fg: '#3b82f6' },
  { key: 'question', label: 'Question', fg: '#8b5cf6' },
  { key: 'blocker', label: 'Blocker', fg: '#ef4444' },
  { key: 'progress', label: 'Progress', fg: '#22c55e' },
];

export default function CommentComposer({
  targetType,
  targetUid,
  onPosted,
}: {
  targetType: 'item' | 'plan';
  targetUid: string;
  onPosted: (comment: unknown) => void;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState('note');
  const [sending, setSending] = useState(false);

  const post = useCallback(async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const comment = await rpc('comment.add', { targetType, targetUid, body: text.trim(), kind });
      setText('');
      onPosted(comment);
    } catch (err: unknown) {
      Alert.alert('Could not post', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [text, kind, targetType, targetUid, onPosted]);

  return (
    <View style={styles.wrap}>
      <View style={styles.kindRow}>
        {KINDS.map((k) => (
          <TouchableOpacity
            key={k.key}
            style={[styles.kindChip, kind === k.key && { borderColor: k.fg, backgroundColor: k.fg + '20' }]}
            onPress={() => setKind(k.key)}
          >
            <Text style={[styles.kindText, kind === k.key && { color: k.fg }]}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          placeholderTextColor="#52525b"
          multiline
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.postBtn, (!text.trim() || sending) && styles.postBtnDisabled]}
          onPress={post}
          disabled={!text.trim() || sending}
        >
          <Text style={styles.postText}>{sending ? '…' : 'Post'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  kindChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
  },
  kindText: { color: '#71717a', fontSize: 12, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#18181b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#e4e4e7',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 120,
  },
  postBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  postBtnDisabled: { backgroundColor: '#27272a' },
  postText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
