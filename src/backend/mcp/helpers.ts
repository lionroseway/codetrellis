/**
 * Shared helpers used by multiple MCP tool modules.
 */

import type { ToolDeps } from './types';

/**
 * Build a tool result with broadcast metadata so agents know the UI
 * was notified. `subscribers` is the number of WS + IPC clients that
 * received the message (0 means no UI is connected).
 */
export function resultWithMeta(data: any, subscribers: number) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ ...data, _meta: { broadcast: true, subscribers } }, null, 2),
    }],
  };
}

/**
 * Pull author identity from the MCP transport's session.
 * Used by plan-item tools and plan template tools.
 */
export function authorFromExtra(deps: ToolDeps, extra: any): { author: string; authorType: string } {
  const sessionId = extra?.sessionInfo?.sessionId
    ?? extra?.requestInfo?.headers?.['mcp-session-id']
    ?? null;
  const sessions = deps.sessionService.getActiveSessions();
  const session = sessionId ? sessions.find((s: any) => s.sessionId === sessionId) : null;
  const author = (session as any)?.agentType ?? 'agent';
  return { author, authorType: 'mcp' };
}
