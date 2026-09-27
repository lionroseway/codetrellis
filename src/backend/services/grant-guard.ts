/**
 * Granting is the person's (owner's decision, Phase 32 §0.4k/l).
 *
 * The per-launch capability token opens the REST API as well as MCP, and
 * every agent can read it — the stdio connector has to. So an agent the MCP
 * matrix refused `terminal` or `settings` could grant itself both with one
 * `PUT /api/settings`, and do the same for a paired device, for LAN exposure
 * and for the webhook allowlist (private register, 2026-09-27).
 *
 * The rule now: anything that widens what can reach this machine, or what
 * it can reach, changes only from the app window — the desktop app talks to
 * its backend over Electron IPC, which `cameFromAppWindow` recognises and no
 * token holder can forge — and, later, from a CLI the person runs. Plain HTTP,
 * MCP and the phone are refused, with where to make the change.
 *
 * A test backend may allow it over HTTP (`NODE_ENV=test` AND
 * `CODETRELLIS_ALLOW_HTTP_GRANTS=1`): the harnesses drive the web build over
 * HTTP and have no app window. This is not a way around the rule for anyone
 * who can already set a process's environment — they could as easily edit
 * `settings.json` — which is the same line the rest of the local model draws.
 */

import type { AppSettings } from '../../shared/types';

/** Settings that grant: [section, key, where the person changes it]. */
const GRANT_FIELDS: Array<[keyof AppSettings, string, string]> = [
  ['mcp', 'capabilities', 'Settings → MCP Server'],
  ['mcp', 'projectScope', 'Settings → MCP Server'],
  ['device', 'exposeMobileApi', 'Settings → Devices'],
  ['device', 'advertise', 'Settings → Devices'],
  ['device', 'shareAudio', 'Settings → Devices'],
  ['webhooks', 'allowedHosts', 'Settings → Plans'],
  ['webhooks', 'allowLoopback', 'Settings → Plans'],
];

/** A test backend that lets the harnesses grant over HTTP. */
export function httpGrantsAllowed(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.CODETRELLIS_ALLOW_HTTP_GRANTS === '1';
}

/**
 * The grant a patch would change, as `section.key` with where to change it,
 * or null. Only a CHANGE counts: the Settings window saves whole sections, so
 * an unchanged grant riding along with another field is not a grant.
 */
export function grantChange(patch: unknown, current: AppSettings): { field: string; where: string } | null {
  if (!patch || typeof patch !== 'object') return null;
  const p = patch as Record<string, any>;
  for (const [section, key, where] of GRANT_FIELDS) {
    const next = p[section]?.[key];
    if (next === undefined) continue;
    const now = (current as any)[section]?.[key];
    if (JSON.stringify(next) !== JSON.stringify(now ?? (Array.isArray(next) ? [] : undefined))) {
      return { field: `${section}.${key}`, where };
    }
  }
  return null;
}

export function grantRefusal(field: string, where: string): string {
  return `Only you can change ${field} — in the CodeTrellis app, ${where}.`;
}
