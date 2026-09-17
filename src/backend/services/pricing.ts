/**
 * Model pricing — Phase 23.
 *
 * See [docs/PHASE-23-BUDGETS.md](../../../docs/PHASE-23-BUDGETS.md).
 *
 * Deliberately a **data table with a version stamp**, not constants
 * scattered through a service. Prices change, and a stale multiplier
 * buried in code silently corrupts every historical figure we have
 * already shown someone. Kept here, it is one file to update and one
 * value (`PRICING_VERSION`) to show in Settings so a user can tell how
 * old the numbers are.
 *
 * USD per million tokens. Cache reads and writes are priced separately
 * because for a long agent session they dominate: an agent re-reading a
 * large plan on every turn is mostly cache reads, and pricing those at
 * the input rate would overstate cost several-fold.
 */

export interface ModelPricing {
  /** Matched case-insensitively as a substring of the reported model id. */
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

/**
 * Bump when any row changes. Surfaced next to any cost figure so an old
 * number is identifiable as old rather than silently wrong.
 */
export const PRICING_VERSION = '2026-09-17';

/**
 * Ordered most-specific first — `claude-opus-4-1` must win over
 * `claude-opus`. Rows a user's model does not match yield no cost at
 * all, which is the correct answer for a model we do not have prices
 * for. See `priceFor`.
 */
export const MODEL_PRICING: ReadonlyArray<ModelPricing> = [
  { match: 'claude-opus-5',   inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  { match: 'claude-sonnet-5', inputPerMTok: 3,  outputPerMTok: 15, cacheWritePerMTok: 3.75,  cacheReadPerMTok: 0.3 },
  { match: 'claude-haiku-4',  inputPerMTok: 1,  outputPerMTok: 5,  cacheWritePerMTok: 1.25,  cacheReadPerMTok: 0.1 },
  { match: 'claude-opus',     inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  { match: 'claude-sonnet',   inputPerMTok: 3,  outputPerMTok: 15, cacheWritePerMTok: 3.75,  cacheReadPerMTok: 0.3 },
  { match: 'claude-haiku',    inputPerMTok: 1,  outputPerMTok: 5,  cacheWritePerMTok: 1.25,  cacheReadPerMTok: 0.1 },
];

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

/** Pricing for a reported model id, or null when we don't know it. */
export function priceFor(model: string | null | undefined): ModelPricing | null {
  if (!model) return null;
  const m = model.toLowerCase();
  return MODEL_PRICING.find((p) => m.includes(p.match)) ?? null;
}

/**
 * Cost in USD, or **null** when the model is unknown.
 *
 * Null rather than zero, and the distinction is the whole point. A zero
 * reads as "this was free"; null reads as "we do not know", which is the
 * truth for any agent that does not report its model. Inventing a figure
 * here would be the fastest way to lose a user's trust in every other
 * number the app shows.
 */
export function costOf(model: string | null | undefined, tokens: TokenCounts): number | null {
  const pricing = priceFor(model);
  if (!pricing) return null;

  const perToken = (perMTok: number, count: number): number => (perMTok * count) / 1_000_000;

  return (
    perToken(pricing.inputPerMTok, tokens.inputTokens) +
    perToken(pricing.outputPerMTok, tokens.outputTokens) +
    perToken(pricing.cacheWritePerMTok, tokens.cacheWriteTokens ?? 0) +
    perToken(pricing.cacheReadPerMTok, tokens.cacheReadTokens ?? 0)
  );
}

/** `$3.10`, `$0.004`, `—` for unknown. */
export function formatCost(usd: number | null): string {
  if (usd === null) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
