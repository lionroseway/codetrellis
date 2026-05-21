import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agent-store';
import { usePlanStore } from '../stores/plan-store';
import { usePlanItemsStore } from '../stores/plan-items-store';
import { useToastStore } from '../stores/toast-store';
import { useProjectStore } from '../stores/project-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useUiStore } from '../stores/ui-store';
import type { AgentEvent } from '../../shared/types';

/**
 * Connects to the backend WebSocket and routes messages
 * to the appropriate Zustand stores.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`ws://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        // Check if agent is already active (we might have missed the session_start event)
        fetch('/api/agent/status')
          .then((r) => r.json())
          .then((status) => {
            if (status.sessionId) {
              useAgentStore.getState().setStatus('active');
            }
          })
          .catch(() => {});
        // Pull the current MCP session list so the ConnectedAgents
        // widget shows agents that were already connected before the
        // UI loaded.
        usePlanStore.getState().fetchSessions().catch(() => {});
        // Hydrate terminal sessions created before the UI loaded
        // (e.g. via API / MCP).
        useTerminalStore.getState().hydrate().catch(() => {});
      };

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data);

          if (type === 'agent-event') {
            const agentEvent = payload as AgentEvent;
            useAgentStore.getState().pushEvent(agentEvent);

            // Update agent status + refresh the connected-agents list
            // when sessions come and go (the per-row last-seen is also
            // recomputed naturally via the timestamp).
            if (agentEvent.type === 'session_start') {
              useAgentStore.getState().setStatus('active');
              usePlanStore.getState().fetchSessions().catch(() => {});
            } else if (agentEvent.type === 'session_end') {
              useAgentStore.getState().setStatus('idle');
              usePlanStore.getState().fetchSessions().catch(() => {});
            }

            // Extract plan if detected
            if (agentEvent.type === 'plan_reported' && agentEvent.payload.text) {
              useAgentStore.getState().setPlan({
                id: agentEvent.id,
                title: 'Detected Plan',
                steps: extractSteps(String(agentEvent.payload.text)),
                status: 'proposed',
                affectedFiles: [],
                estimatedImpact: null,
              });
            }
          }

          if (type === 'file-changed' || type === 'file-added' || type === 'file-removed') {
            const relPath = payload?.relativePath as string;
            if (relPath) {
              useAgentStore.getState().markFileChanged(relPath);
            }
            useProjectStore.getState().bumpRefreshVersion();
          }

          // Plan events
          if (type === 'plan-created') {
            usePlanStore.getState().onPlanCreated(payload.plan);
            useToastStore.getState().addToast({ type: 'info', title: 'New plan created', message: payload.plan?.title });
          }
          if (type === 'plan-updated') {
            usePlanStore.getState().onPlanUpdated(payload.planUid);
          }
          if (type === 'plan-deleted') {
            usePlanStore.getState().onPlanDeleted(payload.planUid);
            useToastStore.getState().addToast({ type: 'info', title: 'Plan deleted', message: 'A plan was removed' });
          }
          if (type === 'comment-added') {
            usePlanStore.getState().onCommentAdded(payload.comment);
            useToastStore.getState().addToast({ type: 'info', title: 'New comment', message: payload.comment?.body?.substring(0, 60) });
          }
          // --- Phase 15 §15.D — V2 plan-item event handlers ---
          if (type === 'plan-item-created') {
            const item = payload?.item;
            if (item) usePlanItemsStore.getState().onItemCreated(item);
          }
          if (type === 'plan-item-updated') {
            const planUid = payload?.planUid as string | undefined;
            const itemUid = payload?.itemUid as string | undefined;
            if (planUid && itemUid) {
              usePlanItemsStore.getState().onItemUpdated(planUid, itemUid, payload?.changes ?? {});
            }
          }
          if (type === 'plan-item-moved') {
            const itemUid = payload?.itemUid as string | undefined;
            if (itemUid) {
              usePlanItemsStore.getState().onItemMoved(
                itemUid,
                (payload?.toParentUid as string | null | undefined) ?? null,
                Number(payload?.sortOrder ?? 0),
              );
            }
          }
          if (type === 'plan-item-deleted') {
            const itemUid = payload?.itemUid as string | undefined;
            const cascadedUids = Array.isArray(payload?.cascadedUids) ? payload!.cascadedUids as string[] : [];
            if (itemUid) usePlanItemsStore.getState().onItemDeleted(itemUid, cascadedUids);
          }
          if (type === 'plan-item-comment-added') {
            const itemUid = payload?.itemUid as string | undefined;
            const comment = payload?.comment;
            if (itemUid && comment) usePlanItemsStore.getState().onItemCommentAdded(itemUid, comment);
          }
          if (type === 'plan-item-attachment-added') {
            const itemUid = payload?.itemUid as string | undefined;
            const attachment = payload?.attachment;
            if (itemUid && attachment) usePlanItemsStore.getState().onItemAttachmentAdded(itemUid, attachment);
          }
          if (type === 'plan-item-progress' || type === 'plan-item-blocked' || type === 'plan-item-claimed' || type === 'plan-item-version-saved') {
            // These already cascade through plan-item-updated; nothing
            // additional needed here unless the V2 UI wants its own
            // toast/animation later.
          }
          if (type === 'plan-event') {
            const event = payload?.event;
            if (event) usePlanItemsStore.getState().onItemEvent(event);
          }

          if (type === 'plan-imported') {
            // An external import (MCP, another window, future
            // auto-sync) loaded a plan. Refresh the list so the
            // user sees it.
            const { useProjectStore } = require('../stores/project-store');
            const root = useProjectStore.getState().root;
            usePlanStore.getState().fetchPlans(root || undefined).catch(() => {});
            // Phase 13 §B: file-watcher-driven auto-syncs are common
            // (every git pull, every external edit). Distinguish them
            // so the toast text matches what just happened.
            if (payload?.source === 'file-watcher') {
              const planUid = payload?.planUid;
              const active = usePlanStore.getState().activePlanUid;
              if (planUid && planUid === active) {
                // Re-fetch the in-flight plan so the open view
                // reflects the disk change.
                usePlanStore.getState().fetchPlan(planUid).catch(() => {});
              }
              useToastStore.getState().addToast({
                type: 'info',
                title: 'Plan reloaded from disk',
                message: payload?.warnings?.length
                  ? `External change picked up (${payload.warnings.length} warnings).`
                  : 'External change picked up.',
                duration: 5000,
              });
            } else {
              useToastStore.getState().addToast({ type: 'info', title: 'Plan imported', message: payload?.source || 'from disk' });
            }
          }
          if (type === 'plan-exported') {
            // Auto-sync write-through. No state mutation needed —
            // file matches DB. Skip toast for these (would spam on
            // every edit); only the manual Export still toasts.
          }
          if (type === 'plan-unlinked') {
            // Another window / agent unlinked the plan from disk.
            useToastStore.getState().addToast({ type: 'info', title: 'Plan unlinked', message: 'No longer syncing to disk.' });
          }
          if (type === 'plan-file-conflict') {
            // YAML merge conflict detected by the file watcher.
            useToastStore.getState().addToast({
              type: 'warning',
              title: 'Plan file has merge conflicts',
              message: `Resolve in your editor: ${payload?.filePath || 'unknown file'}`,
              duration: 12000,
            });
          }
          if (type === 'deviation-detected') {
            useToastStore.getState().addToast({ type: 'warning', title: 'Deviation detected', message: payload.deviation?.description, duration: 8000 });
          }
          if (type === 'conflict-detected') {
            useToastStore.getState().addToast({ type: 'error', title: 'Conflict!', message: payload.message, duration: 10000 });
          }
          if (type === 'session-registered') {
            useToastStore.getState().addToast({ type: 'success', title: 'Agent connected', message: `${payload.agentType || 'Agent'} via MCP` });
            usePlanStore.getState().fetchSessions().catch(() => {});
          }
          if (type === 'mcp-session-changed') {
            // Connect / disconnect / set_active_plan — pull fresh state
            // so the ConnectedAgents widget reflects reality.
            usePlanStore.getState().fetchSessions().catch(() => {});
          }
          if (type === 'mcp-port-changed') {
            // Bound port may differ from the configured port (autodetect
            // on collision). The settings panel + Connect Agent guide
            // refresh on next open via /api/mcp/status.
            useToastStore.getState().addToast({
              type: 'info',
              title: 'MCP port autodetected',
              message: `Bound to ${payload.port}${payload.requested && payload.requested !== payload.port ? ` (requested ${payload.requested})` : ''}`,
              duration: 6000,
            });
          }
          if (type === 'settings-changed') {
            // Another window saved settings. Settings panel re-reads
            // on open; if it's currently open, the user may want to
            // reload — but we don't have a clean push channel into
            // SettingsModal yet. Future: dispatch a window event.
          }

          // --- UI navigation (driven by MCP agent) ---
          if (type === 'ui-navigate') {
            const target = payload?.target as string | undefined;
            const planUid = payload?.planUid as string | undefined;
            if (target === 'plan' || target === 'plans') {
              useUiStore.getState().setWorkspaceMode('plan');
              if (planUid) {
                usePlanStore.getState().setActivePlan(planUid);
              }
            } else if (target === 'graph') {
              useUiStore.getState().setWorkspaceMode('graph');
            } else if (target === 'split') {
              useUiStore.getState().setSplitView(true);
              if (planUid) {
                usePlanStore.getState().setActivePlan(planUid);
              }
            } else if (target === 'timeline') {
              useUiStore.getState().setWorkspaceMode('plan');
              // Timeline is inside the plan workspace — opening plan mode is enough
            }
          }
          if (type === 'ui-toggle') {
            const panel = payload?.panel as string | undefined;
            if (panel === 'sidebar') useUiStore.getState().toggleSidebar();
            if (panel === 'inspector') useUiStore.getState().toggleInspector();
            if (panel === 'terminal') useUiStore.getState().toggleAgentPanel();
            if (panel === 'split') useUiStore.getState().toggleSplitView();
          }
          if (type === 'ui-refresh') {
            // Force a full plan list refresh
            (async () => {
              const { useProjectStore } = await import('../stores/project-store');
              const root = useProjectStore.getState().root;
              usePlanStore.getState().fetchPlans(root || undefined);
              const activePlan = usePlanStore.getState().activePlanUid;
              if (activePlan) usePlanStore.getState().fetchPlan(activePlan);
            })();
          }

          // --- Terminal session lifecycle ---
          if (type === 'terminal-created') {
            const session = payload?.session;
            if (session) useTerminalStore.getState().onTerminalCreated(session);
          }
          if (type === 'terminal-killed') {
            const id = payload?.id as string | undefined;
            if (id) useTerminalStore.getState().onTerminalKilled(id);
          }

        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting...');
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);
}

function extractSteps(text: string): Array<{ description: string; status: 'pending'; files: string[] }> {
  const lines = text.split('\n');
  const steps: Array<{ description: string; status: 'pending'; files: string[] }> = [];

  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s+(.+)/);
    if (match) {
      steps.push({ description: match[1].trim(), status: 'pending', files: [] });
    }
  }

  // Fallback: bullet points
  if (steps.length === 0) {
    for (const line of lines) {
      const match = line.match(/^\s*[-*]\s+(.+)/);
      if (match) {
        steps.push({ description: match[1].trim(), status: 'pending', files: [] });
      }
    }
  }

  return steps;
}
