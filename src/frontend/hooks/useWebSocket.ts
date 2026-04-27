import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agent-store';
import { usePlanStore } from '../stores/plan-store';
import { useToastStore } from '../stores/toast-store';
import { useProjectStore } from '../stores/project-store';
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
          if (type === 'task-updated') {
            usePlanStore.getState().onTaskUpdated(payload.planUid, payload.taskUid, payload.status || 'assigned');
            if (payload.status === 'done') {
              useToastStore.getState().addToast({ type: 'success', title: 'Task completed', message: `Task marked as done` });
            }
            if (payload.status === 'in_progress') {
              const isAuto = payload.source === 'auto-progress';
              useToastStore.getState().addToast({
                type: 'info',
                title: isAuto ? 'Task auto-started' : 'Task started',
                message: isAuto ? 'A file in this task changed — moved to in_progress' : 'Agent is working on a task',
              });
            }
          }
          if (type === 'task-completion-suggested') {
            useToastStore.getState().addToast({
              type: 'success',
              title: 'Task may be done',
              message: `All ${payload.changeCount} proposed changes are satisfied — review and mark done if you agree.`,
              duration: 8000,
            });
          }
          if (type === 'task-claimed') {
            usePlanStore.getState().onTaskUpdated(payload.planUid, payload.taskUid, 'assigned');
            useToastStore.getState().addToast({ type: 'info', title: 'Task claimed', message: `Assigned to ${payload.agentId || 'agent'}` });
          }
          if (type === 'comment-added') {
            usePlanStore.getState().onCommentAdded(payload.comment);
            useToastStore.getState().addToast({ type: 'info', title: 'New comment', message: payload.comment?.body?.substring(0, 60) });
          }
          if (type === 'plan-doc-created') {
            usePlanStore.getState().onPlanDocCreated(payload.doc);
            useToastStore.getState().addToast({ type: 'info', title: 'Spec doc added', message: payload.doc?.title });
          }
          if (type === 'plan-doc-updated') {
            usePlanStore.getState().onPlanDocUpdated(payload.doc);
          }
          if (type === 'plan-doc-deleted') {
            usePlanStore.getState().onPlanDocDeleted(payload.docUid);
          }
          if (type === 'plan-phase-created' || type === 'plan-phase-updated') {
            const planUid = payload?.phase?.planUid as string | undefined;
            if (planUid) usePlanStore.getState().onPlanPhaseChanged(planUid);
          }
          if (type === 'plan-imported') {
            // An external import (MCP, another window, future
            // auto-sync) loaded a plan. Refresh the list so the
            // user sees it.
            const { useProjectStore } = require('../stores/project-store');
            const root = useProjectStore.getState().root;
            usePlanStore.getState().fetchPlans(root || undefined).catch(() => {});
            useToastStore.getState().addToast({ type: 'info', title: 'Plan imported', message: payload?.source || 'from disk' });
          }
          if (type === 'plan-exported') {
            // Pure notification — file content matches DB; no
            // store mutation needed.
          }
          if (type === 'plan-phase-deleted') {
            // Phase deleted — refetch phases for whichever plan is
            // active. We don't have planUid in the payload, but
            // onPlanPhaseChanged short-circuits if there's no active
            // plan, so this is safe.
            const active = usePlanStore.getState().activePlanUid;
            if (active) usePlanStore.getState().onPlanPhaseChanged(active);
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

          // Execution tracking — mark files as actively being worked on
          if (type === 'task-updated' && payload.status === 'in_progress') {
            // Fetch task details to get affected files
            const planUid = payload.planUid as string;
            const taskUid = payload.taskUid as string;
            fetch(`/api/plans/${planUid}`)
              .then((r) => r.json())
              .then((plan) => {
                const task = plan.tasks?.find((t: any) => t.uid === taskUid);
                if (task?.affectedFiles) {
                  for (const file of task.affectedFiles) {
                    useAgentStore.getState().markFileChanged(file);
                  }
                }
              })
              .catch(() => {});
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
