/**
 * Graph file detail screen — shows symbols, imports, and importedBy
 * for a specific file in the dependency graph.
 *
 * Navigated to from the Graph tab file list or search results.
 * Uses `graph.file` RPC to fetch file detail from the desktop.
 *
 * Styling matches the desktop FileNode / SymbolNode glassomorphic
 * cards — language colors, symbol kind dots, glow accents.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { rpc } from '../lib/rpc';
import type { GraphFileDetail, GraphSymbol } from '../lib/types';

// ── Language palette (matches desktop graph-visuals.ts) ──────────────

const LANG_COLORS: Record<string, { accent: string; label: string }> = {
  typescript: { accent: '#3b82f6', label: 'TypeScript' },
  tsx:        { accent: '#3b82f6', label: 'TSX' },
  javascript: { accent: '#eab308', label: 'JavaScript' },
  jsx:        { accent: '#eab308', label: 'JSX' },
  python:     { accent: '#22c55e', label: 'Python' },
  rust:       { accent: '#f97316', label: 'Rust' },
  go:         { accent: '#06b6d4', label: 'Go' },
  css:        { accent: '#a855f7', label: 'CSS' },
  json:       { accent: '#38bdf8', label: 'JSON' },
  markdown:   { accent: '#f472b6', label: 'Markdown' },
  php:        { accent: '#818cf8', label: 'PHP' },
  java:       { accent: '#fb923c', label: 'Java' },
};

const DEFAULT_LANG = { accent: '#94a3b8', label: 'File' };

function langVisual(lang?: string) {
  return LANG_COLORS[lang || ''] ?? DEFAULT_LANG;
}

// ── Symbol kind colors (matches desktop SymbolNode) ─────────────────

const KIND_COLORS: Record<string, string> = {
  function:  '#4ade80',
  class:     '#60a5fa',
  method:    '#93c5fd',
  interface: '#c084fc',
  type:      '#d8b4fe',
  enum:      '#facc15',
  variable:  '#a1a1aa',
};

// ── Tab type ────────────────────────────────────────────────────────

type DetailTab = 'symbols' | 'imports' | 'importedBy' | 'connections' | 'source';

// Protocol accent colors for cross-system edges
const PROTOCOL_COLORS: Record<string, string> = {
  http: '#f59e0b',
  https: '#f59e0b',
  sql: '#a855f7',
  subprocess: '#ef4444',
  env: '#22c55e',
};
function protocolColor(p: string) {
  return PROTOCOL_COLORS[p?.toLowerCase()] ?? '#06b6d4';
}

// ── Component ───────────────────────────────────────────────────────

export default function GraphFileDetailScreen() {
  const router = useRouter();
  const { filePath } = useLocalSearchParams<{ filePath: string }>();
  const [detail, setDetail] = useState<GraphFileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('symbols');
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<{ content: string; truncated: boolean; lineCount: number } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  // Lazily fetch the file source the first time the Source tab is opened.
  useEffect(() => {
    if (activeTab !== 'source' || source || sourceLoading || !filePath) return;
    setSourceLoading(true);
    rpc<{ content: string; truncated: boolean; lineCount: number }>('graph.fileSource', { filePath })
      .then((r) => setSource(r))
      .catch(() => setSource({ content: '', truncated: false, lineCount: 0 }))
      .finally(() => setSourceLoading(false));
  }, [activeTab, source, sourceLoading, filePath]);

  const fetchDetail = useCallback(async () => {
    if (!filePath) return;
    setError(null);
    try {
      const data = await rpc<GraphFileDetail>('graph.file', { filePath });
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load file detail');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filePath]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDetail();
  }, [fetchDetail]);

  const fileName = filePath?.split('/').pop() ?? 'File';
  const vis = langVisual(detail?.language);

  // ── Loading state ────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error ?? 'File not found'}</Text>
        <TouchableOpacity onPress={fetchDetail} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const connectionCount =
    (detail.crossSystemOut?.length ?? 0) + (detail.crossSystemIn?.length ?? 0);

  const tabs: { key: DetailTab; label: string; count: number }[] = [
    { key: 'symbols', label: 'Symbols', count: detail.symbols.length },
    { key: 'imports', label: 'Imports', count: detail.imports.length },
    { key: 'importedBy', label: 'Imported By', count: detail.importedBy.length },
    { key: 'connections', label: 'Connections', count: connectionCount },
    { key: 'source', label: 'Source', count: source?.lineCount ?? 0 },
  ];

  return (
    <View style={styles.container}>
      {/* File header card — matches desktop FileNode glassomorphic style */}
      <View
        style={[
          styles.fileHeader,
          {
            borderColor: vis.accent + '30',
            shadowColor: vis.accent,
          },
        ]}
      >
        <View style={styles.fileHeaderTop}>
          <View
            style={[
              styles.langBadge,
              {
                backgroundColor: vis.accent + '18',
                borderColor: vis.accent + '35',
              },
            ]}
          >
            <Text style={[styles.langBadgeText, { color: vis.accent }]}>
              {vis.label}
            </Text>
          </View>
          <View style={styles.fileStatsRow}>
            <Text style={styles.fileStat}>
              {detail.symbols.length} symbol{detail.symbols.length !== 1 ? 's' : ''}
            </Text>
            <Text style={styles.fileStatSep}>·</Text>
            <Text style={styles.fileStat}>
              {detail.imports.length} import{detail.imports.length !== 1 ? 's' : ''}
            </Text>
            <Text style={styles.fileStatSep}>·</Text>
            <Text style={styles.fileStat}>
              {detail.importedBy.length} importer{detail.importedBy.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
        <Text style={styles.fileHeaderName} numberOfLines={2}>
          {fileName}
        </Text>
        <Text style={styles.fileHeaderPath} numberOfLines={1}>
          {detail.filePath}
        </Text>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive,
              ]}
            >
              {tab.label}
            </Text>
            <View
              style={[
                styles.tabBadge,
                activeTab === tab.key && styles.tabBadgeActive,
              ]}
            >
              <Text
                style={[
                  styles.tabBadgeText,
                  activeTab === tab.key && styles.tabBadgeTextActive,
                ]}
              >
                {tab.count}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
      >
        {/* ── Symbols tab ──────────────────────────────────── */}
        {activeTab === 'symbols' && (
          <>
            {detail.symbols.length === 0 ? (
              <Text style={styles.emptyText}>No top-level symbols</Text>
            ) : (
              detail.symbols.map((sym, i) => (
                <SymbolCard key={`${sym.name}-${sym.startLine}-${i}`} symbol={sym} />
              ))
            )}
          </>
        )}

        {/* ── Imports tab ──────────────────────────────────── */}
        {activeTab === 'imports' && (
          <>
            {detail.imports.length === 0 ? (
              <Text style={styles.emptyText}>No imports</Text>
            ) : (
              detail.imports.map((imp, i) => (
                <TouchableOpacity
                  key={`${imp.path}-${i}`}
                  style={styles.depCard}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push(
                      `/graph-file-detail?filePath=${encodeURIComponent(imp.path)}`
                    )
                  }
                >
                  <View style={[styles.depArrow, styles.depArrowOut]}>
                    <Text style={styles.depArrowText}>→</Text>
                  </View>
                  <View style={styles.depBody}>
                    <Text style={styles.depName} numberOfLines={1}>
                      {imp.relativePath.split('/').pop()}
                    </Text>
                    {imp.specifiers.length > 0 && (
                      <Text style={styles.depSpecifiers} numberOfLines={1}>
                        {imp.specifiers.join(', ')}
                      </Text>
                    )}
                    <Text style={styles.depPath} numberOfLines={1}>
                      {imp.relativePath}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ── Imported By tab ──────────────────────────────── */}
        {activeTab === 'importedBy' && (
          <>
            {detail.importedBy.length === 0 ? (
              <Text style={styles.emptyText}>Not imported by any files</Text>
            ) : (
              detail.importedBy.map((imp, i) => (
                <TouchableOpacity
                  key={`${imp.path}-${i}`}
                  style={styles.depCard}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push(
                      `/graph-file-detail?filePath=${encodeURIComponent(imp.path)}`
                    )
                  }
                >
                  <View style={[styles.depArrow, styles.depArrowIn]}>
                    <Text style={styles.depArrowText}>←</Text>
                  </View>
                  <View style={styles.depBody}>
                    <Text style={styles.depName} numberOfLines={1}>
                      {imp.relativePath.split('/').pop()}
                    </Text>
                    {imp.specifiers.length > 0 && (
                      <Text style={styles.depSpecifiers} numberOfLines={1}>
                        {imp.specifiers.join(', ')}
                      </Text>
                    )}
                    <Text style={styles.depPath} numberOfLines={1}>
                      {imp.relativePath}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ── Connections tab (cross-system coupling) ──────── */}
        {activeTab === 'connections' && (
          <>
            {connectionCount === 0 ? (
              <View>
                <Text style={styles.emptyText}>No cross-system connections</Text>
                <Text style={styles.emptySubtext}>
                  HTTP, SQL, or subprocess coupling detected in this file would
                  appear here.
                </Text>
              </View>
            ) : (
              <>
                {detail.crossSystemOut?.map((edge, i) => {
                  const pc = protocolColor(edge.protocol);
                  return (
                    <TouchableOpacity
                      key={`out-${edge.path}-${i}`}
                      style={styles.depCard}
                      activeOpacity={0.7}
                      onPress={() =>
                        router.push(
                          `/graph-file-detail?filePath=${encodeURIComponent(edge.path)}`
                        )
                      }
                    >
                      <View
                        style={[
                          styles.depArrow,
                          { backgroundColor: pc + '12', borderColor: pc + '25', borderWidth: 1 },
                        ]}
                      >
                        <Text style={[styles.depArrowText, { color: pc }]}>↗</Text>
                      </View>
                      <View style={styles.depBody}>
                        <Text style={styles.depName} numberOfLines={1}>
                          {edge.label || edge.relativePath.split('/').pop()}
                        </Text>
                        <View style={styles.protoRow}>
                          <View style={[styles.protoBadge, { backgroundColor: pc + '20' }]}>
                            <Text style={[styles.protoBadgeText, { color: pc }]}>
                              {edge.protocol?.toUpperCase()}
                            </Text>
                          </View>
                          <Text style={styles.protoDir}>calls →</Text>
                        </View>
                        <Text style={styles.depPath} numberOfLines={1}>
                          {edge.relativePath}
                        </Text>
                      </View>
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                  );
                })}
                {detail.crossSystemIn?.map((edge, i) => {
                  const pc = protocolColor(edge.protocol);
                  return (
                    <TouchableOpacity
                      key={`in-${edge.path}-${i}`}
                      style={styles.depCard}
                      activeOpacity={0.7}
                      onPress={() =>
                        router.push(
                          `/graph-file-detail?filePath=${encodeURIComponent(edge.path)}`
                        )
                      }
                    >
                      <View
                        style={[
                          styles.depArrow,
                          { backgroundColor: pc + '12', borderColor: pc + '25', borderWidth: 1 },
                        ]}
                      >
                        <Text style={[styles.depArrowText, { color: pc }]}>↘</Text>
                      </View>
                      <View style={styles.depBody}>
                        <Text style={styles.depName} numberOfLines={1}>
                          {edge.label || edge.relativePath.split('/').pop()}
                        </Text>
                        <View style={styles.protoRow}>
                          <View style={[styles.protoBadge, { backgroundColor: pc + '20' }]}>
                            <Text style={[styles.protoBadgeText, { color: pc }]}>
                              {edge.protocol?.toUpperCase()}
                            </Text>
                          </View>
                          <Text style={styles.protoDir}>← called by</Text>
                        </View>
                        <Text style={styles.depPath} numberOfLines={1}>
                          {edge.relativePath}
                        </Text>
                      </View>
                      <Text style={styles.chevron}>›</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </>
        )}

        {activeTab === 'source' && (
          sourceLoading ? (
            <ActivityIndicator color="#3b82f6" style={{ marginTop: 24 }} />
          ) : !source || !source.content ? (
            <Text style={styles.sourceEmpty}>Source unavailable.</Text>
          ) : (
            <View>
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <Text style={styles.sourceText} selectable>{source.content}</Text>
              </ScrollView>
              {source.truncated && (
                <Text style={styles.sourceTruncated}>… truncated (first 200 KB)</Text>
              )}
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

// ── Symbol card ─────────────────────────────────────────────────────

function SymbolCard({ symbol }: { symbol: GraphSymbol }) {
  const kindColor = KIND_COLORS[symbol.kind] ?? '#a1a1aa';
  const lineSpan = symbol.endLine - symbol.startLine + 1;

  return (
    <View style={[styles.symbolCard, { borderColor: kindColor + '20' }]}>
      <View style={[styles.symbolKindDot, { backgroundColor: kindColor }]} />
      <View style={styles.symbolBody}>
        <Text style={styles.symbolName} numberOfLines={1}>
          {symbol.name}
        </Text>
        <View style={styles.symbolMetaRow}>
          <Text style={[styles.symbolKindText, { color: kindColor }]}>
            {symbol.kind}
          </Text>
          <Text style={styles.symbolLine}>
            L{symbol.startLine}
            {lineSpan > 1 ? `–${symbol.endLine}` : ''}
          </Text>
          {symbol.modifiers.length > 0 && (
            <Text style={styles.symbolModifiers}>
              {symbol.modifiers.join(' ')}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#3b82f618',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#3b82f630',
  },
  retryText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '600',
  },

  // File header (glassomorphic card)
  fileHeader: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#141416',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  fileHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  langBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  langBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  fileStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileStat: {
    color: '#71717a',
    fontSize: 11,
  },
  fileStatSep: {
    color: '#3f3f46',
    fontSize: 11,
    marginHorizontal: 4,
  },
  fileHeaderName: {
    color: '#e4e4e7',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  fileHeaderPath: {
    color: '#52525b',
    fontSize: 11,
    fontFamily: 'monospace',
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f23',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: 4,
  },
  tabActive: {
    borderBottomColor: '#3b82f6',
  },
  tabText: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#e4e4e7',
  },
  tabBadge: {
    backgroundColor: '#27272a',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  tabBadgeActive: {
    backgroundColor: '#3b82f620',
  },
  tabBadgeText: {
    color: '#52525b',
    fontSize: 10,
    fontWeight: '700',
  },
  tabBadgeTextActive: {
    color: '#3b82f6',
  },

  // Scroll
  scrollArea: {
    flex: 1,
  },
  sourceText: {
    color: '#d4d4d8',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Menlo',
    paddingVertical: 4,
  },
  sourceEmpty: { color: '#52525b', fontSize: 13, fontStyle: 'italic', marginTop: 16, textAlign: 'center' },
  sourceTruncated: { color: '#71717a', fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyText: {
    color: '#52525b',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  emptySubtext: {
    color: '#3f3f46',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: -12,
    lineHeight: 18,
  },
  protoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  protoBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  protoBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  protoDir: {
    color: '#71717a',
    fontSize: 11,
  },

  // Symbol card
  symbolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 6,
  },
  symbolKindDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  symbolBody: {
    flex: 1,
  },
  symbolName: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  symbolMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  symbolKindText: {
    fontSize: 11,
    fontWeight: '600',
  },
  symbolLine: {
    color: '#52525b',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  symbolModifiers: {
    color: '#71717a',
    fontSize: 10,
    fontStyle: 'italic',
  },

  // Dependency card (imports / importedBy)
  depCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f1f23',
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  depArrow: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  depArrowOut: {
    backgroundColor: '#3b82f612',
    borderWidth: 1,
    borderColor: '#3b82f625',
  },
  depArrowIn: {
    backgroundColor: '#22c55e12',
    borderWidth: 1,
    borderColor: '#22c55e25',
  },
  depArrowText: {
    color: '#a1a1aa',
    fontSize: 14,
    fontWeight: '600',
  },
  depBody: {
    flex: 1,
  },
  depName: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  depSpecifiers: {
    color: '#3b82f6',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  depPath: {
    color: '#52525b',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  chevron: {
    color: '#3f3f46',
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },
});
