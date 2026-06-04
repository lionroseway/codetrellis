/**
 * Body editor — a full-screen markdown source editor reused for the plan
 * description and item (Object/Action) bodies. It fetches the current value
 * itself (so long bodies don't travel through route params), saves via
 * plan.update / plan.item.update, and pops back; the detail screen refetches
 * on focus to show the change.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';
import RefPicker from '../components/RefPicker';
import MarkdownBody from '../components/MarkdownBody';

export default function BodyEditorScreen() {
  const router = useRouter();
  const { target, uid, label, planUid } = useLocalSearchParams<{
    target: 'plan' | 'item';
    uid: string;
    label?: string;
    planUid?: string;
  }>();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  // One-shot controlled selection: set only right after a chip insert so the
  // caret lands after the chip, then released back to uncontrolled so normal
  // typing isn't disrupted.
  const [pendingSel, setPendingSel] = useState<{ start: number; end: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  const effectivePlanUid = target === 'plan' ? uid : planUid;

  const insertChip = useCallback((chip: string) => {
    const start = Math.min(sel.start, text.length);
    const end = Math.min(sel.end, text.length);
    const insert = `${chip} `; // trailing space so you can keep typing
    setText(text.slice(0, start) + insert + text.slice(end));
    const caret = start + insert.length;
    setPendingSel({ start: caret, end: caret });
  }, [sel, text]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (target === 'plan') {
          const r = await rpc<{ plan: { description?: string | null } }>('plan.get', { uid });
          if (!cancelled) setText(r.plan?.description ?? '');
        } else {
          const r = await rpc<{ item: { body?: string | null } }>('plan.item.get', { uid });
          if (!cancelled) setText(r.item?.body ?? '');
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target, uid]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      if (target === 'plan') {
        await rpc('plan.update', { uid, description: text });
      } else {
        await rpc('plan.item.update', { uid, body: text });
      }
      router.back();
    } catch (err: unknown) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [target, uid, text, router]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: label || 'Edit',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={save} disabled={saving || loading} hitSlop={12}>
              <Text style={[styles.save, (saving || loading) && styles.saveDisabled]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#3b82f6" size="large" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>{error}</Text></View>
      ) : (
        <>
          {/* Edit / Preview toggle */}
          <View style={styles.segment}>
            {(['edit', 'preview'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.segBtn, mode === m && styles.segBtnActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.segText, mode === m && styles.segTextActive]}>
                  {m === 'edit' ? 'Write' : 'Preview'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === 'edit' ? (
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              selection={pendingSel ?? undefined}
              onSelectionChange={(e) => {
                setSel(e.nativeEvent.selection);
                if (pendingSel) setPendingSel(null); // release control after the reposition lands
              }}
              placeholder="Write in markdown…  # heading · - list · **bold** · ```code```"
              placeholderTextColor="#52525b"
              multiline
              autoFocus
              textAlignVertical="top"
            />
          ) : (
            <ScrollView style={styles.preview} contentContainerStyle={styles.previewContent}>
              {text.trim().length > 0 ? (
                <MarkdownBody source={text} planUid={effectivePlanUid} />
              ) : (
                <Text style={styles.previewEmpty}>Nothing to preview yet.</Text>
              )}
            </ScrollView>
          )}

          {mode === 'edit' && (
            <View style={styles.toolbar}>
              {!!effectivePlanUid && (
                <TouchableOpacity style={styles.toolBtn} onPress={() => setPickerOpen(true)}>
                  <Text style={styles.toolBtnText}>＠  Mention item · file · symbol</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.toolHint}>Markdown</Text>
            </View>
          )}
        </>
      )}

      <RefPicker
        visible={pickerOpen}
        planUid={effectivePlanUid}
        onClose={() => setPickerOpen(false)}
        onInsert={insertChip}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center' },
  cancel: { color: '#a1a1aa', fontSize: 16 },
  save: { color: '#3b82f6', fontSize: 16, fontWeight: '700' },
  saveDisabled: { color: '#3f3f46' },

  // Write / Preview segmented control
  segment: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  segBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  segBtnActive: { backgroundColor: '#3b82f620', borderColor: '#3b82f6' },
  segText: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  segTextActive: { color: '#3b82f6' },

  // Writing surface — proportional font, generous line-height (Notion-like).
  input: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 16,
    lineHeight: 24,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
  },

  // Preview
  preview: { flex: 1 },
  previewContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 },
  previewEmpty: { color: '#52525b', fontSize: 14, fontStyle: 'italic', marginTop: 8 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272a',
    backgroundColor: '#111113',
  },
  toolBtn: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3b82f640',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toolBtnText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
  toolHint: { color: '#3f3f46', fontSize: 11, marginLeft: 'auto' },
});
