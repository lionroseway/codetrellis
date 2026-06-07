/**
 * Plans tab — plan list with progress bars, status filters, and
 * project scope filter.
 *
 * Shows all plans from the workspace snapshot. Each plan card
 * displays name, status, item counts, and a progress bar.
 *
 * Project scope chips: All / per-project (derived from unique
 * project paths in the plans list + active project).
 * Status filter chips: All / Active / Draft / Completed.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { usePlans, useDeviationCounts, useActiveProject } from '../../lib/store';
import { rpc } from '../../lib/rpc';

type StatusFilter = 'all' | 'active' | 'draft' | 'completed';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'completed', label: 'Done' },
];

function matchesFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'active' || status === 'in_progress';
  if (filter === 'draft') return status === 'draft' || status === 'planning';
  if (filter === 'completed') return status === 'completed' || status === 'done';
  return true;
}

/** Extract the last path component as a short project name. */
function shortName(path: string): string {
  return path.split('/').pop() || path;
}

export default function PlansTab() {
  const router = useRouter();
  const plans = usePlans();
  const deviationCounts = useDeviationCounts();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // Project scope: 'all' or a projectPath string. Default to 'all' so every
  // plan is visible — plans often live in projects other than the active one
  // (and the active project may have none). Tap a project chip to narrow.
  const [projectScope, setProjectScope] = useState<'all' | string>('all');
  const activeProject = useActiveProject();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const createPlan = useCallback(async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      const plan = await rpc<{ uid: string }>('plan.create', {
        title: newTitle.trim(),
        ...(activeProject?.path ? { projectPath: activeProject.path } : {}),
      });
      setNewTitle('');
      setCreating(false);
      router.push(`/plan-detail?uid=${plan.uid}`);
    } catch (err: unknown) {
      Alert.alert('Could not create plan', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [newTitle, activeProject, router]);

  // Derive unique projects from the plans list for scope chips
  const projectChips = useMemo(() => {
    const paths = new Set<string>();
    for (const p of plans) {
      if (p.projectPath) paths.add(p.projectPath);
    }
    return [...paths].sort().map((path) => ({
      path,
      name: shortName(path),
    }));
  }, [plans]);

  const filteredPlans = useMemo(
    () =>
      plans
        .filter((p) => matchesFilter(p.status, statusFilter))
        .filter((p) =>
          projectScope === 'all' ? true : p.projectPath === projectScope,
        ),
    [plans, statusFilter, projectScope],
  );

  // Build a quick lookup for deviation counts per plan
  const deviationsByPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of deviationCounts.byPlan) {
      map.set(entry.planUid, entry.count);
    }
    return map;
  }, [deviationCounts]);

  return (
    <View style={styles.container}>
      {/* New plan */}
      <View style={styles.newRow}>
        <Text style={styles.newRowTitle}>PLANS</Text>
        {!creating && (
          <View style={styles.newBtnGroup}>
            <TouchableOpacity style={styles.newBtnGhost} onPress={() => router.push('/plan-templates')}>
              <Text style={styles.newBtnGhostText}>Template</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.newBtn} onPress={() => setCreating(true)}>
              <Text style={styles.newBtnText}>＋ New plan</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {creating && (
        <View style={styles.createBox}>
          <TextInput
            style={styles.createInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Plan title…"
            placeholderTextColor="#52525b"
            autoFocus
          />
          <View style={styles.createActions}>
            <TouchableOpacity onPress={() => { setCreating(false); setNewTitle(''); }} hitSlop={8}>
              <Text style={styles.createCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.createBtn, (!newTitle.trim() || busy) && styles.createBtnDisabled]}
              onPress={createPlan}
              disabled={!newTitle.trim() || busy}
            >
              <Text style={styles.createBtnText}>{busy ? '…' : 'Create'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Project scope chips */}
      {projectChips.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.projectScroll}
        >
          <TouchableOpacity
            style={[styles.chip, projectScope === 'all' && styles.chipActive]}
            onPress={() => setProjectScope('all')}
          >
            <Text
              style={[
                styles.chipText,
                projectScope === 'all' && styles.chipTextActive,
              ]}
            >
              All projects
            </Text>
          </TouchableOpacity>
          {projectChips.map((pc) => (
            <TouchableOpacity
              key={pc.path}
              style={[
                styles.chip,
                projectScope === pc.path && styles.chipActive,
              ]}
              onPress={() => setProjectScope(pc.path)}
            >
              <Text
                style={[
                  styles.chipText,
                  projectScope === pc.path && styles.chipTextActive,
                ]}
                numberOfLines={1}
              >
                {pc.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Status filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, statusFilter === f.key && styles.chipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text
              style={[
                styles.chipText,
                statusFilter === f.key && styles.chipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Plan list */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {filteredPlans.length > 0 ? (
          filteredPlans.map((plan) => {
            const pct =
              plan.itemCount > 0
                ? Math.round((plan.doneCount / plan.itemCount) * 100)
                : 0;
            const deviations = deviationsByPlan.get(plan.uid) ?? 0;

            return (
              <TouchableOpacity
                key={plan.uid}
                style={styles.planCard}
                activeOpacity={0.7}
                onPress={() => router.push(`/plan-detail?uid=${plan.uid}`)}
              >
                <View style={styles.planHeader}>
                  <Text style={styles.planName} numberOfLines={1}>
                    {plan.name}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      plan.status === 'active' || plan.status === 'in_progress'
                        ? styles.statusActive
                        : plan.status === 'completed' || plan.status === 'done'
                          ? styles.statusDone
                          : styles.statusDraft,
                    ]}
                  >
                    <Text style={styles.statusText}>{plan.status}</Text>
                  </View>
                  <Text style={styles.planChevron}>&gt;</Text>
                </View>

                {/* Show project name when viewing all projects */}
                {projectScope === 'all' && plan.projectPath && (
                  <Text style={styles.planProject} numberOfLines={1}>
                    {shortName(plan.projectPath)}
                  </Text>
                )}

                <Text style={styles.planMeta}>
                  {plan.doneCount}/{plan.itemCount} items done
                  {plan.inProgressCount > 0 &&
                    ` · ${plan.inProgressCount} in progress`}
                </Text>

                {deviations > 0 && (
                  <Text style={styles.deviationText}>
                    ! {deviations} deviation{deviations !== 1 ? 's' : ''} pending
                  </Text>
                )}

                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {plans.length === 0
                ? 'No plans on the desktop yet'
                : `No matching plans`}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  newRowTitle: { color: '#71717a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  newBtnGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newBtnGhost: {
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  newBtnGhostText: { color: '#a1a1aa', fontSize: 12, fontWeight: '700' },
  newBtn: {
    backgroundColor: '#3b82f620',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  newBtnText: { color: '#3b82f6', fontSize: 12, fontWeight: '700' },
  createBox: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#141416',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
  },
  createInput: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#e4e4e7',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  createActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginTop: 10 },
  createCancel: { color: '#a1a1aa', fontSize: 14 },
  createBtn: { backgroundColor: '#3b82f6', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  createBtnDisabled: { backgroundColor: '#27272a' },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Project scope chips
  projectScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },

  // Status filters
  filterScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    maxWidth: 160,
  },
  chipActive: {
    backgroundColor: '#3b82f620',
    borderColor: '#3b82f6',
  },
  chipText: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#3b82f6',
  },

  // List
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },

  // Plan card
  planCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  planName: {
    color: '#e4e4e7',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  planChevron: {
    color: '#52525b',
    fontSize: 14,
    marginLeft: 8,
  },
  planProject: {
    color: '#52525b',
    fontSize: 11,
    marginBottom: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: '#22c55e20',
  },
  statusDone: {
    backgroundColor: '#3b82f620',
  },
  statusDraft: {
    backgroundColor: '#71717a20',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#a1a1aa',
    textTransform: 'capitalize',
  },
  planMeta: {
    color: '#71717a',
    fontSize: 12,
    marginBottom: 4,
  },
  deviationText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#27272a',
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 2,
  },

  // Empty
  empty: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#52525b',
    fontSize: 14,
  },
});
