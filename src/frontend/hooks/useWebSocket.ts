import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agent-store';
import { usePlanStore } from '../stores/plan-store';
import { usePlanItemsStore } from '../stores/plan-items-store';
import { useToastStore } from '../stores/toast-store';
import { useProjectStore } from '../stores/project-store';
import { useTerminalStore } from '../stores/terminal-store';
import { useUiStore } from '../stores/ui-store';
import { useArtefactViewStore } from '../stores/artefact-view-store';
import type { AgentEvent } from '../../shared/types';

/**
 * Connects to the backend WebSocket and routes messages
 * to the appropriate Zustand stores.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Set by the cleanup. A socket closed BY the cleanup still fires
    // `onclose` afterwards, and that used to schedule a reconnect nothing
    // could cancel — so StrictMode's mount-unmount-mount left two live
    // sockets three seconds later, and every broadcast was handled twice
    // (two presence cards with one id, two navigations, two answers to a
    // ui_ready request).
    let disposed = false;

    function connect() {
      if (disposed) return;
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
          if (type === 'plan-item-criteria-changed') {
            const itemUid = payload?.itemUid as string | undefined;
            if (itemUid) void usePlanItemsStore.getState().refreshCriteria(itemUid);
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
            // user sees it, respecting the current plan scope.
            const scope = usePlanStore.getState().planScope;
            usePlanStore.getState().fetchPlans(scope === 'all' ? undefined : scope).catch(() => {});
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
              // Phase 29 §4.9 — until the conflict bar existed the only
              // honest advice was "go to your editor". Now the plan
              // workspace can resolve it, so point there instead.
              message: `${payload?.filePath || 'A plan file'} — resolve it from the bar at the top of the plan workspace.`,
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

          // --- Agent pulse — visual cue that an agent drove a UI change ---
          if (typeof type === 'string' && type.startsWith('ui-')) {
            window.dispatchEvent(new CustomEvent('agent-ui-action'));
          }

          // --- UI navigation (driven by MCP agent) ---
          if (type === 'ui-navigate') {
            const target = payload?.target as string | undefined;
            const planUid = payload?.planUid as string | undefined;
            // The artefact viewer is a modal. Asked to show anything else,
            // close it — otherwise "show the brief" leaves the brief under
            // the file the agent opened last, and nothing on screen changes.
            if (target !== 'artefact') useArtefactViewStore.getState().close();
            if (target === 'plan' || target === 'plans') {
              // Await setActivePlan so activePlanUid is set before the
              // workspace mode flips — otherwise the render condition
              // (workspaceMode === 'plan' && activePlanUid) fails when
              // no plan was previously open.
              (async () => {
                if (planUid) {
                  await usePlanStore.getState().setActivePlan(planUid);
                }
                useUiStore.getState().setWorkspaceMode('plan');
              })();
            } else if (target === 'graph') {
              useUiStore.getState().setWorkspaceMode('graph');
            } else if (target === 'code') {
              // Goes through the same helper the reader's own links use,
              // so an agent arriving at a file lands exactly where a
              // person clicking would.
              const filePath = payload?.filePath as string | undefined;
              if (filePath) {
                void import('../lib/open-file-at').then((m) =>
                  m.openFileAt(filePath, (payload?.line as number | undefined) ?? null));
              } else {
                useUiStore.getState().setWorkspaceMode('code');
              }
            } else if (target === 'brief') {
              // Phase 31 §5 — the Brief, on a task when one is named.
              (async () => {
                if (planUid) await usePlanStore.getState().setActivePlan(planUid);
                useUiStore.getState().setWorkspaceMode('brief');
                const itemUid = payload?.itemUid as string | undefined;
                if (itemUid) usePlanItemsStore.getState().selectItem(itemUid);
              })();
            } else if (target === 'artefact') {
              // A recorded file in the viewer, at the place the agent cites.
              const attachmentUid = payload?.attachmentUid as string | undefined;
              if (attachmentUid) {
                void import('../lib/open-artefact-at').then((m) => m.openArtefactAt(attachmentUid, payload?.locator ?? null));
              }
            } else if (target === 'split') {
              (async () => {
                if (planUid) {
                  await usePlanStore.getState().setActivePlan(planUid);
                }
                useUiStore.getState().setSplitView(true);
                useUiStore.getState().setWorkspaceMode('plan');
              })();
            } else if (target === 'timeline') {
              // F11 — "timeline" means the plan event/activity feed. Open the
              // plan workspace AND its activity drawer so this is visibly
              // distinct from a plain 'plan' navigation (previously a no-op).
              (async () => {
                if (planUid) {
                  await usePlanStore.getState().setActivePlan(planUid);
                }
                useUiStore.getState().setWorkspaceMode('plan');
                if (!usePlanItemsStore.getState().activityDrawerOpen) {
                  usePlanItemsStore.getState().toggleActivityDrawer();
                }
              })();
            }
          }
          if (type === 'ui-toggle') {
            const panel = payload?.panel as string | undefined;
            if (panel === 'sidebar') useUiStore.getState().toggleSidebar();
            if (panel === 'inspector') useUiStore.getState().toggleInspector();
            // `terminal` toggled the PLAN panel. It called
            // `toggleAgentPanel()`, a name left over from when that slot held
            // the agent panel, so "hide the terminal" hid the plans and left
            // the terminal open. Both halves were visible in the demo: the
            // drawer never went away, and the plan pane went blank.
            if (panel === 'terminal') useTerminalStore.getState().togglePanel();
            if (panel === 'plans') useUiStore.getState().toggleAgentPanel();
            if (panel === 'split') useUiStore.getState().toggleSplitView();
            // F10 — Channel / Activity / History panels live in the plan
            // workspace; make sure it's showing, then toggle the panel.
            if (panel === 'channel' || panel === 'activity' || panel === 'history') {
              if (usePlanStore.getState().activePlanUid) {
                useUiStore.getState().setWorkspaceMode('plan');
              }
              if (panel === 'channel') {
                (async () => {
                  const { useChannelsStore } = await import('../stores/channels-store');
                  useChannelsStore.getState().toggleDrawer();
                })();
              }
              if (panel === 'activity') usePlanItemsStore.getState().toggleActivityDrawer();
              if (panel === 'history') window.dispatchEvent(new CustomEvent('toggle-history-rail'));
            }
          }
          if (type === 'ui-refresh') {
            // Force a full plan list refresh, respecting the current scope
            (async () => {
              const scope = usePlanStore.getState().planScope;
              usePlanStore.getState().fetchPlans(scope === 'all' ? undefined : scope);
              const activePlan = usePlanStore.getState().activePlanUid;
              if (activePlan) usePlanStore.getState().fetchPlan(activePlan);
            })();
          }

          // --- Channel events (CDev Phase 1.3/1.4) ---
          if (type === 'channel-event-posted') {
            (async () => {
              const { useChannelsStore } = await import('../stores/channels-store');
              useChannelsStore.getState().onEventPosted(payload);
            })();
          }
          if (type === 'channel-event-status-changed') {
            (async () => {
              const { useChannelsStore } = await import('../stores/channels-store');
              useChannelsStore.getState().onEventStatusChanged(payload?.uid, payload?.status);
            })();
          }
          if (type === 'channel-event-imported') {
            (async () => {
              const { useChannelsStore } = await import('../stores/channels-store');
              useChannelsStore.getState().onEventImported(payload?.uid, payload?.planUid);
            })();
          }
          // --- Phase 31 §8.3: a check run was recorded (a person, an
          // agent, or a material that changed). PlanCheckRunPanel re-reads.
          if (type === 'plan-check-run') {
            window.dispatchEvent(new CustomEvent('plan-check-run', { detail: payload }));
          }
          // --- Cross-repo pointers (CDev Phase 3.5) ---
          if (type === 'external-pointers-changed' || type === 'plan-scope-changed') {
            // The stitched view in PlanList re-fetches on these DOM
            // events. Lightweight signal — the payload isn't needed
            // because the listener calls /api/plans/stitched.
            window.dispatchEvent(new CustomEvent(type, { detail: payload }));
          }

          // --- System docs (CDev Phase 3.4) ---
          if (type === 'system-doc-created' || type === 'system-doc-updated' ||
              type === 'system-doc-verified' || type === 'system-doc-changed') {
            (async () => {
              const { useSystemDocsStore } = await import('../stores/system-docs-store');
              useSystemDocsStore.getState().onDocChanged(payload?.uid);
            })();
          }
          if (type === 'system-doc-removed') {
            (async () => {
              if (!payload?.uid) return;
              const { useSystemDocsStore } = await import('../stores/system-docs-store');
              useSystemDocsStore.getState().onDocRemoved(payload.uid);
            })();
          }

          if (type === 'channel-toast-elevated') {
            // Phase 2.3 — a routing rule with target: in-app-toast matched.
            const tone = (payload?.tone === 'warning' || payload?.tone === 'error') ? payload.tone : 'info';
            const sticky = !!payload?.sticky;
            const ev = payload?.event ?? {};
            // Fallback title composition (when the rule has no description):
            // "<eventType> · <author>" reads naturally — "stuck · maria@x.com"
            // is more useful than the bland "Channel: stuck".
            const fallbackTitle = ev.eventType
              ? (ev.author ? `${ev.eventType} · ${ev.author}` : `Channel: ${ev.eventType}`)
              : 'Channel event';
            useToastStore.getState().addToast({
              type: tone as 'info' | 'warning' | 'error',
              title: payload?.description || fallbackTitle,
              message: typeof ev?.payload?.message === 'string' ? ev.payload.message : undefined,
              duration: sticky ? 0 : 8000,
            });
          }

          // --- Agent Presence Pane ---
          if (type === 'presence-card' || type === 'presence-acked' || type === 'presence-dismissed' || type === 'presence-input-prompt' || type === 'presence-reply') {
            (async () => {
              const { usePresenceStore } = await import('../stores/presence-store');
              if (type === 'presence-card') {
                usePresenceStore.getState().pushCard(payload.card);
              } else if (type === 'presence-acked') {
                usePresenceStore.getState().ackCard(payload.cardId, payload.via);
              } else if (type === 'presence-dismissed') {
                usePresenceStore.getState().clearCards();
                usePresenceStore.getState().setVisible(false);
              } else if (type === 'presence-input-prompt') {
                usePresenceStore.getState().setInputPrompt(payload.prompt ?? null);
              } else if (type === 'presence-reply') {
                if (payload.reply) usePresenceStore.getState().pushReply(payload.reply);
              }
            })();
          }

          // --- Terminal session lifecycle ---
          if (type === 'terminal-created') {
            const session = payload?.session;
            if (session) {
              const store = useTerminalStore.getState();
              store.onTerminalCreated(session);
              // Focus the new terminal unless the creator opted out
              if (payload?.focus !== false) {
                store.setActiveSession(session.id);
                store.setOpen(true);
              }
            }
          }
          if (type === 'terminal-killed') {
            const id = payload?.id as string | undefined;
            if (id) useTerminalStore.getState().onTerminalKilled(id);
          }
          if (type === 'ui-terminal-focus') {
            const sessionId = payload?.sessionId as string | undefined;
            if (sessionId) {
              const store = useTerminalStore.getState();
              store.setActiveSession(sessionId);
              store.setOpen(true);
            }
          }

          // --- Screenshot capture (MCP screenshot tool) ---
          if (type === 'ui-screenshot-request') {
            const nonce = payload?.nonce as string | undefined;
            const panel = payload?.panel as string | undefined;
            if (nonce) {
              (async () => {
                try {
                  const { toPng } = await import('html-to-image');
                  // Select the target element based on panel
                  let target: HTMLElement | null = null;
                  if (panel === 'graph') {
                    target = document.querySelector('[data-panel="graph"]') as HTMLElement
                      ?? document.querySelector('.react-flow') as HTMLElement;
                  } else if (panel === 'plan') {
                    target = document.querySelector('[data-panel="plan"]') as HTMLElement;
                  } else if (panel === 'terminal') {
                    target = document.querySelector('[data-panel="terminal"]') as HTMLElement;
                  }
                  // Default to full viewport
                  if (!target) target = document.body;

                  const dataUrl = await toPng(target, {
                    backgroundColor: '#06070d',
                    pixelRatio: 1, // 1x for reasonable file size
                  });
                  // Strip the data:image/png;base64, prefix
                  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
                  await fetch('/api/screenshot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, data: base64 }),
                  });
                } catch (err) {
                  console.error('[Screenshot] Capture failed:', err);
                  // Send empty response so the MCP tool doesn't hang
                  await fetch('/api/screenshot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, data: '' }),
                  }).catch(() => {});
                }
              })();
            }
          }

          // --- UI item selection (MCP select_item tool) ---
          if (type === 'ui-select-item') {
            const planUid = payload?.planUid as string | undefined;
            const itemUid = payload?.itemUid as string | undefined;
            if (planUid && itemUid) {
              // Shared with the code reader's overlay banner — see
              // `lib/open-plan-item`. The ordering in there is what F9
              // fixed; keeping one copy is how it stays fixed.
              (async () => {
                try {
                  const { openPlanItem } = await import('../lib/open-plan-item');
                  await openPlanItem(planUid, itemUid);
                } catch (err) {
                  console.error('[WS] select_item failed:', err);
                }
              })();
            }
          }

          // --- Open project (MCP open_project tool) ---
          if (type === 'ui-open-project') {
            const projectPath = payload?.path as string | undefined;
            if (projectPath) {
              (async () => {
                try {
                  const { useProjectStore } = await import('../stores/project-store');
                  const { getAPI } = await import('../bridge');
                  const store = useProjectStore.getState();

                  // APPLY the result. This called `setRoot` and then
                  // `scanProject`, and threw the result away — so the
                  // file tree and the monorepo config were never set.
                  // An agent calling `open_project` left the user looking
                  // at an empty Explorer, an empty graph and a status bar
                  // reading "No project", on a project that had scanned
                  // perfectly well: the data was in the backend and
                  // nothing put it in the stores.
                  //
                  // Same sequence the Welcome screen uses when a person
                  // opens a project, because it should be the same thing
                  // happening.
                  store.setRoot(projectPath);
                  store.setScanStatus('scanning');
                  const result = await getAPI().scanProject(projectPath);
                  store.applyScanResult(result);

                  // Branch AFTER the scan: the project only becomes a
                  // trusted root once it is scanned, so asking earlier is
                  // refused (the same ordering the Welcome screen needs).
                  try {
                    const branchRes = await fetch(
                      `/api/git/branch?path=${encodeURIComponent(projectPath)}`,
                    );
                    if (branchRes.ok) {
                      const data = (await branchRes.json()) as { branch?: string | null };
                      const active = useProjectStore.getState().activeTabId;
                      if (active) useProjectStore.getState().setTabBranch(active, data.branch ?? null);
                    }
                  } catch { /* a missing branch label is not worth failing an open over */ }
                } catch (err) {
                  console.error('[WS] Failed to open project:', err);
                  const { useProjectStore } = await import('../stores/project-store');
                  useProjectStore.getState().setError(String(err));
                }
              })();
            }
          }

          // --- Graph focus (MCP graph_focus tool) ---
          if (type === 'ui-graph-focus') {
            const targetPath = payload?.path as string | undefined;
            const highlight = payload?.highlight as boolean | undefined;
            if (targetPath) {
              (async () => {
                const { useGraphStore } = await import('../stores/graph-store');
                useGraphStore.getState().focusNode(targetPath, highlight !== false);
              })();
            }
          }

          // --- Graph mode (MCP graph_set_mode tool) ---
          if (type === 'ui-graph-mode') {
            const mode = payload?.mode as string | undefined;
            if (mode) {
              (async () => {
                const { useGraphStore } = await import('../stores/graph-store');
                const store = useGraphStore.getState();
                if ('setTrellisMode' in store) {
                  (store as any).setTrellisMode(mode);
                }
              })();
            }
          }

          // --- Graph scope (MCP graph_set_scope tool) ---
          if (type === 'ui-graph-scope') {
            const scopePath = payload?.scopePath as string | undefined;
            if (scopePath !== undefined) {
              (async () => {
                const { useGraphStore } = await import('../stores/graph-store');
                const store = useGraphStore.getState();
                if ('setScopePath' in store) {
                  (store as any).setScopePath(scopePath || null);
                }
              })();
            }
          }

          // --- Graph select (MCP graph_select tool) ---
          if (type === 'ui-graph-select') {
            const paths = payload?.paths as string[] | undefined;
            if (paths) {
              (async () => {
                const { useGraphStore } = await import('../stores/graph-store');
                // Paths come in as relative file paths; node IDs match these
                useGraphStore.getState().setSelectedNodeIds(paths);
              })();
            }
          }

          // --- Graph layout (MCP graph_set_layout tool) ---
          if (type === 'ui-graph-layout') {
            const layout = payload?.layout as string | undefined;
            if (layout === 'map' || layout === 'tree') {
              (async () => {
                const { useGraphStore } = await import('../stores/graph-store');
                useGraphStore.getState().setLayoutMode(layout);
              })();
            }
          }

          // --- Graph depth (MCP graph_set_depth tool) ---
          if (type === 'ui-graph-depth') {
            const depth = payload?.depth as string | undefined;
            if (depth === 'package' || depth === 'file' || depth === 'symbol') {
              (async () => {
                const { useGraphStore } = await import('../stores/graph-store');
                useGraphStore.getState().setViewDepth(depth);
              })();
            }
          }

          // --- The graph's data was replaced by a scan ---
          //
          // Re-broadcast as a window event so the canvas can refetch. A
          // scan truncates and repopulates `files` and `imports`, so a
          // canvas that fetched its edges mid-scan holds an empty list
          // that nothing would ever correct.
          if (type === 'graph-data-changed') {
            window.dispatchEvent(new CustomEvent('graph-data-changed', { detail: payload }));
            return;
          }

          // --- UI readiness (MCP ui_ready tool) ---
          //
          // Can a person actually use what is on screen right now?
          //
          // This exists because the demo drove twenty-four scenes against
          // an app that was never mounted — the first-run wizard rendered
          // IN PLACE OF the shell — and reported "nothing looked wrong".
          // The backend answered every call correctly the whole time. A
          // verification tool that cannot see a blocking modal proves
          // nothing, and neither does a green run from one.
          if (type === 'ui-ready-request') {
            const nonce = payload?.nonce as string | undefined;
            if (nonce) {
              (async () => {
                // A dialog that covers the app is the thing worth
                // reporting. Asking the DOM is deliberate: a store flag
                // would say what we intended to render, and the bug was
                // that intent and screen disagreed.
                const blocking = Array.from(document.querySelectorAll('[role="dialog"]'))
                  .filter((el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > window.innerWidth * 0.4 && r.height > window.innerHeight * 0.3;
                  })
                  .map((el) => el.getAttribute('aria-label') || 'unnamed dialog');

                const shellMounted = Boolean(document.querySelector('[data-app-shell]'));

                let projectOpen = false;
                let workspaceMode = 'unknown';
                let scanStatus = 'unknown';
                let graphNodes = 0;
                let openFile: string | null = null;
                let openArtefact: { uid: string; name: string | null; locator: unknown } | null = null;
                const verdicts: Record<string, number> = {};
                const visibleVerdicts: Record<string, number> = {};
                // Phase 31.8 — the criteria a person can SEE, and in what
                // state, so a demo cannot caption a shot "stale" while the
                // row on screen still says approved.
                const criteria: Array<{ uid: string; text: string; state: string }> = [];
                try {
                  const { useProjectStore } = await import('../stores/project-store');
                  const { useUiStore } = await import('../stores/ui-store');
                  const { useGraphStore } = await import('../stores/graph-store');
                  projectOpen = useProjectStore.getState().tabs.length > 0;
                  workspaceMode = useUiStore.getState().workspaceMode;
                  // `scanStatus` gates the edge fetch, and `graphNodes` is
                  // what actually reached the canvas. Reporting both turns
                  // "the graph is empty" from a symptom into a diagnosis:
                  // not-ready means the fetch never ran, ready-with-zero
                  // means it ran and came back with nothing.
                  scanStatus = useProjectStore.getState().scanStatus ?? 'unknown';
                  graphNodes = useGraphStore.getState().nodes.length;
                  // Which file the reader is SHOWING. A screenshot that
                  // cannot say what it is a picture of is not evidence —
                  // the demo captured `app.rb` under the caption "aligned,
                  // money.go" and nothing could tell.
                  //
                  // Read from the DOM, not from the selection. The first
                  // version read `selectedNodeId`, which changes the moment
                  // navigation starts; the rendered file changes only when
                  // its content arrives. In between, the store says the new
                  // file and the screen shows the old one — the precise
                  // disagreement this check exists to catch.
                  openFile = document.querySelector('[data-code-file]')?.getAttribute('data-code-file') ?? null;
                  // Phase 31 §5 — the recorded file the viewer is showing, and
                  // where, read from the viewer's own attributes as openFile is.
                  const viewer = document.querySelector('[data-artefact]');
                  if (viewer) {
                    let locator: unknown = null;
                    try { locator = JSON.parse(viewer.getAttribute('data-artefact-locator') ?? 'null'); } catch { /* none */ }
                    openArtefact = {
                      uid: viewer.getAttribute('data-artefact') ?? '',
                      name: viewer.getAttribute('data-artefact-name'),
                      locator,
                    };
                  }
                  // And what the reader actually marked on it. The right
                  // file with no marks is the failure a screenshot hides
                  // best: it looks like a clean file.
                  for (const el of Array.from(document.querySelectorAll('[data-code-file] [data-verdict]'))) {
                    const v = el.getAttribute('data-verdict');
                    if (!v) continue;
                    verdicts[v] = (verdicts[v] ?? 0) + 1;

                    // And separately, the ones a person could SEE: inside
                    // the viewport and not covered by a drawer, a panel or
                    // a card. A mark scrolled off-screen or under the
                    // terminal is in the DOM and in no screenshot — which
                    // is how a shot captioned "aligned" once showed a file
                    // whose aligned lines were hidden behind the drawer.
                    const r = el.getBoundingClientRect();
                    const x = r.left + Math.min(40, r.width / 2);
                    const y = r.top + r.height / 2;
                    if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) continue;
                    const top = document.elementFromPoint(x, y);
                    if (top && (top === el || el.contains(top))) {
                      visibleVerdicts[v] = (visibleVerdicts[v] ?? 0) + 1;
                    }
                  }
                  // Visible as the verdicts are: in the viewport and not
                  // under something else. The row's text is what the check
                  // matches on — the uid is for a script that has it.
                  for (const row of Array.from(document.querySelectorAll('[data-criterion]'))) {
                    const r = row.getBoundingClientRect();
                    if (r.height === 0 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
                    const x = r.left + Math.min(24, r.width / 2);
                    const y = r.top + Math.min(12, r.height / 2);
                    const top = document.elementFromPoint(x, y);
                    if (!top || !(top === row || row.contains(top))) continue;
                    criteria.push({
                      uid: row.getAttribute('data-criterion') ?? '',
                      text: row.querySelector('[data-criterion-text]')?.textContent ?? '',
                      state: row.getAttribute('data-state') ?? '',
                    });
                  }
                } catch { /* stores unavailable — shellMounted already says so */ }

                await fetch('/api/screenshot-response', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    nonce,
                    data: JSON.stringify({
                      ready: shellMounted && blocking.length === 0,
                      shellMounted,
                      blockedBy: blocking,
                      projectOpen,
                      workspaceMode,
                      scanStatus,
                      graphNodes,
                      openFile,
                      openArtefact,
                      verdicts,
                      visibleVerdicts,
                      criteria,
                    }),
                  }),
                }).catch(() => {});
              })();
            }
            return;
          }

          // --- Graph snapshot request (MCP graph_snapshot tool) ---
          if (type === 'ui-graph-snapshot-request') {
            const nonce = payload?.nonce as string | undefined;
            const includeMetadata = payload?.includeMetadata as boolean | undefined;
            if (nonce) {
              (async () => {
                try {
                  const { useGraphStore } = await import('../stores/graph-store');
                  const { nodes, edges } = useGraphStore.getState();
                  // Build a compact representation of the graph
                  const snapshot = {
                    nodeCount: nodes.length,
                    edgeCount: edges.length,
                    nodes: nodes.map((n) => ({
                      id: n.id,
                      type: n.type,
                      label: n.label,
                      filePath: n.filePath,
                      parentId: n.parentId,
                      changeStatus: n.changeStatus,
                      ...(includeMetadata ? { metadata: n.metadata } : {}),
                    })),
                    edges: edges.map((e) => ({
                      id: e.id,
                      source: e.source,
                      target: e.target,
                      type: e.type,
                      label: e.label,
                      changeStatus: e.changeStatus,
                    })),
                  };
                  await fetch('/api/screenshot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, data: JSON.stringify(snapshot) }),
                  });
                } catch (err) {
                  console.error('[WS] Graph snapshot failed:', err);
                  await fetch('/api/screenshot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, data: '{"error":"snapshot capture failed"}' }),
                  }).catch(() => {});
                }
              })();
            }
          }

          // --- Set baseline (MCP set_baseline tool) ---
          if (type === 'ui-set-baseline') {
            const commitHash = payload?.commitHash as string | null | undefined;
            (async () => {
              const { useGraphStore } = await import('../stores/graph-store');
              useGraphStore.getState().setBaselineReference({
                commitHash: commitHash ?? null,
                shortCommitHash: commitHash ? commitHash.slice(0, 7) : null,
              });
            })();
          }

          // --- Clipboard write (MCP clipboard_write tool) ---
          if (type === 'ui-clipboard-write') {
            const text = payload?.text as string | undefined;
            if (text !== undefined) {
              navigator.clipboard.writeText(text).catch((err) => {
                console.error('[WS] Clipboard write failed:', err);
              });
            }
          }

          // --- Clipboard read (MCP clipboard_read tool) ---
          if (type === 'ui-clipboard-read') {
            const nonce = payload?.nonce as string | undefined;
            if (nonce) {
              (async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  await fetch('/api/screenshot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, data: text }),
                  });
                } catch (err) {
                  console.error('[WS] Clipboard read failed:', err);
                  await fetch('/api/screenshot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nonce, data: '' }),
                  }).catch(() => {});
                }
              })();
            }
          }

          // --- Close project tab (MCP close_project tool) ---
          if (type === 'ui-close-project') {
            const path = payload?.path as string | undefined;
            if (path) {
              const tabs = useProjectStore.getState().tabs;
              const tab = tabs.find((t: any) => t.root === path);
              if (tab) {
                useProjectStore.getState().removeTab(tab.id);
              }
            }
          }

          // --- Item navigation back/forward (MCP navigate_item_back/forward tools) ---
          if (type === 'ui-navigate-item-back') {
            usePlanItemsStore.getState().navigateBack();
          }
          if (type === 'ui-navigate-item-forward') {
            usePlanItemsStore.getState().navigateForward();
          }

          // --- Activity drawer toggle (MCP toggle_activity_drawer tool) ---
          if (type === 'ui-toggle-activity-drawer') {
            usePlanItemsStore.getState().toggleActivityDrawer();
          }

          // --- History drawer (MCP open_history_drawer tool) ---
          if (type === 'ui-open-history-drawer') {
            const itemUid = payload?.itemUid as string | undefined;
            if (itemUid) {
              usePlanItemsStore.getState().openHistoryDrawer(itemUid);
            }
          }

          // --- Settings modal (MCP open_settings tool) ---
          if (type === 'ui-open-settings') {
            window.dispatchEvent(new CustomEvent('open-settings'));
          }

          // --- MCP guide modal (MCP open_mcp_guide tool) ---
          if (type === 'ui-open-mcp-guide') {
            window.dispatchEvent(new CustomEvent('open-mcp-guide'));
          }

          // --- Graph projection toggle (MCP graph_toggle_projection tool) ---
          if (type === 'ui-graph-toggle-projection') {
            (async () => {
              const { useGraphStore } = await import('../stores/graph-store');
              const store = useGraphStore.getState();
              const enabled = payload?.enabled as boolean | undefined;
              if (enabled === undefined) {
                store.toggleProjection();
              } else if (enabled !== store.projectionEnabled) {
                store.toggleProjection();
              }
            })();
          }

        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        console.log('[WS] Disconnected, reconnecting...');
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);
}

function extractSteps(text: string): Array<{ description: string; status: 'pending'; files: string[] }> {
  const lines = text.split('\n');
  const steps: Array<{ description: string; status: 'pending'; files: string[] }> = [];

  for (const line of lines) {
    const match = line.match(/^\s*\d+[.)]\s+(.+)/);
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
