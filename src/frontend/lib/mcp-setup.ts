/**
 * What every "copy MCP config" surface needs, in one place.
 *
 * Three surfaces copy a config: Settings → MCP Server, the guide's
 * Connect-an-agent page, and the status bar. After Phase 19 made the MCP
 * server require a capability token, all three kept copying a bare URL,
 * so a freshly pasted config was refused, and none of them said a
 * credential existed. The status bar even had a hard-coded fallback that
 * could never connect. Copying from here keeps them in step.
 *
 * Shape matches `getMcpSetup` in `backend/mcp/server.ts`.
 */

export interface McpSetup {
  config: Record<string, unknown>;
  url: string;
  header: string;
  queryParam: string;
  tokenFile: string;
  claudeCodeCommand: string;
  agentPrompt: string;
}

export async function fetchMcpSetup(): Promise<McpSetup | null> {
  try {
    const res = await fetch('/api/mcp/setup');
    if (!res.ok) return null;
    return (await res.json()) as McpSetup;
  } catch {
    return null;
  }
}

/** The paste-ready JSON, token included. */
export function configText(setup: McpSetup): string {
  return JSON.stringify(setup.config, null, 2);
}

/** This launch's token, read out of the config rather than sent twice. */
export function tokenOf(setup: McpSetup): string | null {
  const entry = (setup.config as { codetrellis?: { headers?: Record<string, string> } }).codetrellis;
  return entry?.headers?.[setup.header] ?? null;
}

/**
 * For DISPLAY only: the copy buttons use the real value.
 *
 * A config on screen ends up in screenshots and screen shares. The token
 * is per-launch, so a leak is bounded, but there is no reason to show
 * all of it. Enough is kept to tell two launches apart.
 */
export function maskToken(text: string, token: string | null): string {
  if (!token || token.length < 12) return text;
  return text.split(token).join(`${token.slice(0, 4)}…${token.slice(-4)}`);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
