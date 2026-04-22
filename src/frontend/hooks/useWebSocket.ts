import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agent-store';
import { usePlanStore } from '../stores/plan-store';
import { useToastStore } from '../stores/toast-store';
import type { AgentEvent } from '../../shared/types';

/**
 * Connects to the backend WebSocket and routes messages
 * to the appropriate Zustand stores.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

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
      };

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data);

          if (type === 'agent-event') {
            const agentEvent = payload as AgentEvent;
            useAgentStore.getState().pushEvent(agentEvent);

            // Update agent status
            if (agentEvent.type === 'session_start') {
              useAgentStore.getState().setStatus('active');
            } else if (agentEvent.type === 'session_end') {
              useAgentStore.getState().setStatus('idle');
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
              useToastStore.getState().addToast({ type: 'info', title: 'Task started', message: 'Agent is working on a task' });
            }
          }
          if (type === 'task-claimed') {
            usePlanStore.getState().onTaskUpdated(payload.planUid, payload.taskUid, 'assigned');
            useToastStore.getState().addToast({ type: 'info', title: 'Task claimed', message: `Assigned to ${payload.agentId || 'agent'}` });
          }
          if (type === 'comment-added') {
            usePlanStore.getState().onCommentAdded(payload.comment);
            useToastStore.getState().addToast({ type: 'info', title: 'New comment', message: payload.comment?.body?.substring(0, 60) });
          }
          if (type === 'deviation-detected') {
            useToastStore.getState().addToast({ type: 'warning', title: 'Deviation detected', message: payload.deviation?.description, duration: 8000 });
          }
          if (type === 'conflict-detected') {
            useToastStore.getState().addToast({ type: 'error', title: 'Conflict!', message: payload.message, duration: 10000 });
          }
          if (type === 'session-registered') {
            useToastStore.getState().addToast({ type: 'success', title: 'Agent connected', message: `${payload.agentType || 'Agent'} via MCP` });
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
