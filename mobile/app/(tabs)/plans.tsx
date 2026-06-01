/**
 * Plans tab — plan list with progress bars and status filters.
 *
 * Shows all plans from the workspace snapshot. Each plan card
 * displays name, status, item counts, and a progress bar.
 * Filter chips at the top: All / Active / Draft / Completed.
 */

import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { usePlans, useDeviationCounts } from '../../lib/store';

type StatusFilter = 'all' | 'active' | 'draft' | 'completed';

const FILTERS: { key: StatusFilter; label: string }[] = [
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

export default function PlansTab() {
  const router = useRouter();
  const plans = usePlans();
  const deviationCounts = useDeviationCounts();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filteredPlans = useMemo(
    () => plans.filter((p) => matchesFilter(p.status, filter)),
    [plans, filter],
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
      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[styles.chipText, filter === f.key && styles.chipTextActive]}
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
                </View>

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
                : `No ${filter} plans`}
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
    backgroundColor: '#09090b',
  },

  // Filters
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
