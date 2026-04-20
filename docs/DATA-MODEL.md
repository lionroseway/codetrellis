# Data Model

## Core Types

### Graph Types (`src/shared/types/graph.ts`)

```typescript
interface GraphNode {
  id: string;                    // e.g. "pkg:core/file:src/index.ts/fn:main"
  type: 'workspace' | 'package' | 'directory' | 'file' | 'class' | 'function' | 'method' | 'interface' | 'type';
  label: string;
  filePath?: string;
  lineRange?: { start: number; end: number };
  parentId: string | null;
  metadata: Record<string, unknown>;
  changeStatus?: 'added' | 'modified' | 'removed' | 'unchanged';
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'import' | 'call' | 'extends' | 'implements' | 'dependency' | 'devDependency';
  label?: string;
  changeStatus?: 'added' | 'removed' | 'unchanged';
}
```

### AST Types (`src/shared/types/ast.ts`)

```typescript
interface ParsedFile {
  path: string;
  contentHash: string;
  language: SupportedLanguage;
  symbols: ParsedSymbol[];
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
}

interface ParsedSymbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable' | 'enum';
  startLine: number;
  endLine: number;
  children: ParsedSymbol[];      // methods inside classes, etc.
  modifiers: string[];            // 'export', 'async', 'static', etc.
}

type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java';

interface ImportDeclaration {
  source: string;                 // the import path
  specifiers: string[];           // named imports
  isDefault: boolean;
  isNamespace: boolean;
  resolvedPath?: string;          // absolute path after resolution
}

interface ExportDeclaration {
  name: string;
  kind: ParsedSymbol['kind'];
  isDefault: boolean;
}
```

### Agent Types (`src/shared/types/agent.ts`)

```typescript
interface AgentEvent {
  id: string;
  timestamp: number;
  source: 'mcp' | 'claude-code-watcher' | 'file-watcher';
  type: AgentEventType;
  payload: AgentEventPayload;
}

type AgentEventType =
  | 'plan_reported'          // Agent submitted a plan via MCP
  | 'architecture_query'     // Agent queried codebase structure
  | 'conformity_check'       // Agent checked change conformity
  | 'file_changed'           // Detected by file watcher (not agent-reported)
  | 'session_start'
  | 'session_end';

interface AgentPlan {
  id: string;
  title: string;
  steps: AgentPlanStep[];
  status: 'proposed' | 'in_progress' | 'completed' | 'abandoned';
  affectedFiles: string[];
  estimatedImpact: ArchitectureDiff | null;
}

interface AgentPlanStep {
  description: string;
  status: 'pending' | 'active' | 'done' | 'skipped';
  files: string[];
}
```

### Project Types (`src/shared/types/project.ts`)

```typescript
interface MonorepoConfig {
  type: 'npm-workspaces' | 'pnpm-workspaces' | 'nx' | 'turborepo' | 'single';
  root: string;
  packages: PackageInfo[];
  dependencyGraph: Map<string, string[]>;
}

interface PackageInfo {
  name: string;
  path: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}
```

### IPC Types (`src/shared/types/ipc.ts`)

```typescript
interface IpcChannelMap {
  'project:scan': { args: [string]; return: MonorepoConfig };
  'project:scan-progress': { args: [{ phase: string; progress: number }]; return: void };
  'ast:parse-file': { args: [string, string]; return: ParsedFile };
  'ast:parse-batch': { args: [string[]]; return: ParsedFile[] };
  'graph:get-data': { args: [{ depth: number; root?: string }]; return: { nodes: GraphNode[]; edges: GraphEdge[] } };
  'agent:event': { args: [AgentEvent]; return: void };
  'agent:get-plan': { args: []; return: AgentPlan | null };
  'db:search-symbols': { args: [string]; return: ParsedSymbol[] };
  'mcp:status': { args: []; return: { running: boolean; port: number; connectedAgents: number } };
  'conformity:check': { args: [{ proposedImports: Array<{ from: string; importing: string }> }]; return: { conformant: boolean; violations: Array<{ rule: string; message: string; suggestion?: string }> } };
}
```

## SQLite Schema

```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  root_path TEXT UNIQUE NOT NULL,
  monorepo_type TEXT,
  last_scanned INTEGER
);

CREATE TABLE packages (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  version TEXT,
  UNIQUE(project_id, path)
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  package_id INTEGER REFERENCES packages(id),
  path TEXT UNIQUE NOT NULL,
  relative_path TEXT NOT NULL,
  language TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_parsed INTEGER NOT NULL
);

CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES files(id),
  parent_symbol_id INTEGER REFERENCES symbols(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  modifiers TEXT,        -- JSON array
  signature TEXT
);

CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES files(id),
  source_path TEXT NOT NULL,
  resolved_file_id INTEGER REFERENCES files(id),
  specifiers TEXT,       -- JSON array
  is_default BOOLEAN,
  is_namespace BOOLEAN
);

CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL   -- JSON
);

-- Full-text search on symbols
CREATE VIRTUAL TABLE symbols_fts USING fts5(
  name, kind, content=symbols, content_rowid=id
);

-- Indexes
CREATE INDEX idx_symbols_file ON symbols(file_id);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_imports_file ON imports(file_id);
CREATE INDEX idx_imports_resolved ON imports(resolved_file_id);
CREATE INDEX idx_agent_events_session ON agent_events(session_id, timestamp);
```

## Node ID Convention

Graph node IDs encode the hierarchy:
- Workspace: `ws:<root-name>`
- Package: `pkg:<package-name>`
- Directory: `pkg:<name>/dir:<relative-path>`
- File: `pkg:<name>/file:<relative-path>`
- Class: `pkg:<name>/file:<path>/class:<class-name>`
- Function: `pkg:<name>/file:<path>/fn:<function-name>`
- Method: `pkg:<name>/file:<path>/class:<class>/method:<method-name>`

This allows efficient parent lookups and scope filtering.
