/**
 * Plan templates — start a new plan from a built-in or project template.
 *
 * Lists templates via `plan.template.list`. Selecting one reveals a small
 * form (title override + any placeholder fields), then `plan.template.create`
 * scaffolds the plan on the desktop and we jump straight into it. Also offers
 * importing a plan from `.codetrellis/plans/` via `plan.file.discover` +
 * `plan.file.import`.
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
import { useRouter, Stack } from 'expo-router';
import { rpc } from '../lib/rpc';

interface Placeholder { key: string; label?: string; default?: string }
interface PlanTemplate {
  id: string;
  label: string;
  shortDescription: string;
  longDescription?: string;
  defaultTitle?: string;
  source: string;
  placeholders: Placeholder[];
  phaseCount: number;
  docCount: number;
  itemCount?: number;
}
interface DiscoveredPlan { dir: string; name: string }

export default function PlanTemplatesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [placeholderVals, setPlaceholderVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tpls, disc] = await Promise.all([
        rpc<PlanTemplate[]>('plan.template.list'),
        rpc<DiscoveredPlan[]>('plan.file.discover').catch(() => [] as DiscoveredPlan[]),
      ]);
      setTemplates(Array.isArray(tpls) ? tpls : []);
      setDiscovered(Array.isArray(disc) ? disc : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectTemplate = useCallback((t: PlanTemplate) => {
    if (selected === t.id) { setSelected(null); return; }
    setSelected(t.id);
    setTitleDraft(t.defaultTitle ?? t.label);
    const init: Record<string, string> = {};
    for (const p of t.placeholders ?? []) init[p.key] = p.default ?? '';
    setPlaceholderVals(init);
  }, [selected]);

  const create = useCallback(async (t: PlanTemplate) => {
    setBusy(true);
    try {
      const res = await rpc<{ plan: { uid: string }; itemCount: number }>('plan.template.create', {
        templateId: t.id,
        title: titleDraft.trim() || undefined,
        placeholderValues: placeholderVals,
      });
      router.replace(`/plan-detail?uid=${res.plan.uid}`);
    } catch (e) {
      Alert.alert('Could not create plan', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [titleDraft, placeholderVals, router]);

  const importPlan = useCallback(async (d: DiscoveredPlan) => {
    setBusy(true);
    try {
      const res = await rpc<{ plan: { uid: string } | null }>('plan.file.import', { planDir: d.dir });
      if (res.plan?.uid) {
        router.replace(`/plan-detail?uid=${res.plan.uid}`);
      } else {
        Alert.alert('Imported', 'Plan imported.');
        router.back();
      }
    } catch (e) {
      Alert.alert('Could not import', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'New from template' }} />
        <ActivityIndicator color="#3b82f6" size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'New from template' }} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'New from template' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>TEMPLATES</Text>
        {templates.map((t) => {
          const open = selected === t.id;
          return (
            <View key={t.id} style={[styles.card, open && styles.cardOpen]}>
              <TouchableOpacity activeOpacity={0.8} onPress={() => selectTemplate(t)}>
                <View style={styles.cardHead}>
                  <Text style={styles.tplLabel}>{t.label}</Text>
                  {t.source !== 'builtin' && <Text style={styles.tplSource}>project</Text>}
                </View>
                <Text style={styles.tplDesc}>{t.shortDescription}</Text>
                <Text style={styles.tplMeta}>
                  {(t.itemCount ?? t.phaseCount)} items · {t.docCount} doc{t.docCount !== 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>

              {open && (
                <View style={styles.form}>
                  {t.longDescription ? <Text style={styles.longDesc}>{t.longDescription}</Text> : null}
                  <Text style={styles.fieldLabel}>Plan title</Text>
                  <TextInput
                    style={styles.input}
                    value={titleDraft}
                    onChangeText={setTitleDraft}
                    placeholder={t.defaultTitle ?? 'Plan title'}
                    placeholderTextColor="#52525b"
                  />
                  {(t.placeholders ?? []).map((p) => (
                    <View key={p.key}>
                      <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>{p.label ?? p.key}</Text>
                      <TextInput
                        style={styles.input}
                        value={placeholderVals[p.key] ?? ''}
                        onChangeText={(v) => setPlaceholderVals((prev) => ({ ...prev, [p.key]: v }))}
                        placeholder={p.default ?? p.key}
                        placeholderTextColor="#52525b"
                      />
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[styles.createBtn, busy && styles.createBtnDisabled]}
                    onPress={() => create(t)}
                    disabled={busy}
                  >
                    <Text style={styles.createBtnText}>{busy ? 'Creating…' : 'Create plan'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {discovered.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, styles.sectionSpaced]}>IMPORT FROM FILES</Text>
            <Text style={styles.importHint}>Plans found in .codetrellis/plans/ on disk.</Text>
            {discovered.map((d) => (
              <TouchableOpacity
                key={d.dir}
                style={styles.importRow}
                disabled={busy}
                onPress={() => importPlan(d)}
                activeOpacity={0.7}
              >
                <Text style={styles.importIcon}>⬇</Text>
                <Text style={styles.importName} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.importAction}>Import</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#09090b' },
  errorText: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f620', borderWidth: 1, borderColor: '#3b82f6',
    borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { color: '#3b82f6', fontWeight: '600', fontSize: 14 },

  sectionTitle: { fontSize: 11, color: '#71717a', fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  sectionSpaced: { marginTop: 26 },

  card: {
    backgroundColor: '#18181b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#27272a', marginBottom: 10,
  },
  cardOpen: { borderColor: '#3b82f640' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tplLabel: { color: '#e4e4e7', fontSize: 16, fontWeight: '700', flex: 1 },
  tplSource: {
    color: '#8b5cf6', fontSize: 10, fontWeight: '700', backgroundColor: '#8b5cf620',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  tplDesc: { color: '#a1a1aa', fontSize: 13, marginTop: 6, lineHeight: 18 },
  tplMeta: { color: '#52525b', fontSize: 12, marginTop: 6 },

  form: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#27272a', paddingTop: 14 },
  longDesc: { color: '#71717a', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  fieldLabel: { color: '#71717a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  fieldLabelSpaced: { marginTop: 14 },
  input: {
    backgroundColor: '#0c0c0e', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: '#e4e4e7', fontSize: 14, marginTop: 6,
  },
  createBtn: { backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  importHint: { color: '#71717a', fontSize: 12, marginTop: -4, marginBottom: 10 },
  importRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181b',
    borderRadius: 10, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: '#27272a',
  },
  importIcon: { color: '#3b82f6', fontSize: 16, marginRight: 12, fontWeight: '700' },
  importName: { color: '#e4e4e7', fontSize: 14, fontWeight: '500', flex: 1 },
  importAction: { color: '#3b82f6', fontSize: 13, fontWeight: '700' },
});
