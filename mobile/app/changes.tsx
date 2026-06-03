/**
 * Changes screen (M6) — git working-tree diff + architectural diff vs baseline.
 *
 * Fetches `changes.summary` over RPC and shows:
 *   1. Git working tree — modified / added / deleted / untracked files
 *      (the actual `git status`), grouped with colored status chips.
 *   2. Architecture diff vs the captured baseline — files added / removed /
 *      modified, plus the blast radius (dependents affected by the change).
 *
 * Each file is tappable → opens its node in the graph file-detail screen.
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
import { useRouter } from 'expo-router';
import { rpc } from '../lib/rpc';
import { useActiveProject } from '../lib/store';
import type { ChangesSummary } from '../lib/types';

// Status → color/letter
const STATUS = {
  modified: { color: '#f59e0b', letter: 'M' },
  added: { color: '#22c55e', letter: 'A' },
  deleted: { color: '#ef4444', letter: 'D' },
  untracked: { color: '#06b6d4', letter: '?' },
  blast: { color: '#a855f7', letter: '~' },
};

type FileRow = { path: string; status: keyof typeof STATUS };

export default function ChangesScreen() {
  const router = useRouter();
  const activeProject = useActiveProject();
  const [summary, setSummary] = useState<ChangesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setError(null);
    try {
      const cs = await rpc<ChangesSummary>('changes.summary');
      setSummary(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load changes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSummary();
  }, [fetchSummary]);

  const openFile = useCallback(
    (relPath: string) => {
      if (!activeProject?.path) return;
      const abs = `${activeProject.path}/${relPath}`;
      router.push(`/graph-file-detail?filePath=${encodeURIComponent(abs)}`);
    },
    [activeProject, router],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'No change data'}</Text>
        <TouchableOpacity onPress={fetchSummary} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const git = summary.git;
  const arch = summary.arch;

  // Build git working-tree rows (dedupe, prefer most-significant status).
  const gitRows: FileRow[] = [];
  const seen = new Set<string>();
  const add = (paths: string[], status: keyof typeof STATUS) => {
    for (const p of paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      gitRows.push({ path: p, status });
    }
  };
  if (git) {
    add([...git.stagedDeleted, ...git.unstagedDeleted], 'deleted');
    add([...git.stagedModified, ...git.unstagedModified], 'modified');
    add(git.stagedAdded, 'added');
    add(git.untracked, 'untracked');
  }

  const totalGit = gitRows.length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
      }
    >
      {/* Header */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>
          {totalGit > 0 ? `${totalGit} file${totalGit !== 1 ? 's' : ''} changed` : 'Working tree clean'}
        </Text>
        <Text style={styles.headerMeta}>
          {git?.shortCommitHash ? `HEAD @ ${git.shortCommitHash}` : 'no commit'}
          {summary.hasBaseline ? ' · baseline captured' : ' · no baseline'}
        </Text>
      </View>

      {/* Git working tree */}
      <Text style={styles.sectionLabel}>WORKING TREE</Text>
      {totalGit === 0 ? (
        <Text style={styles.emptyHint}>No uncommitted changes</Text>
      ) : (
        gitRows.map((row, i) => (
          <FileRowCard key={`git-${row.path}-${i}`} row={row} onPress={() => openFile(row.path)} />
        ))
      )}

      {/* Architecture diff vs baseline */}
      {arch && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
            VS BASELINE (ARCHITECTURE)
          </Text>
          <View style={styles.archSummaryRow}>
            <ArchStat label="added" value={arch.summary.added} color={STATUS.added.color} />
            <ArchStat label="modified" value={arch.summary.modified} color={STATUS.modified.color} />
            <ArchStat label="removed" value={arch.summary.removed} color={STATUS.deleted.color} />
          </View>

          {arch.addedFiles.map((p, i) => (
            <FileRowCard key={`a-${p}-${i}`} row={{ path: p, status: 'added' }} onPress={() => openFile(p)} />
          ))}
          {arch.modifiedFiles.map((p, i) => (
            <FileRowCard key={`m-${p}-${i}`} row={{ path: p, status: 'modified' }} onPress={() => openFile(p)} />
          ))}
          {arch.removedFiles.map((p, i) => (
            <FileRowCard key={`r-${p}-${i}`} row={{ path: p, status: 'deleted' }} onPress={() => {}} />
          ))}

          {arch.blastRadius.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
                BLAST RADIUS ({arch.blastRadius.length})
              </Text>
              <Text style={styles.blastHint}>
                Files that depend on what changed — review for ripple effects.
              </Text>
              {arch.blastRadius.slice(0, 30).map((p, i) => (
                <FileRowCard key={`b-${p}-${i}`} row={{ path: p, status: 'blast' }} onPress={() => openFile(p)} />
              ))}
            </>
          )}
        </>
      )}

      {!summary.hasBaseline && (
        <Text style={[styles.emptyHint, { marginTop: 16 }]}>
          No baseline captured — scan a project on the desktop to enable
          architecture-diff tracking.
        </Text>
      )}
    </ScrollView>
  );
}

function FileRowCard({ row, onPress }: { row: FileRow; onPress: () => void }) {
  const s = STATUS[row.status];
  const name = row.path.split('/').pop();
  return (
    <TouchableOpacity style={styles.fileRow} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.statusChip, { backgroundColor: s.color + '20', borderColor: s.color + '40' }]}>
        <Text style={[styles.statusChipText, { color: s.color }]}>{s.letter}</Text>
      </View>
      <View style={styles.fileRowBody}>
        <Text style={styles.fileRowName} numberOfLines={1}>{name}</Text>
        <Text style={styles.fileRowPath} numberOfLines={1}>{row.path}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function ArchStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.archStat, { borderColor: color + '25' }]}>
      <Text style={[styles.archStatValue, { color }]}>{value}</Text>
      <Text style={styles.archStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  errorText: { color: '#ef4444', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: '#3b82f618', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10,
    borderWidth: 1, borderColor: '#3b82f630',
  },
  retryText: { color: '#3b82f6', fontSize: 14, fontWeight: '600' },

  headerCard: {
    backgroundColor: '#141416', borderRadius: 16, borderWidth: 1, borderColor: '#27272a',
    padding: 16, marginBottom: 20,
  },
  headerTitle: { color: '#e4e4e7', fontSize: 18, fontWeight: '700' },
  headerMeta: { color: '#71717a', fontSize: 12, marginTop: 4, fontFamily: 'monospace' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#52525b', letterSpacing: 1, marginBottom: 10,
  },
  emptyHint: { color: '#52525b', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  blastHint: { color: '#71717a', fontSize: 12, marginTop: -4, marginBottom: 10, lineHeight: 17 },

  archSummaryRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  archStat: {
    flex: 1, backgroundColor: '#141416', borderRadius: 12, borderWidth: 1,
    paddingVertical: 12, alignItems: 'center',
  },
  archStatValue: { fontSize: 20, fontWeight: '700' },
  archStatLabel: { fontSize: 10, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#141416',
    borderRadius: 12, borderWidth: 1, borderColor: '#1f1f23',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
  },
  statusChip: {
    width: 26, height: 26, borderRadius: 7, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  statusChipText: { fontSize: 13, fontWeight: '800' },
  fileRowBody: { flex: 1 },
  fileRowName: { color: '#e4e4e7', fontSize: 14, fontWeight: '600' },
  fileRowPath: { color: '#52525b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  chevron: { color: '#3f3f46', fontSize: 20, fontWeight: '300', marginLeft: 8 },
});
