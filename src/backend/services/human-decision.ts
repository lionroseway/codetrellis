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

/**
 * Phase 32 §0.4c-d — a decision that arrived over the local HTTP API.
 *
 * The desktop's own window reaches the backend over IPC (ipc-dispatcher),
 * which a network caller cannot imitate. Plain HTTP with the capability
 * token is a different thing: that token is readable by any local process,
 * agents included, so a decision arriving that way is NOT evidence that a
 * person pressed anything. It used to be stamped `human` on the `desktop`
 * anyway.
 *
 * The owner's rule (2026-09-26): agents are co-workers, so their work is
 * labelled, not blocked. Such a decision is recorded, and counts, but is
 * tagged `unverified` on the `local-api` channel, and every surface that
 * shows it says so. Issued like a HumanDecision, so nothing can forge one.
 */
export interface UnverifiedDecision {
  readonly actor: string;
  readonly channel: 'local-api';
  readonly device?: null;
  readonly [brand]: 'unverified';
}

const unverified = new WeakSet<object>();

export function issueUnverifiedDecision(actor: string): UnverifiedDecision {
  const decision = Object.freeze({ actor, channel: 'local-api' as const, device: null }) as UnverifiedDecision;
  unverified.add(decision);
  return decision;
}

export function isUnverifiedDecision(value: unknown): value is UnverifiedDecision {
  return typeof value === 'object' && value !== null && unverified.has(value);
}

/** Who may take a decision that changes how work is judged: a person, or the unverified local API. */
export type DecisionAuthority = HumanDecision | UnverifiedDecision;

/** The actor type a sign-off records for this authority. */
export function actorTypeOf(decision: DecisionAuthority): 'human' | 'unverified' {
  return isHumanDecision(decision) ? 'human' : 'unverified';
}
