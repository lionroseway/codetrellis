/**
 * Who is on the other end of an MCP connection, from what it told us.
 *
 * Every MCP client names itself in `initialize` (`clientInfo.name`). Before
 * this, the only signal read was the SSE request's user-agent — "claude"
 * anywhere in it meant `claude-code`, anything else `mcp-client`. That was
 * already a guess, and the stdio connector makes it useless: every
 * connection through the connector arrives with the connector's user-agent,
 * whichever agent launched it. Worse, `channel-tools` treats an
 * `mcp-client` session as the human.
 *
 * This is attribution, not authorisation. A client can claim any name, the
 * same way `register_session` lets it declare any agent type — so nothing
 * here grants anything. It only decides what the Timeline calls it.
 */

/** Names clients are known to send, mapped to the agent types used elsewhere. */
const KNOWN_CLIENTS: Record<string, string> = {
  'claude-code': 'claude-code',
  'claude-ai': 'claude-desktop',
  'claude-desktop': 'claude-desktop',
  'cursor-vscode': 'cursor',
  cursor: 'cursor',
  codex: 'codex',
  'codex-mcp-client': 'codex',
  windsurf: 'windsurf',
  aider: 'aider',
};

/**
 * The agent type for a client name, or null if the name is unusable.
 *
 * Unknown names pass through as a slug rather than collapsing to
 * `mcp-client`: "my-team-bot" is more useful in the Timeline than a generic
 * label, and a generic label is what gets mistaken for the human.
 */
export function agentTypeFromClientInfo(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug) return null;
  return KNOWN_CLIENTS[slug] ?? slug;
}
