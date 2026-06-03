/**
 * Graph tab — interactive drill-down dependency browser (M4).
 *
 * Hierarchy: Overview → Directory → Files (tap file → file detail screen).
 * Glassomorphic cards match the desktop graph node styling — language
 * colors, symbol kind colors, glow accents.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useActiveProject, useConnectionState } from '../../lib/store';
import { rpc } from '../../lib/rpc';
import type {
  GraphOverview,
  GraphDirectoryListing,
  GraphSearchResult,
  ChangesSummary,
} from '../../lib/types';

// ── Language palette (matches desktop graph-visuals.ts) ──────────────

const LANG_COLORS: Record<string, { accent: string; bg: string; label: string }> = {
  typescript: { accent: '#3b82f6', bg: 'rgba(59,130,246,0.14)', label: 'TS' },
  tsx:        { accent: '#3b82f6', bg: 'rgba(59,130,246,0.14)', label: 'TSX' },
  javascript: { accent: '#eab308', bg: 'rgba(234,179,8,0.12)', label: 'JS' },
  jsx:        { accent: '#eab308', bg: 'rgba(234,179,8,0.12)', label: 'JSX' },
  python:     { accent: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: 'PY' },
  rust:       { accent: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'RS' },
  go:         { accent: '#06b6d4', bg: 'rgba(6,182,212,0.12)', label: 'GO' },
  css:        { accent: '#a855f7', bg: 'rgba(168,85,247,0.12)', label: 'CSS' },
  json:       { accent: '#38bdf8', bg: 'rgba(56,189,248,0.10)', label: 'JSON' },
  markdown:   { accent: '#f472b6', bg: 'rgba(244,114,182,0.10)', label: 'MD' },
  php:        { accent: '#818cf8', bg: 'rgba(129,140,248,0.12)', label: 'PHP' },
  java:       { accent: '#fb923c', bg: 'rgba(251,146,60,0.12)', label: 'JAVA' },
};

const DEFAULT_LANG = { accent: '#94a3b8', bg: 'rgba(148,163,184,0.14)', label: 'FILE' };

function langVisual(lang?: string) {
  return LANG_COLORS[lang || ''] ?? DEFAULT_LANG;
}

// ── Symbol kind colors (matches desktop SymbolNode) ─────────────────

const KIND_COLORS: Record<string, string> = {
  function: '#4ade80',
  class: '#60a5fa',
  method: '#93c5fd',
  interface: '#c084fc',
  type: '#d8b4fe',
  enum: '#facc15',
  variable: '#a1a1aa',
};

// ── Breadcrumb types ────────────────────────────────────────────────

type BreadcrumbLevel =
  | { type: 'overview' }
  | { type: 'directory'; dir: string; label: string };

// ── Component ───────────────────────────────────────────────────────

export default function GraphTab() {
  const router = useRouter();
  const activeProject = useActiveProject();
  const connectionState = useConnectionState();
  const connected = connectionState === 'connected';

  // Navigation stack
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbLevel[]>([
    { type: 'overview' },
  ]);

  // Data
  const [overview, setOverview] = useState<GraphOverview | null>(null);
  const [dirListing, setDirListing] = useState<GraphDirectoryListing | null>(null);
  const [searchResults, setSearchResults] = useState<GraphSearchResult[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangesSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Set of changed relative paths for badging files in the graph.
  const changedSet = useMemo(
    () => new Set(changes?.changedFiles ?? []),
    [changes],
  );

  const currentLevel = breadcrumb[breadcrumb.length - 1];

  // ── Fetch overview on mount / project change ─────────────────────
  useEffect(() => {
    if (!connected) return;
    fetchOverview();
  }, [connected, activeProject?.path]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await rpc<GraphOverview>('graph.overview');
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
    // Fetch change summary in the background (non-fatal if it fails).
    try {
      const cs = await rpc<ChangesSummary>('changes.summary');
      setChanges(cs);
    } catch {
      setChanges(null);
    }
  }, []);

  // ── Navigate into a directory ────────────────────────────────────
  const openDirectory = useCallback(async (dir: string, label: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await rpc<GraphDirectoryListing>('graph.directory', { dir });
      setDirListing(data);
      setBreadcrumb((prev) => [...prev, { type: 'directory', dir, label }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Navigate back ────────────────────────────────────────────────
  const goBack = useCallback(() => {
    if (breadcrumb.length <= 1) return;
    const newCrumb = breadcrumb.slice(0, -1);
    setBreadcrumb(newCrumb);

    const target = newCrumb[newCrumb.length - 1];
    if (target.type === 'overview') {
      setDirListing(null);
    } else if (target.type === 'directory') {
      // Re-fetch parent directory
      setLoading(true);
      rpc<GraphDirectoryListing>('graph.directory', { dir: target.dir })
        .then((data) => setDirListing(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [breadcrumb]);

  // ── Search ───────────────────────────────────────────────────────
  const doSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await rpc<GraphSearchResult[]>('graph.search', { query: q });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }, []);

  // ── Pull-to-refresh: re-fetch overview + change summary ─────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOverview();
    setRefreshing(false);
  }, [fetchOverview]);

  // ── Computed stats for overview ──────────────────────────────────
  const langChips = useMemo(() => {
    if (!overview) return [];
    return overview.languageBreakdown.slice(0, 8);
  }, [overview]);

  // ── Not connected / no project ───────────────────────────────────
  if (!connected) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>#</Text>
        <Text style={styles.emptyTitle}>Dependency Graph</Text>
        <Text style={styles.emptyBody}>
          Connect to a desktop to browse the dependency graph.
        </Text>
      </View>
    );
  }

  if (!activeProject && !overview) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>#</Text>
        <Text style={styles.emptyTitle}>Dependency Graph</Text>
        <Text style={styles.emptyBody}>
          Open a project on the desktop to explore the dependency graph.
        </Text>
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search symbols..."
          placeholderTextColor="#52525b"
          value={searchQuery}
          onChangeText={doSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => { setSearchQuery(''); setSearchResults(null); }}
            style={styles.searchClear}
          >
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search results overlay */}
      {searchResults !== null ? (
        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionLabel}>
            {searchResults.length} RESULT{searchResults.length !== 1 ? 'S' : ''}
          </Text>
          {searchResults.length === 0 ? (
            <Text style={styles.emptyHint}>No symbols match "{searchQuery}"</Text>
          ) : (
            searchResults.map((r, i) => {
              const kindColor = KIND_COLORS[r.kind] ?? '#a1a1aa';
              return (
                <TouchableOpacity
                  key={`${r.filePath}:${r.startLine}:${i}`}
                  style={styles.searchResultCard}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push(
                      `/graph-file-detail?filePath=${encodeURIComponent(r.filePath)}`
                    )
                  }
                >
                  <View style={[styles.kindDot, { backgroundColor: kindColor }]} />
                  <View style={styles.searchResultBody}>
                    <Text style={styles.searchResultName} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={styles.searchResultMeta} numberOfLines={1}>
                      {r.kind} · {r.relativePath}:{r.startLine}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      ) : (
        <>
          {/* Breadcrumb */}
          {breadcrumb.length > 1 && (
            <View style={styles.breadcrumbRow}>
              <TouchableOpacity onPress={goBack} style={styles.breadcrumbBack}>
                <Text style={styles.breadcrumbBackText}>‹</Text>
              </TouchableOpacity>
              {breadcrumb.map((crumb, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    if (i < breadcrumb.length - 1) {
                      // Navigate back to this level
                      const newCrumb = breadcrumb.slice(0, i + 1);
                      setBreadcrumb(newCrumb);
                      const target = newCrumb[newCrumb.length - 1];
                      if (target.type === 'overview') {
                        setDirListing(null);
                      } else if (target.type === 'directory') {
                        setLoading(true);
                        rpc<GraphDirectoryListing>('graph.directory', { dir: target.dir })
                          .then((data) => setDirListing(data))
                          .catch(() => {})
                          .finally(() => setLoading(false));
                      }
                    }
                  }}
                  disabled={i === breadcrumb.length - 1}
                >
                  <Text
                    style={[
                      styles.breadcrumbText,
                      i === breadcrumb.length - 1 && styles.breadcrumbTextActive,
                    ]}
                  >
                    {i > 0 ? ' / ' : ''}
                    {crumb.type === 'overview' ? 'Overview' : crumb.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#3b82f6" />
            </View>
          )}

          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={fetchOverview}>
                <Text style={styles.errorRetry}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

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
            {/* ── Overview level ─────────────────────────────── */}
            {currentLevel.type === 'overview' && overview && (
              <>
                {/* Stats row */}
                <View style={styles.statsRow}>
                  <StatCard label="Files" value={overview.fileCount} color="#3b82f6" />
                  <StatCard label="Symbols" value={overview.symbolCount} color="#22c55e" />
                  <StatCard label="Imports" value={overview.importCount} color="#a855f7" />
                </View>

                {/* Changes banner — git working-tree + arch diff vs baseline */}
                {changes && (changes.changedFiles.length > 0 || changes.arch) && (
                  <TouchableOpacity
                    style={styles.changesBanner}
                    activeOpacity={0.7}
                    onPress={() => router.push('/changes')}
                  >
                    <View style={styles.changesDot} />
                    <View style={styles.changesBody}>
                      <Text style={styles.changesTitle}>
                        {changes.changedFiles.length > 0
                          ? `${changes.changedFiles.length} file${changes.changedFiles.length !== 1 ? 's' : ''} changed`
                          : 'Working tree clean'}
                      </Text>
                      <Text style={styles.changesMeta} numberOfLines={1}>
                        {changes.git?.shortCommitHash ? `@ ${changes.git.shortCommitHash} · ` : ''}
                        {changes.arch
                          ? `+${changes.arch.summary.added} ~${changes.arch.summary.modified} −${changes.arch.summary.removed} vs baseline`
                          : 'tap to view diff'}
                      </Text>
                    </View>
                    <Text style={styles.changesChevron}>›</Text>
                  </TouchableOpacity>
                )}

                {/* Language breakdown chips */}
                {langChips.length > 0 && (
                  <View style={styles.langChipRow}>
                    {langChips.map((lc) => {
                      const vis = langVisual(lc.language);
                      return (
                        <View
                          key={lc.language}
                          style={[styles.langChip, { borderColor: vis.accent + '40' }]}
                        >
                          <View style={[styles.langDot, { backgroundColor: vis.accent }]} />
                          <Text style={[styles.langChipText, { color: vis.accent }]}>
                            {vis.label}
                          </Text>
                          <Text style={styles.langChipCount}>{lc.count}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Directories */}
                <Text style={styles.sectionLabel}>DIRECTORIES</Text>
                {overview.topDirectories.map((dir) => (
                  <TouchableOpacity
                    key={dir.dir}
                    style={styles.directoryCard}
                    activeOpacity={0.7}
                    onPress={() => openDirectory(dir.dir, dir.dir)}
                  >
                    <View style={styles.dirIconBox}>
                      <Text style={styles.dirIcon}>📁</Text>
                    </View>
                    <View style={styles.dirBody}>
                      <Text style={styles.dirName} numberOfLines={1}>
                        {dir.dir}
                      </Text>
                      <Text style={styles.dirMeta}>
                        {dir.fileCount} file{dir.fileCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                ))}

                {/* Most imported files */}
                {overview.mostImported.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
                      MOST IMPORTED
                    </Text>
                    {overview.mostImported.slice(0, 6).map((mi) => (
                      <TouchableOpacity
                        key={mi.path}
                        style={styles.hubCard}
                        activeOpacity={0.7}
                        onPress={() =>
                          router.push(
                            `/graph-file-detail?filePath=${encodeURIComponent(mi.path)}`
                          )
                        }
                      >
                        <View style={styles.hubGlow} />
                        <View style={styles.hubBody}>
                          <Text style={styles.hubName} numberOfLines={1}>
                            {mi.path.split('/').pop()}
                          </Text>
                          <Text style={styles.hubMeta}>
                            imported by {mi.importerCount} file
                            {mi.importerCount !== 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Text style={styles.chevron}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}

                {/* Symbol kind breakdown */}
                {overview.symbolsByKind.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
                      SYMBOL KINDS
                    </Text>
                    <View style={styles.kindGrid}>
                      {overview.symbolsByKind.slice(0, 8).map((sk) => {
                        const color = KIND_COLORS[sk.kind] ?? '#a1a1aa';
                        return (
                          <View key={sk.kind} style={styles.kindChip}>
                            <View
                              style={[styles.kindDot, { backgroundColor: color }]}
                            />
                            <Text style={styles.kindLabel}>{sk.kind}</Text>
                            <Text style={styles.kindCount}>{sk.count}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </>
                )}
              </>
            )}

            {/* ── Directory level ────────────────────────────── */}
            {currentLevel.type === 'directory' && dirListing && (
              <>
                {/* Subdirectories */}
                {dirListing.subdirectories.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>SUBDIRECTORIES</Text>
                    {dirListing.subdirectories.map((sd) => (
                      <TouchableOpacity
                        key={sd.name}
                        style={styles.directoryCard}
                        activeOpacity={0.7}
                        onPress={() =>
                          openDirectory(
                            `${currentLevel.dir}/${sd.name}`,
                            sd.name,
                          )
                        }
                      >
                        <View style={styles.dirIconBox}>
                          <Text style={styles.dirIcon}>📁</Text>
                        </View>
                        <View style={styles.dirBody}>
                          <Text style={styles.dirName} numberOfLines={1}>
                            {sd.name}
                          </Text>
                          <Text style={styles.dirMeta}>
                            {sd.fileCount} file{sd.fileCount !== 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Text style={styles.chevron}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}

                {/* Files */}
                {dirListing.files.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: dirListing.subdirectories.length > 0 ? 20 : 0 }]}>
                      FILES
                    </Text>
                    {dirListing.files.map((file) => {
                      const vis = langVisual(file.language);
                      const connections = file.importCount + file.importedByCount;
                      return (
                        <TouchableOpacity
                          key={file.path}
                          style={[
                            styles.fileCard,
                            {
                              borderColor: vis.accent + '28',
                              shadowColor: vis.accent,
                            },
                          ]}
                          activeOpacity={0.7}
                          onPress={() =>
                            router.push(
                              `/graph-file-detail?filePath=${encodeURIComponent(file.path)}`
                            )
                          }
                        >
                          {/* Language badge */}
                          <View
                            style={[
                              styles.fileLangBadge,
                              {
                                backgroundColor: vis.accent + '18',
                                borderColor: vis.accent + '30',
                              },
                            ]}
                          >
                            <Text
                              style={[styles.fileLangText, { color: vis.accent }]}
                            >
                              {vis.label}
                            </Text>
                          </View>

                          {/* File info */}
                          <View style={styles.fileBody}>
                            <View style={styles.fileNameRow}>
                              {changedSet.has(file.relativePath) && (
                                <View style={styles.changedDot} />
                              )}
                              <Text style={styles.fileName} numberOfLines={1}>
                                {file.relativePath.split('/').pop()}
                              </Text>
                            </View>
                            <View style={styles.fileMetaRow}>
                              {file.symbolCount > 0 && (
                                <Text style={styles.fileMeta}>
                                  {file.symbolCount} symbol
                                  {file.symbolCount !== 1 ? 's' : ''}
                                </Text>
                              )}
                              {connections > 0 && (
                                <Text style={styles.fileMeta}>
                                  {connections} connection
                                  {connections !== 1 ? 's' : ''}
                                </Text>
                              )}
                            </View>
                          </View>

                          {/* Connection indicator */}
                          {connections > 5 && (
                            <View style={[styles.hubIndicator, { backgroundColor: vis.accent + '20' }]}>
                              <Text style={[styles.hubIndicatorText, { color: vis.accent }]}>
                                hub
                              </Text>
                            </View>
                          )}

                          <Text style={styles.chevron}>›</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {dirListing.files.length === 0 && dirListing.subdirectories.length === 0 && (
                  <Text style={styles.emptyHint}>Empty directory</Text>
                )}
              </>
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ── Stat card component ─────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statCard, { borderColor: color + '20' }]}>
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    backgroundColor: '#09090b',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 48,
    color: '#27272a',
    marginBottom: 16,
    fontWeight: '700',
  },
  emptyTitle: {
    color: '#a1a1aa',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyBody: {
    color: '#52525b',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyHint: {
    color: '#52525b',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#18181b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: '#e4e4e7',
    fontSize: 14,
    paddingVertical: 10,
  },
  searchClear: {
    padding: 4,
  },
  searchClearText: {
    color: '#71717a',
    fontSize: 14,
  },

  // Breadcrumb
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f23',
  },
  breadcrumbBack: {
    paddingRight: 8,
  },
  breadcrumbBackText: {
    color: '#3b82f6',
    fontSize: 22,
    fontWeight: '600',
    marginTop: -2,
  },
  breadcrumbText: {
    color: '#71717a',
    fontSize: 12,
    fontWeight: '500',
  },
  breadcrumbTextActive: {
    color: '#d4d4d8',
  },

  // Loading / Error
  loadingRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ef444418',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    flex: 1,
  },
  errorRetry: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 12,
  },

  // Scroll
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#141416',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Language chips
  langChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#141416',
  },
  langDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  langChipText: {
    fontSize: 11,
    fontWeight: '600',
    marginRight: 4,
  },
  langChipCount: {
    fontSize: 11,
    fontWeight: '500',
    color: '#71717a',
  },

  // Changes banner
  changesBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1410',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f59e0b40',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  changesDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f59e0b',
    marginRight: 12,
  },
  changesBody: {
    flex: 1,
  },
  changesTitle: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '700',
  },
  changesMeta: {
    color: '#a16207',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  changesChevron: {
    color: '#f59e0b',
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },

  // Changed-file dot badge
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  changedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#f59e0b',
    marginRight: 7,
  },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#52525b',
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Directory card
  directoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f1f23',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  dirIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#3b82f610',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  dirIcon: {
    fontSize: 18,
  },
  dirBody: {
    flex: 1,
  },
  dirName: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  dirMeta: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 2,
  },
  chevron: {
    color: '#3f3f46',
    fontSize: 20,
    fontWeight: '300',
    marginLeft: 8,
  },

  // Hub / most-imported card
  hubCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3b82f618',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
    overflow: 'hidden',
  },
  hubGlow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#3b82f6',
    borderRadius: 2,
  },
  hubBody: {
    flex: 1,
    marginLeft: 6,
  },
  hubName: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  hubMeta: {
    color: '#3b82f6',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },

  // Kind chips
  kindGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1f1f23',
  },
  kindDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  kindLabel: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '500',
    marginRight: 6,
  },
  kindCount: {
    color: '#52525b',
    fontSize: 11,
    fontWeight: '600',
  },

  // File card (directory view)
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  fileLangBadge: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
  },
  fileLangText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  fileBody: {
    flex: 1,
  },
  fileName: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  fileMetaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 3,
  },
  fileMeta: {
    color: '#71717a',
    fontSize: 11,
  },
  hubIndicator: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  hubIndicatorText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Search results
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141416',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f23',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  searchResultBody: {
    flex: 1,
    marginLeft: 2,
  },
  searchResultName: {
    color: '#e4e4e7',
    fontSize: 14,
    fontWeight: '600',
  },
  searchResultMeta: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 2,
  },
});
