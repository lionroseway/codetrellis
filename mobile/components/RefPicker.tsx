/**
 * RefPicker — @-mention style reference inserter. Opens as a modal over the
 * body editor; searches the plan's items and the codebase symbols, and on
 * select hands back the desktop chip syntax to splice into the body:
 *
 *   item   → [[item:UID|title]]   (or [[action:UID|title]] for actions)
 *   symbol → [[symbol:name@path|name]]
 *   file   → [[file:path|filename]]
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { rpc } from '../lib/rpc';

interface ItemLite { uid: string; title: string; kind: string }
interface SymbolLite { name: string; kind: string; relativePath: string }
interface FileLite { path: string; relativePath: string; name: string }
type Tab = 'items' | 'files' | 'symbols';

export default function RefPicker({
  visible,
  planUid,
  onClose,
  onInsert,
}: {
  visible: boolean;
  planUid?: string;
  onClose: () => void;
  onInsert: (chip: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('items');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ItemLite[]>([]);
  const [files, setFiles] = useState<FileLite[]>([]);
  const [symbols, setSymbols] = useState<SymbolLite[]>([]);
  const [loading, setLoading] = useState(false);

  // Load the plan's items once when opened.
  useEffect(() => {
    if (!visible || !planUid) return;
    rpc<ItemLite[]>('plan.items', { planUid })
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch(() => setItems([]));
  }, [visible, planUid]);

  // Debounced file / symbol search (both need a query).
  useEffect(() => {
    if (!visible || (tab !== 'symbols' && tab !== 'files') || query.trim().length < 2) {
      if (tab === 'symbols') setSymbols([]);
      if (tab === 'files') setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const method = tab === 'symbols' ? 'graph.search' : 'graph.fileSearch';
    const t = setTimeout(() => {
      rpc<any[]>(method, { query: query.trim() })
        .then((r) => {
          if (cancelled) return;
          if (tab === 'symbols') setSymbols(Array.isArray(r) ? r.slice(0, 40) : []);
          else setFiles(Array.isArray(r) ? r.slice(0, 40) : []);
        })
        .catch(() => { if (!cancelled) { if (tab === 'symbols') setSymbols([]); else setFiles([]); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [visible, tab, query]);

  const filteredItems = items.filter((i) =>
    !query.trim() || i.title.toLowerCase().includes(query.toLowerCase()),
  );

  const pickItem = useCallback((it: ItemLite) => {
    const kind = it.kind === 'action' ? 'action' : 'item';
    onInsert(`[[${kind}:${it.uid}|${it.title}]]`);
    onClose();
  }, [onInsert, onClose]);

  const pickFile = useCallback((f: FileLite) => {
    onInsert(`[[file:${f.relativePath}|${f.name}]]`);
    onClose();
  }, [onInsert, onClose]);

  const pickSymbol = useCallback((s: SymbolLite) => {
    onInsert(`[[symbol:${s.name}@${s.relativePath}|${s.name}]]`);
    onClose();
  }, [onInsert, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Insert reference</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabs}>
            {(['items', 'files', 'symbols'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tab, tab === t && styles.tabActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'items' ? 'Items' : t === 'files' ? 'Files' : 'Symbols'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={
              tab === 'items' ? 'Filter items…'
                : tab === 'files' ? 'Search files (2+ chars)…'
                : 'Search symbols (2+ chars)…'
            }
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />

          {tab === 'files' ? (
            <FlatList
              data={files}
              keyExtractor={(f, i) => `${f.relativePath}:${i}`}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                loading ? <ActivityIndicator color="#3b82f6" style={{ marginTop: 16 }} />
                  : <Text style={styles.empty}>{query.trim().length < 2 ? 'Type to search' : 'No files'}</Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => pickFile(item)}>
                  <Text style={[styles.rowIcon, { color: '#a78bfa' }]}>▢</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{item.relativePath}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          ) : tab === 'items' ? (
            <FlatList
              data={filteredItems}
              keyExtractor={(i) => i.uid}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={<Text style={styles.empty}>No items</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => pickItem(item)}>
                  <Text style={styles.rowIcon}>{item.kind === 'action' ? '⚡' : '▢'}</Text>
                  <Text style={styles.rowText} numberOfLines={1}>{item.title}</Text>
                </TouchableOpacity>
              )}
            />
          ) : (
            <FlatList
              data={symbols}
              keyExtractor={(s, i) => `${s.name}:${s.relativePath}:${i}`}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                loading ? <ActivityIndicator color="#3b82f6" style={{ marginTop: 16 }} />
                  : <Text style={styles.empty}>{query.trim().length < 2 ? 'Type to search' : 'No symbols'}</Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => pickSymbol(item)}>
                  <Text style={[styles.rowIcon, { color: '#22d3ee' }]}>#</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{item.kind} · {item.relativePath}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#111113',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 28,
    maxHeight: '75%',
    borderTopWidth: 1,
    borderColor: '#27272a',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: '#e4e4e7', fontSize: 16, fontWeight: '700' },
  close: { color: '#3b82f6', fontSize: 15, fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tab: {
    flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
  },
  tabActive: { backgroundColor: '#3b82f620', borderColor: '#3b82f6' },
  tabText: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#3b82f6' },
  search: {
    backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#27272a',
    color: '#e4e4e7', fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a',
  },
  rowIcon: { fontSize: 14, color: '#a1a1aa', width: 18, textAlign: 'center' },
  rowText: { color: '#e4e4e7', fontSize: 14, flexShrink: 1 },
  rowSub: { color: '#52525b', fontSize: 11, marginTop: 1 },
  empty: { color: '#52525b', fontSize: 13, textAlign: 'center', marginTop: 16 },
});
