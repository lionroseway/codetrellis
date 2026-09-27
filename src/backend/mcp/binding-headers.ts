/**
 * Where an agent is working, as the stdio connector reports it on connect
 * (Phase 32 A1.1).
 *
 * The connector is launched by the agent, in the agent's working directory,
 * so its `cwd` is the folder the agent works in; a terminal CodeTrellis
 * started exports `CODETRELLIS_HOST_TERMINAL`. Both ride on the SSE connect
 * request. The server uses the folder only to CHOOSE a workstream from roots
 * it already trusts, never as a root to read from (Phase 19).
 *
 * Header values are Latin-1 on the wire, so the folder is percent-encoded.
 */
export const CWD_HEADER = 'x-codetrellis-cwd';
export const HOST_TERMINAL_HEADER = 'x-codetrellis-host-terminal';

export interface SessionBindingHint {
  cwd?: string | null;
  hostTerminal?: string | null;
}

export function bindingHeaders(hint: SessionBindingHint): Record<string, string> {
  const out: Record<string, string> = {};
  if (hint.cwd) out[CWD_HEADER] = encodeURIComponent(hint.cwd);
  if (hint.hostTerminal) out[HOST_TERMINAL_HEADER] = encodeURIComponent(hint.hostTerminal);
  return out;
}

/** Read the hint back from request headers. Anything malformed is simply absent. */
export function readBindingHeaders(headers: Record<string, string | string[] | undefined>): SessionBindingHint {
  const one = (name: string): string | null => {
    const raw = headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;
    try {
      const decoded = decodeURIComponent(value);
      return decoded.includes('\0') ? null : decoded;
    } catch {
      return null;
    }
  };
  return { cwd: one(CWD_HEADER), hostTerminal: one(HOST_TERMINAL_HEADER) };
}
