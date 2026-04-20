# MCP Integration

## Overview

The app hosts a local MCP (Model Context Protocol) server that AI coding agents connect to. The MCP interface serves three distinct purposes:

1. **Assist** — Agent queries the codebase to understand architecture, dependencies, and symbols
2. **Ingest Plan** — Agent reports its intended plan so the app can visualize expected impact
3. **Check Conformity** — Agent validates proposed changes against architectural rules/boundaries

File change detection is handled entirely by the filesystem watcher + AST re-parse. The agent does NOT need to report individual edits — the app detects them automatically and re-runs AST parsing. This eliminates roundtrips and keeps the MCP interface focused.

## Transport

- **Protocol**: SSE (Server-Sent Events)
- **URL**: `http://localhost:19432/mcp`
- **Binding**: localhost only (security)
- **Fallback**: If port 19432 is taken, tries 19433-19440

SSE is chosen over stdio because the app is a long-running GUI process. Agents connect when the app is up and gracefully handle disconnection.

## Tools Exposed to Agents

### 1. Assist — Codebase Understanding

#### `check_architecture`
Agent queries current architecture. Returns relevant subgraph.
```json
{ "query": "What modules depend on src/utils/jwt.ts?" }
```
Returns: list of files/symbols that import from the queried path, with relationship types.

#### `get_dependencies`
Returns incoming and outgoing dependencies for a file.
```json
{ "file_path": "src/app.ts" }
```
Returns: `{ imports: [...], importedBy: [...], packageDeps: [...] }`

#### `search_symbols`
FTS search over parsed symbols.
```json
{ "query": "authenticate", "kind": "function" }
```
Returns: matching symbols with file paths and line numbers.

### 2. Ingest Plan

#### `report_plan`
Agent tells the app what it intends to do. The app displays this in the AgentPanel and pre-computes the expected architectural impact by cross-referencing affected files against the current graph.
```json
{
  "plan": {
    "title": "Add authentication middleware",
    "steps": [
      { "description": "Create auth middleware in src/middleware/", "files": ["src/middleware/auth.ts"] },
      { "description": "Add JWT validation", "files": ["src/middleware/auth.ts", "src/utils/jwt.ts"] },
      { "description": "Wire into Express app", "files": ["src/app.ts"] }
    ]
  }
}
```

### 3. Check Conformity

#### `check_conformity`
Agent asks whether a proposed change conforms to architectural rules. The app checks against:
- Package boundary violations (importing from internal modules of another package)
- Circular dependency introduction
- Layer violations (e.g., UI importing directly from DB layer)
- Custom rules defined by the user

```json
{
  "proposed_imports": [
    { "from": "packages/ui/src/Button.tsx", "importing": "packages/db/src/connection.ts" }
  ]
}
```
Returns:
```json
{
  "conformant": false,
  "violations": [
    {
      "rule": "layer-boundary",
      "message": "UI package should not import directly from DB package",
      "suggestion": "Import from packages/api instead"
    }
  ]
}
```

## Resources Exposed to Agents

| URI | Description |
|-----|-------------|
| `project://structure` | Full project tree as JSON |
| `project://graph` | Current dependency graph as JSON |
| `project://packages` | Monorepo package list with inter-package dependencies |

## Change Detection Strategy

The app does NOT rely on the agent to report file changes. Instead:

```
Agent edits file on disk
       ↓
FileWatcher (chokidar, 300ms debounce) detects change
       ↓
Content hash compared — skip if unchanged
       ↓
ASTCoordinator re-parses via Web Worker (incremental tree-sitter)
       ↓
SQLite updated with new symbols/imports
       ↓
DiffEngine computes architectural diff (old snapshot vs new)
       ↓
Graph overlay updates (green=added, orange=modified, red=removed)
```

This approach:
- Requires zero agent cooperation for change tracking
- Works with any tool (agent, manual edits, IDE, scripts)
- Avoids roundtrip overhead of agent reporting each edit
- Provides ground-truth detection (what actually changed on disk)

## Agent Configuration

### Claude Code
Add to `~/.claude/settings.json` or project `.claude.json`:
```json
{
  "mcpServers": {
    "graph-monitor": {
      "type": "sse",
      "url": "http://localhost:19432/mcp"
    }
  }
}
```

The app provides a one-click "Copy MCP config" button in the UI.

## Zero-Config Fallback: Claude Code JSONL Watcher

For users who don't set up MCP, the app passively watches Claude Code's session files:

1. Scans `~/.claude/sessions/*.json` for active sessions (checks PID liveness)
2. Reads `cwd` field to correlate with monitored project
3. Tails corresponding JSONL in `~/.claude/projects/`
4. Extracts tool calls (file reads/writes/edits)
5. Heuristically extracts plan-like content from assistant messages
6. Emits normalized `AgentEvent` objects

This provides read-only monitoring without any configuration.

## Future: Other Agents

The MCP interface is agent-agnostic. Any agent that supports MCP can connect:
- Cursor (when MCP support lands)
- Copilot Workspace
- Custom agents via Claude API / Agent SDK
- Aider, Continue, etc.
