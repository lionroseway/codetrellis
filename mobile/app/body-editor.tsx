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
  const [pickerOpen, setPickerOpen] = useState(false);

  const effectivePlanUid = target === 'plan' ? uid : planUid;

  const insertChip = useCallback((chip: string) => {
    setText((t) => {
      const start = Math.min(sel.start, t.length);
      const end = Math.min(sel.end, t.length);
      const next = t.slice(0, start) + chip + t.slice(end);
      return next;
    });
  }, [sel]);

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
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
            placeholder="Write markdown… # headings, - lists, ```code```"
            placeholderTextColor="#52525b"
            multiline
            autoFocus
            textAlignVertical="top"
          />
          {!!effectivePlanUid && (
            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.toolBtn} onPress={() => setPickerOpen(true)}>
                <Text style={styles.toolBtnText}>＠ Insert reference</Text>
              </TouchableOpacity>
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
  input: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Menlo',
    padding: 16,
  },
  toolbar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#27272a',
    backgroundColor: '#111113',
  },
  toolBtn: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toolBtnText: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
});
