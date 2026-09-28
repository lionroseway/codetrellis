/**
 * How a record's author type reads on screen (Phase 32, carried item 2).
 *
 * `human` is the person in the app window or on their paired phone.
 * `unverified` is the local API over plain HTTP: a person in a browser or a
 * script that read the token (§0.4d). It is not an agent, and it is not
 * proven to be the person, so it is never shown as either. Anything else is
 * an agent, named by its type.
 */
export type AuthorKind = 'person' | 'unverified' | 'agent';

export function authorKind(authorType: string | null | undefined): AuthorKind {
  if (!authorType || authorType === 'human') return 'person';
  if (authorType === 'unverified') return 'unverified';
  return 'agent';
}

export const UNVERIFIED_WORDS = 'local API, unverified';

/**
 * How an unverified change arrived, for the tag's tooltip (carried item 2b).
 * Plain words: what sent it, why the name can't be trusted, and where to
 * refuse such changes.
 */
export const UNVERIFIED_EXPLAINER =
  'Sent over plain HTTP with this launch\'s token, by a browser tab, a script or another tool on this machine, ' +
  'not from the CodeTrellis window. The name on it could not be checked. ' +
  'To refuse these changes, turn off Settings → MCP Server → Local API.';

/**
 * The author type of a plan or doc version. Versions saved before the type
 * was kept (carried 2b) have none: those an agent saved say "agent", which is
 * all the MCP tool used to write, and the rest were a person's edit.
 */
export function versionAuthorType(v: { author: string; authorType?: string | null }): string {
  return v.authorType ?? (v.author === 'agent' ? 'mcp' : 'human');
}

/** "dana@example.com (local API, unverified)" for an unverified write; the name otherwise. */
export function authorWithSource(author: string, authorType: string | null | undefined): string {
  return authorKind(authorType) === 'unverified' ? `${author} (${UNVERIFIED_WORDS})` : author;
}
