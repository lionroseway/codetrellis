/**
 * Mobile RPC service — routes JSON-RPC requests from mobile clients
 * on the WebRTC `control` data channel to existing backend services.
 *
 * Wire protocol (same envelope as remote-interaction-service):
 *   { method: string, params: object, id: string }
 *   → { result: object, id: string }  or  { error: string, id: string }
 *
 * Methods:
 *   plan.list         — list all plans
 *   plan.get          — get plan + items
 *   plan.items        — list items for a plan
 *   deviation.list    — list deviations for a plan
 *   deviation.resolve — accept/ignore/revert a deviation
 *   project.open      — scan/open a project on the desktop
 *   project.list      — list recent projects
 *   terminal.list     — list active terminals
 *   terminal.write    — send input to a terminal
 *   terminal.read     — read recent output from a terminal
 *   channel.events    — list channel events for a plan
 *   channel.post      — post a channel event
 */

import { DATA_CHANNELS } from '../../shared/types';
import {
  onChannelMessage,
  sendToPeer,
} from './webrtc-service';
import * as planService from './plan-service';
import * as planItemService from './plan-item-service';
import * as channelEventService from './channel-event-service';
import * as deviationService from './deviation-service';
import * as terminalService from './terminal-service';
import * as recentProjectsService from './recent-projects-service';
import { scanProject, getActiveProjectPath } from '../server';

// --- Types -------------------------------------------------------------------

interface RpcRequest {
  method: string;
  params: Record<string, unknown>;
  id: string;
  /** Marker to distinguish RPC from other control messages. */
  rpc?: true;
}

interface RpcResponse {
  result?: unknown;
  error?: string;
  id: string;
  rpc: true;
}

// --- State -------------------------------------------------------------------

let running = false;
let unsubMessage: (() => void) | null = null;

// --- Public API --------------------------------------------------------------

export function startMobileRpc(): void {
  if (running) return;
  running = true;

  unsubMessage = onChannelMessage(DATA_CHANNELS.CONTROL, handleControlMessage);

  console.log('[MobileRPC] Started');
}

export function stopMobileRpc(): void {
  if (!running) return;
  running = false;

  if (unsubMessage) { unsubMessage(); unsubMessage = null; }

  console.log('[MobileRPC] Stopped');
}

// --- Message handling --------------------------------------------------------

function handleControlMessage(fingerprint: string, data: Buffer | string): void {
  try {
    const text = typeof data === 'string' ? data : data.toString('utf-8');
    const msg = JSON.parse(text);

    // Only handle messages with rpc marker and an id
    if (!msg.rpc || !msg.id) return;

    const req = msg as RpcRequest;
    handleRpc(fingerprint, req);
  } catch {
    // Not a valid RPC message — ignore (other control messages handled elsewhere)
  }
}

async function handleRpc(fingerprint: string, req: RpcRequest): Promise<void> {
  try {
    const result = await routeMethod(req.method, req.params ?? {});
    sendResponse(fingerprint, { result, id: req.id, rpc: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendResponse(fingerprint, { error: message, id: req.id, rpc: true });
  }
}

function sendResponse(fingerprint: string, response: RpcResponse): void {
  sendToPeer(fingerprint, DATA_CHANNELS.CONTROL, JSON.stringify(response));
}

// --- Method router -----------------------------------------------------------

async function routeMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    // --- Plans ---------------------------------------------------------------
    case 'plan.list': {
      const projectPath = params.projectPath as string | undefined;
      return planService.listPlans(projectPath).map((p) => {
        const items = planItemService.listAllItems(p.uid);
        return {
          uid: p.uid,
          title: p.title,
          status: p.status,
          projectPath: p.projectPath,
          itemCount: items.length,
          doneCount: items.filter((i) => i.status === 'done').length,
          inProgressCount: items.filter((i) => i.status === 'in_progress' || i.status === 'assigned').length,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
        };
      });
    }

    case 'plan.get': {
      const uid = requireString(params, 'uid');
      const plan = planService.getPlan(uid);
      if (!plan) throw new Error(`Plan not found: ${uid}`);
      const items = planItemService.listAllItems(uid);
      const deviations = deviationService.getDeviations(uid);
      return { plan, items, deviations };
    }

    case 'plan.items': {
      const planUid = requireString(params, 'planUid');
      return planItemService.listAllItems(planUid);
    }

    // --- Deviations ----------------------------------------------------------
    case 'deviation.list': {
      const planUid = requireString(params, 'planUid');
      return deviationService.getDeviations(planUid);
    }

    case 'deviation.resolve': {
      const id = params.id as number;
      const resolution = params.resolution as 'accepted' | 'reverted' | 'ignored';
      if (!id || !resolution) throw new Error('id and resolution required');
      deviationService.resolveDeviation(id, resolution);
      return { ok: true };
    }

    // --- Projects ------------------------------------------------------------
    case 'project.list': {
      return recentProjectsService.listRecentProjects();
    }

    case 'project.open': {
      const projectPath = requireString(params, 'projectPath');
      const result = await scanProject(projectPath);
      return result;
    }

    case 'project.active': {
      const activePath = getActiveProjectPath();
      if (!activePath) return null;
      return recentProjectsService.getRecentProject(activePath);
    }

    // --- Terminals -----------------------------------------------------------
    case 'terminal.list': {
      return terminalService.listTerminals();
    }

    case 'terminal.write': {
      const id = requireString(params, 'id');
      const data = requireString(params, 'data');
      const ok = terminalService.writeTerminal(id, data);
      return { ok };
    }

    case 'terminal.read': {
      const id = requireString(params, 'id');
      const lines = (params.lines as number) ?? 100;
      const output = terminalService.readTerminalOutput(id, lines);
      return { output };
    }

    // --- Channel events ------------------------------------------------------
    case 'channel.events': {
      const planUid = requireString(params, 'planUid');
      const limit = (params.limit as number) ?? 50;
      return channelEventService.listChannelEvents(planUid, { limit });
    }

    case 'channel.post': {
      const planUid = requireString(params, 'planUid');
      const eventType = requireString(params, 'eventType');
      const message = (params.message as string) ?? '';
      const author = (params.author as string) ?? 'mobile-user';
      const event = channelEventService.postChannelEvent({
        planUid,
        eventType: eventType as any,
        payload: { message },
        author,
        authorType: 'human',
      });
      return event;
    }

    default:
      throw new Error(`Unknown RPC method: ${method}`);
  }
}

// --- Helpers -----------------------------------------------------------------

function requireString(params: Record<string, unknown>, key: string): string {
  const val = params[key];
  if (typeof val !== 'string' || !val) {
    throw new Error(`Missing required string parameter: ${key}`);
  }
  return val;
}
