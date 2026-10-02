/**
 * When an agent's turn ends: a gap longer than this between its events.
 *
 * One number for every place that asks. The Timeline groups events into
 * turns with it (a rendering heuristic, deliberately not a setting: a user
 * asked to tune it would be debugging our grouping), the budget counts a
 * turn's time with it, and replay takes a frame when a turn ends by it
 * (Phase 32 B5.1). Any MCP client has turns by this rule; no client's own
 * notion of a turn is needed.
 */
export const TURN_GAP_MS = 30_000;
