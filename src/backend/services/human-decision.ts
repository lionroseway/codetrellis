/**
 * Phase 31 §4.3 — a decision a person took.
 *
 * No MCP tool may produce a sign-off stamped as a person's. Nothing on an
 * MCP connection can prove a person pressed anything: the transport is a
 * token any local agent holds, and `clientInfo` is whatever the client
 * says. Human decisions arrive by exactly two routes — the desktop UI
 * (REST/IPC) and a paired phone (peer identity from DTLS, per Phase 19).
 *
 * That is enforced structurally, not by convention:
 *
 *  - `criteria-service` takes a `HumanDecision` for every decision a
 *    person makes, and checks it at RUNTIME against the set below. A value
 *    with the right shape that did not come from `issueHumanDecision` is
 *    refused — the type alone would not stop a cast.
 *  - `issueHumanDecision` is called from `server.ts` (desktop) and, from
 *    31.6, the peer RPC layer (phone). `human-decision.test.ts` fails if
 *    anything under `mcp/` names this module or the issuer, and if the
 *    MCP tool dependencies expose it.
 */

export type HumanChannel = 'desktop' | 'phone';

declare const brand: unique symbol;

export interface HumanDecision {
  readonly actor: string;
  readonly channel: HumanChannel;
  /** The paired device, by its alias, when the decision came from one. */
  readonly device?: string | null;
  readonly [brand]: true;
}

const issued = new WeakSet<object>();

/**
 * Only for the transports a person is on. Do not call from `mcp/` — the
 * static test will fail, and it will be right.
 */
export function issueHumanDecision(channel: HumanChannel, actor: string, device: string | null = null): HumanDecision {
  const decision = Object.freeze({ actor, channel, device }) as HumanDecision;
  issued.add(decision);
  return decision;
}

export function isHumanDecision(value: unknown): value is HumanDecision {
  return typeof value === 'object' && value !== null && issued.has(value);
}
