# Phase 17: Plan Authoring & Execution — The Full Human Loop

**Status:** design
**Last updated:** 2026-05-17
**Depends on:** Phase 16 (UX overhaul complete)
**Goal:** A human opens CodeTrellis, understands their codebase in 30
seconds, builds a plan in 2 minutes, hands it to an AI agent, and
stays in control throughout execution.

---

## The Full Journey

```
UNDERSTAND → PLAN → HAND OFF → MONITOR → REVIEW → ITERATE
```

Phase 16 nailed the workspace chrome. Phase 17 makes the entire loop
feel like one connected flow, not six separate activities.

---

## Part 1: Understanding (Before You Plan)

### 17.A — Codebase Orientation

**Problem:** User opens the app, sees a graph of 200 nodes, and thinks
"now what?" The graph shows structure but doesn't explain PURPOSE.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Architecture summary** | Auto-generated one-paragraph overview from graph topology: "This is a monorepo with 3 services (API, Worker, Frontend). API has 42 routes. Frontend has 120 components." |
| **Cluster descriptions** | Click a package/directory cluster → sidebar shows: purpose (from package.json description or README), file count, export count, incoming/outgoing dependency count, recent change frequency |
| **Cross-system map** | Overlay toggle showing HTTP/SQL coupling between services (data already exists in cross-system-service). Shows which frontend components call which API routes. |
| **Impact preview** | Hover a node → ghost-highlight all its dependents. "If you change this file, these 12 files import it." Uses the blast radius data from diff-engine. |
| **Hot spots** | Color nodes by churn rate (git log), complexity, or coupling degree. "These 5 files change together every sprint — they're probably coupled." |

**Why it matters:** You can't plan a change if you don't understand
what you're changing. These features turn the graph from a map into a
guide.

### 17.B — "What Does This Do?" (AI-Powered)

**Problem:** User clicks a module but still doesn't know what it DOES
without reading the source.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Module summary** | Right-click cluster → "Explain this module" → sends the file list + exports + cross-system edges to a connected agent → returns a 2-sentence summary displayed in the inspector |
| **Relationship explanation** | Click an edge → "Why are these connected?" → shows the specific import/call that creates the dependency |
| **"What calls this?"** | Right-click a symbol → shows callers (from callsite extraction). Actionable: "Plan changes to all callers" |

**Leverages:** Callsite extraction service, cross-system edges,
connected agent via MCP.

---

## Part 2: Planning (Fast and Precise)

### 17.C — Selection-Driven Planning

**Problem:** Right-click → "Plan a change" works for one file. But
most real changes touch 5-15 files. One-at-a-time is slow.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Multi-select on graph** | Shift+click or drag-lasso to select multiple nodes. Selection persists across pan/zoom. Count badge shows "5 selected" |
| **"Plan these" floating button** | Appears when 2+ nodes selected. Creates a task with all selected files as targets. |
| **Cluster → scope** | Right-click package/directory → "Scope plan to this" → creates task with `scopePath` set, all files in cluster as targets |
| **Drag from graph** | Drag a node from graph into the workspace body or targets area (in split view) |

### 17.D — Symbol-Aware File Expansion

**Problem:** "Modify src/auth/service.ts" is vague. Which function?
What change?

**Features:**

| Feature | What it does |
|---------|--------------|
| **Auto-expand on add** | When a file target is added, fetch its symbols from `/api/symbols?file=<path>` and show inline |
| **Checkboxes per symbol** | User checks specific functions they want changed. Unchecked = "leave alone" |
| **Per-symbol instruction** | Each checked symbol gets a text field: "Add refresh token rotation" |
| **Blast radius badge** | "Used by 7 files" on each function. Click → see caller list. "Include callers" button to auto-add them |
| **Interface contracts** | If a symbol is an exported interface/type, show where it's consumed. Warn: "Changing this signature breaks 4 consumers" |

### 17.E — Smart Plan Templates

**Problem:** Blank page is clean but doesn't prompt the user toward
completeness.

**Templates that ASK the right questions:**

| Template | Prompting questions |
|----------|-------------------|
| **Refactor** | What's being renamed/moved? From where → to where? What pattern should callers follow? |
| **New feature** | What does it do? Where does it live? What existing code does it touch? Acceptance criteria? |
| **Bug fix** | What's wrong? Where does it happen? Expected behavior? How to reproduce? |
| **Dependency upgrade** | Package, current version, target version. Known breaking changes? |
| **API change** | Endpoint(s), current contract, new contract. Callers to update? |
| **Performance** | What's slow? Where's the bottleneck (file/function)? Target metric? |

Each template:
- Pre-fills the body with structured prompting (not empty sections)
- Auto-suggests relevant targets based on the template type
- Produces output that reads as a direct prompt for an agent

### 17.F — Plan Constraints & Guardrails

**Problem:** User wants to say "change X but DON'T touch Y" or "make
sure tests still pass." No way to express constraints today.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Exclusion list** | "Do not modify these files" — attached to plan or task. Agent sees it; drift detector flags violations. |
| **Interface locks** | "This exported type must not change its signature" — deviation detector alerts if it does |
| **Test requirements** | "Run these test files after each task" — attached as verification criteria. Plan isn't "done" until tests pass. |
| **Scope fence** | "Only modify files under src/auth/" — anything outside is flagged as drift |
| **Dependency rules** | "Do not add new dependencies" or "Only use packages already in package.json" |

**Why it matters:** Humans know things about the codebase that aren't
in the code. Constraints express institutional knowledge. Without
them, agents guess — and sometimes guess wrong.

### 17.G — Plan Review & Readiness

**Problem:** User writes a plan but doesn't know if it's "good enough"
for an agent to execute without going off-rails.

**Features:**

| Check | What it means |
|-------|---------------|
| ✓ Has title and intent | Plan has a clear "what and why" |
| ✓ Tasks have targets | Every action references at least 1 file |
| ✓ Targets exist | All referenced files exist in the project |
| ✓ No circular deps | Task dependency graph has no cycles |
| ✓ Scope is bounded | Total file count is < 50 (or explicit ack) |
| ○ Symbols specified | Targets drill down to specific functions |
| ○ Tests mentioned | Plan references or creates test coverage |
| ○ Constraints defined | At least one guardrail set |
| ○ Agent can reach files | Files are in a connected agent's workspace |

Display as a readiness ring in the header. Green = "hand it off."
Amber = "could be more specific." Red = "missing fundamentals."

Optional: "Ask AI to review" button → connected agent reads the plan
and suggests improvements ("Task 3 references a file that doesn't
exist yet — did you mean to create it?")

---

## Part 2.5: Routing & Execution Rules (Who Does What, With What)

This is the control layer between authoring and handoff. It answers
three questions the current system can't: **who** can work on an item,
**what tools** they should use, and **how** those rules flow through
the tree.

### 17.N — Skill & Plugin Bindings

**Problem:** A task says "write Playwright tests" but the agent that
claims it doesn't have Playwright MCP installed. Or a task should use
a specific refactoring skill, but there's no way to say so.

**Concept:** Each item can declare **required skills** — named
capabilities that an agent must have to claim or execute the item.

```
skills: [
  { name: "playwright",  source: "mcp",    required: true  },
  { name: "typescript",   source: "lang",   required: false },
  { name: "@refactor",    source: "skill",  required: true  },
]
```

**Source types:**
- `mcp` — an MCP server/tool the agent must have connected (e.g.,
  Playwright, GitHub, database)
- `skill` — a named slash-command or workflow the agent supports
  (e.g., `@refactor`, `@test-gen`)
- `lang` — a language/framework the agent should be proficient in
  (advisory, not enforced)
- `plugin` — a specific CodeTrellis plugin or extension

**How it works:**

| Step | What happens |
|------|--------------|
| Human adds skills in the item properties panel | Skills appear as chips below the status row. Autocomplete from connected agent capabilities + known MCP servers. |
| Agent calls `get_next_task()` | Backend checks `item.skills` against `agent_session.capabilities`. Only returns items the agent can satisfy. |
| Agent calls `claim_item()` | Backend validates: if item has required skills the agent lacks, claim is rejected with a clear error: "This task requires the 'playwright' MCP server." |
| Readiness check (17.G) | "⚠ Task 3 requires 'playwright' but no connected agent has it" |

**Agent capability registration:**

When an agent connects via MCP, it optionally declares capabilities:

```
register_session({
  agentType: "claude-code",
  model: "claude-opus-4",
  capabilities: [
    { name: "playwright", source: "mcp" },
    { name: "typescript", source: "lang" },
  ]
})
```

If an agent doesn't declare capabilities, it's treated as
"general-purpose" and can claim items with no required skills, but
not items that require specific skills.

### 17.O — Claim Restrictions (Who Can Work on This)

**Problem:** Some items should only be worked on by a specific agent.
Some should be human-only (no agent can claim). Some should be open to
any agent. Currently every agent can claim every pending item.

**Concept:** Each item has a `claimPolicy` that controls who can work
on it.

```typescript
interface ClaimPolicy {
  /** Who can claim this item. */
  mode: 'any'           // Any agent can claim (default)
       | 'agent-only'   // Only AI agents (not manually completable)
       | 'human-only'   // No agent can claim; human marks done manually
       | 'assigned'     // Only the specifically assigned agent/human
       | 'match-skills' // Any agent whose capabilities match required skills
       ;

  /** If mode='assigned', who specifically. */
  assignTo?: string | null;       // session ID or human identity
  assignToType?: 'agent' | 'human';

  /** Allowed agent types (e.g., only 'claude-code', not 'cursor'). */
  allowedAgentTypes?: string[];

  /** Allowed models (e.g., only 'claude-opus-4'). */
  allowedModels?: string[];
}
```

**UI:**

In the item properties panel, a "Who works on this" dropdown:
- **Anyone** (default) — any connected agent can claim
- **Specific agent** → shows connected agents, pick one
- **Human only** — no AI; human marks done via checkbox
- **By capability** — auto-match based on required skills
- **Agent type** → checkboxes: Claude Code, Cursor, Aider, etc.

**Backend enforcement:**

`get_next_task()` filters by claim policy before returning items.
`claim_item()` validates against the policy and rejects with a clear
message: "This task is restricted to human-only completion."

### 17.P — Cascade & Inheritance

**Problem:** A plan has 20 tasks. The user wants all of them to use
the Playwright MCP and be restricted to Claude Code — but ONE task
should use Cursor instead. Setting this per-task is tedious.

**Concept:** Item properties cascade down the tree, with per-item
overrides.

**How cascading works:**

```
Plan root
├── Page: "Auth refactor" ← skills: [typescript, @refactor]
│   ├── Task: "Refactor login"     ← inherits: [typescript, @refactor]
│   ├── Task: "Refactor signup"    ← inherits: [typescript, @refactor]
│   └── Task: "Write tests"       ← override: [typescript, playwright]
└── Page: "UI update"    ← skills: [react], claimPolicy: human-only
    ├── Task: "Redesign nav"       ← inherits: human-only
    └── Task: "Fix mobile layout"  ← override: claimPolicy: any
```

**Cascadeable properties:**

| Property | Cascades? | Override? |
|----------|-----------|-----------|
| `skills` | Yes — children inherit parent's skills (merged, not replaced) | Yes — child can add/remove/replace |
| `claimPolicy.mode` | Yes — children inherit parent's policy | Yes — child can override |
| `claimPolicy.allowedAgentTypes` | Yes | Yes |
| `scopePath` | Yes — children resolve relative paths from parent's scope | Yes |
| `constraints` (17.F) | Yes — parent constraints apply to all children | Yes — child can relax or tighten |
| `template` | No — each item picks its own template | n/a |
| `status` | No — each item tracks independently | n/a |
| `fileSpecs` | No — each item has its own targets | n/a |

**Override mechanics:**

Each item stores only its **local** values. The effective (resolved)
value is computed at read time by walking up the tree:

```typescript
function resolveSkills(item: PlanItem, itemsByUid: Record<string, PlanItem>): Skill[] {
  const chain: PlanItem[] = [];
  let cur: PlanItem | null = item;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentUid ? itemsByUid[cur.parentUid] : null;
  }
  // Merge skills up the chain. Later items override earlier.
  let resolved: Skill[] = [];
  for (const ancestor of chain) {
    if (ancestor.skillsOverride === 'replace') {
      resolved = ancestor.skills ?? [];
    } else {
      resolved = mergeSkills(resolved, ancestor.skills ?? []);
    }
  }
  return resolved;
}
```

**Override modes per property:**
- `inherit` (default) — use parent's value, merge with local additions
- `replace` — ignore parent, use only local value
- `none` — explicitly clear this property (no skills, no policy)

**UI for cascading:**

In the item properties panel, each cascadeable property shows:
- The **effective** (resolved) value
- A subtle "(inherited from Auth refactor)" label if it came from a parent
- An "Override" link to set a local value
- A "Reset" link to clear the override and re-inherit

When setting properties on a Page (object), a note says:
"These settings will apply to all child tasks unless overridden."

**Backend:**

`get_next_task()` and `claim_item()` call `resolveClaimPolicy(item)`
which walks the tree. The raw DB columns store only local overrides;
the API response includes both `raw` and `resolved` values.

---

### Schema Changes Required

```sql
-- New columns on plan_items
ALTER TABLE plan_items ADD COLUMN skills           TEXT NOT NULL DEFAULT '[]';
ALTER TABLE plan_items ADD COLUMN skills_mode      TEXT DEFAULT 'inherit';  -- inherit | replace | none
ALTER TABLE plan_items ADD COLUMN claim_policy      TEXT DEFAULT NULL;       -- JSON ClaimPolicy or null (inherit)
ALTER TABLE plan_items ADD COLUMN claim_policy_mode TEXT DEFAULT 'inherit';  -- inherit | replace

-- New columns on agent_sessions
ALTER TABLE agent_sessions ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
```

```typescript
// Added to PlanItem interface
skills?: Skill[];
skillsMode?: 'inherit' | 'replace' | 'none';
claimPolicy?: ClaimPolicy | null;
claimPolicyMode?: 'inherit' | 'replace';

// Added to AgentSessionInfo interface
capabilities?: AgentCapability[];

interface Skill {
  name: string;
  source: 'mcp' | 'skill' | 'lang' | 'plugin';
  required: boolean;
}

interface AgentCapability {
  name: string;
  source: 'mcp' | 'skill' | 'lang' | 'plugin';
}
```

### 17.Q — Execution Configuration (Model Settings per Item)

**Problem:** "Use Claude Code" isn't enough. The user wants to say:
"Use claude-opus-4 at high reasoning effort, with this system prompt,
restricted to these tools, with a 20k token budget." Different tasks
in the same plan might need radically different execution profiles.

**Concept:** Each item can carry an `executionConfig` that specifies
exactly how the assigned agent should behave.

```typescript
interface ExecutionConfig {
  /** Model override — which model to use for this task. */
  model?: string;                // 'claude-opus-4' | 'claude-sonnet-4' | etc.

  /** Reasoning effort (for models that support it). */
  reasoningEffort?: 'low' | 'medium' | 'high';

  /** System prompt prepended to the task context. */
  systemPrompt?: string;         // e.g., "You are a security auditor..."

  /** Tool/MCP restrictions — allowlist of tools the agent may use. */
  allowedTools?: string[];       // ['Read', 'Edit', 'Bash'] — empty = all

  /** Tool denylist — tools the agent must NOT use. */
  deniedTools?: string[];        // ['Write', 'Bash'] — overrides allowed

  /** Token budget — max tokens the agent should spend on this task. */
  maxTokens?: number;

  /** Max iterations / tool calls before the agent should stop. */
  maxIterations?: number;

  /** Output expectations — what the agent should produce on completion. */
  outputFormat?: 'pr-description' | 'commit-message' | 'summary' | 'none';

  /** Temperature (for creative vs mechanical tasks). */
  temperature?: number;          // 0.0-1.0

  /** Custom key-value pairs passed to the agent as context. */
  customParams?: Record<string, string | number | boolean>;
}
```

**Examples:**

| Task type | Config |
|-----------|--------|
| Mechanical refactor (rename across 20 files) | model: sonnet, reasoning: low, allowedTools: [Read, Edit], maxIterations: 100 |
| Architecture design | model: opus, reasoning: high, systemPrompt: "Think carefully about maintainability and extensibility", outputFormat: summary |
| Security audit | model: opus, reasoning: high, systemPrompt: "You are a security auditor. Flag vulnerabilities.", deniedTools: [Edit, Write, Bash] |
| Test generation | model: sonnet, allowedTools: [Read, Edit, Bash], systemPrompt: "Write comprehensive tests following existing patterns in __tests__/" |
| Quick fix | model: haiku, reasoning: low, maxTokens: 4000 |

**Cascade behavior:** `executionConfig` cascades like skills:
- Parent sets `model: opus` → all children use opus unless overridden
- Child sets `model: sonnet` → only that child uses sonnet
- `systemPrompt` APPENDS by default (parent prompt + child prompt),
  or replaces if mode is `replace`

**UI:**

In the item properties panel, an "Execution settings" expandable
section (collapsed by default). Shows:
- Model selector (dropdown of known models)
- Reasoning slider (low/medium/high)
- System prompt (textarea, collapsed to first line)
- Tool restrictions (chip selector from known tools)
- Budget fields (tokens, iterations)

Inherited values show with "(from parent)" label. Override link to
customize.

**Delivery to agent:**

When agent calls `claim_item()` or `get_next_task()`, the response
includes `resolvedConfig: ExecutionConfig` — the fully cascaded
settings. The agent is expected to honor them (this is a contract,
not enforcement — CodeTrellis can't force an external agent to obey,
but it documents the intent and drift detection can flag violations).

For Claude Code specifically: the `systemPrompt` maps to
CLAUDE.md-style instructions that get prepended to the session.

### 17.R — External References (Issues, PRs, Commits, Docs)

**Problem:** Plans don't exist in a vacuum. They originate from GitHub
issues, relate to open PRs, reference past commits, and connect to
external docs. Currently the only way to bring this context in is
to copy-paste text into the body.

**Concept:** First-class `ExternalRef` objects that link plan items to
external sources with bidirectional awareness.

```typescript
interface ExternalRef {
  uid: string;
  itemUid: string;              // which plan item this is attached to
  planUid: string;

  /** What kind of external thing this is. */
  kind: 'github-issue'
      | 'github-pr'
      | 'github-commit'
      | 'github-discussion'
      | 'linear-issue'
      | 'jira-ticket'
      | 'url'                   // generic web link
      | 'doc'                   // Google Doc, Notion page, etc.
      ;

  /** The canonical URL. */
  url: string;

  /** Extracted metadata (fetched on add, refreshable). */
  title: string;
  body?: string;                // first ~500 chars of body/description
  status?: string;              // 'open' | 'closed' | 'merged' | etc.
  author?: string;
  labels?: string[];
  linkedFiles?: string[];       // file paths mentioned in the issue/PR

  /** Relationship to this plan item. */
  relation: 'source'            // "this issue is WHY we're doing this"
          | 'context'           // "this PR is relevant background"
          | 'blocks'            // "this issue blocks our work"
          | 'implements'        // "this plan item implements this issue"
          | 'supersedes'        // "this plan replaces/supersedes that PR"
          ;

  /** Lifecycle hooks — what happens when the plan item completes. */
  onComplete?: 'close-issue'    // auto-close the linked issue
             | 'comment'        // post a comment: "Completed via CodeTrellis plan X"
             | 'create-pr'      // auto-create a PR from the plan's branch
             | 'none'
             ;

  createdAt: number;
  updatedAt: number;
}
```

**Inbound flows (bringing external context IN):**

| Source | How it gets in | What happens |
|--------|---------------|--------------|
| Paste a GitHub issue URL | User pastes in body or "Add reference" button | Fetches title, body, labels. Extracts mentioned file paths → suggests as targets. Sets `relation: 'source'` |
| Paste a PR URL | Same | Fetches title, body, changed files. Shows diff stats. "Use PR files as targets?" prompt. Sets `relation: 'context'` |
| Paste a commit SHA/URL | Same | Fetches commit message + changed files. "Follow this pattern?" prompt. |
| Link from GitHub Actions | Webhook or MCP tool | Agent creates ref automatically when it opens a PR |
| Claude Code session | JSONL watcher detects GitHub URLs in conversation | Surfaces as "mentioned in agent session" with import prompt |
| Bulk import | "Import from GitHub" button → shows recent issues with labels/milestones | Pick multiple → creates one task per issue, auto-linked |

**Outbound flows (acting on external sources AFTER execution):**

| Action | When | What happens |
|--------|------|--------------|
| Close linked issue | Plan completes + all tasks done | POST to GitHub API: close issue + comment with plan summary |
| Create PR | Plan completes + has targetBranch | `gh pr create` with body auto-generated from plan targets + descriptions |
| Comment on issue | Task completes | Post: "Task 'Refactor login' completed. Files changed: ..." |
| Update PR description | Task completes + PR exists | Append task completion status to PR body |

**UI:**

In the item canvas, external refs appear as a compact strip below the
body (similar to TargetsStrip):

```
📎 References
  🔗 Fix auth token refresh (#142) · open · source
  🔗 PR #156: Previous attempt · closed · context
  ⬡ abc1234: "Add token rotation" · commit · context
```

Each ref is clickable (opens in browser), has a relationship badge,
and an "×" to remove. The "Add reference" button supports paste or
search (searches connected GitHub/Linear via their APIs).

**Cascade behavior:** External refs do NOT cascade. Each item has its
own refs. But: a parent Page might reference a GitHub epic, while
child Tasks reference individual issues under that epic. The
completion hook respects the tree: completing all children auto-closes
the parent's linked epic (if configured).

**Integration with claim/handoff:**

When an agent claims a task with external refs, the response includes:
- The ref metadata (title, body, linked files)
- For `source` refs: the full issue body as context
- For `context` refs: a summary of the PR/commit changes

This means the agent gets the "why" (from the issue) alongside the
"what" (from the fileSpecs) without the human needing to copy-paste.

**Required backend:**

| Component | Exists? | Work needed |
|-----------|---------|-------------|
| GitHub API access | No | OAuth flow or token config in settings |
| Linear API | No | OAuth flow |
| `external_refs` table | No | New table (schema above) |
| Fetch metadata on paste | No | URL parser + GitHub/Linear REST calls |
| Lifecycle hooks (close/comment) | No | GitHub API calls on plan completion |
| Webhook receiver | No | For inbound updates (issue closed externally → update ref status) |

### Schema additions for 17.Q + 17.R

```sql
-- Execution config on plan_items (JSON blob, nullable = inherit)
ALTER TABLE plan_items ADD COLUMN execution_config      TEXT DEFAULT NULL;
ALTER TABLE plan_items ADD COLUMN execution_config_mode TEXT DEFAULT 'inherit';

-- External references table
CREATE TABLE IF NOT EXISTS external_refs (
  uid          TEXT PRIMARY KEY,
  item_uid     TEXT NOT NULL REFERENCES plan_items(uid) ON DELETE CASCADE,
  plan_uid     TEXT NOT NULL REFERENCES plans(uid),
  kind         TEXT NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT DEFAULT NULL,
  status       TEXT DEFAULT NULL,
  author       TEXT DEFAULT NULL,
  labels       TEXT NOT NULL DEFAULT '[]',
  linked_files TEXT NOT NULL DEFAULT '[]',
  relation     TEXT NOT NULL DEFAULT 'context',
  on_complete  TEXT DEFAULT 'none',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_refs_item ON external_refs(item_uid);
CREATE INDEX IF NOT EXISTS idx_external_refs_plan ON external_refs(plan_uid);
CREATE INDEX IF NOT EXISTS idx_external_refs_url  ON external_refs(url);
```

```typescript
// Added to PlanItem
executionConfig?: ExecutionConfig | null;
executionConfigMode?: 'inherit' | 'replace';
externalRefs?: ExternalRef[];   // populated on fetch, not stored inline
```

---

## Part 3: Handoff (Plan → Agent)

### 17.H — One-Click Handoff

**Problem:** Plan is ready. Now the user has to... copy-paste it into
Claude Code? Open Cursor and re-describe it? The last mile is manual.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Copy as prompt** | Generates optimized markdown from plan (title + body + targets + constraints). One click → clipboard. Formatted for the active agent type. |
| **Push to agent via MCP** | If agent is connected, push the plan as a structured `plan_assigned` event. Agent receives full context without manual copy. |
| **Assign to specific agent** | Workspace header shows connected agents. Click one → plan.status = "assigned", agent receives notification via next `get_next_task()` call. |
| **Assign per-task** | Different tasks can go to different agents. "Task 1 → Claude Code (refactoring), Task 2 → Cursor (UI work)" |
| **Git context auto-set** | On handoff, auto-populate `targetBranch` (from plan title), `baseRef` (current HEAD), `autoCreateBranch: true`. Agent creates the branch. |

### 17.I — Import from External Sources

**Problem:** The plan often starts outside CodeTrellis — in a GitHub
issue, a Slack thread, a conversation with an agent.

**Features:**

| Source | What happens |
|--------|--------------|
| **GitHub/Linear issue URL** | Paste URL → extracts title + body + labels. Auto-maps mentioned file paths to targets. |
| **Claude Code session** | The JSONL watcher already detects "plan-like text" (3+ numbered steps). Surface these as "Suggested plan from session" with one-click import. |
| **Paste a conversation** | Paste a chat log → AI extracts the plan structure (tasks, files mentioned, intent). Creates pre-filled plan. |
| **From git diff** | "I changed this file manually — now do the same pattern across all similar files." Extracts the pattern, finds matching files, creates tasks per file. |

---

## Part 4: Execution & Monitoring

### 17.J — Live Execution Dashboard

**Problem:** Agent is running. User sees task status flip to
"in_progress" but doesn't know what's actually happening.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Active task spotlight** | Currently-running task is highlighted in sidebar with animated border. Canvas shows live progress % |
| **File change stream** | Real-time list of files the agent is touching (from Claude Code watcher or MCP tool calls). Shows: "Writing to src/auth/oauth.ts..." |
| **Graph animation** | Nodes being actively modified pulse amber. Nodes completed pulse green then settle. Split view shows this live alongside the workspace. |
| **Tool call timeline** | Bottom strip showing agent's MCP tool calls in real-time: "Read file → Edit file → Run tests → ..." |
| **Progress comments** | Agent calls `update_task_progress(75%, "Finished refactoring 3/4 callers")`. Shows inline on the task. |

### 17.K — Approval Gates & Pause/Resume

**Problem:** User doesn't want the agent to blast through all 5 tasks
without review. Some tasks need human approval before the next one
starts.

**Features:**

| Feature | What it does |
|---------|--------------|
| **Approval gate** | Mark a task as "requires approval." Agent completes it, stops, waits. Human reviews the diff, clicks "Approve" → agent continues. |
| **Pause/resume** | "Pause after this task" button in workspace header. Agent finishes current task, stops. |
| **Task diff preview** | When a task completes, show the actual file diffs inline (what the agent wrote). Human can approve, reject, or edit. |
| **Rollback per-task** | "Undo this task" — reverts the agent's changes for that specific task (git stash/revert). |
| **Batch vs sequential** | Toggle: "Run all tasks in parallel" vs "Run sequentially, pause between" vs "Run sequentially, no pause" |

### 17.L — Drift Detection & Resolution

**Problem:** Agent modifies a file that isn't in the plan. Or skips a
file that IS in the plan. User needs to know.

**Features (backend exists, needs UI):**

| Feature | What it does |
|---------|--------------|
| **Drift alert banner** | When deviation-detector fires, show in workspace: "⚠ Agent touched src/unplanned.ts — not in your targets" |
| **Resolution workflow** | For each drift: Accept (add to plan retroactively), Revert (undo the change), Ignore (mark as acceptable) |
| **Missing work alert** | "Task 2 claims done but src/auth/refresh.ts was never modified" — flags incomplete execution |
| **Scope violation** | If guardrails say "only modify src/auth/" and agent touches src/api/ → immediate alert |

**Leverages:** deviation-service.ts already produces `Deviation[]`
with types, severity, and resolution states. Just needs UI.

**Current gap:** The backend broadcasts `deviation-detected` WS events
and the frontend shows a toast, but the PlanDiffPanel doesn't
auto-refresh on WS events — it requires manual refresh. This needs
fixing: the drift panel should be reactive, updating in real-time as
deviations are detected during execution.

**Fix:** Wire `useWebSocket` to call a `refreshDriftStatus()` action
on the plan-items-store when `deviation-detected` fires. The
PlanDiffPanel should subscribe to this store rather than fetching on
button-click.

**Cascade integration:** If a parent Page has a `scopePath` constraint
(17.F), drift detection should check ALL child tasks against that
scope — not just the individual task's fileSpecs. A child task
completing successfully but violating the parent's scope fence should
still flag drift.

---

## Part 5: After Execution

### 17.M — Completion Summary & Retrospective

**Problem:** All tasks are done. What actually happened? Was it right?

**Features:**

| Feature | What it does |
|---------|--------------|
| **Completion dashboard** | "4/4 tasks done. 14 files modified. 2 unexpected changes. 0 test failures." |
| **Before/after graph** | Side-by-side: graph at plan creation vs graph now. Shows structural changes. |
| **Plan → diff view** | For each task, show: what was planned (fileSpecs) vs what actually changed (git diff). Highlights gaps. |
| **Save as template** | "This plan worked well — save the structure as a reusable template." Strips content, keeps skeleton. |
| **Share plan** | Export as markdown doc or publish to team workspace (for recurring patterns). |

---

## Priority Matrix

| Priority | Sub-phase | Effort | Impact | Why |
|----------|-----------|--------|--------|-----|
| **P0** | 17.C Selection-driven planning | 2d | High | Core workflow — multi-select is how real plans start |
| **P0** | 17.D Symbol-aware expansion | 2d | High | Precision gap — agents need function-level targeting |
| **P0** | 17.H One-click handoff | 1d | High | Completes the loop — without this, last mile is manual |
| **P0** | 17.O Claim restrictions | 1.5d | High | Control — who works on what is fundamental |
| **P1** | 17.N Skill & plugin bindings | 2d | High | Ensures right agent gets right task |
| **P1** | 17.P Cascade & inheritance | 2d | High | Scalability — setting rules on 20 tasks individually is unworkable |
| **P1** | 17.F Constraints & guardrails | 2d | High | Safety — prevents agents from going off-rails |
| **P1** | 17.J Live execution dashboard | 2d | High | Visibility — user needs to see what's happening |
| **P1** | 17.K Approval gates | 1.5d | High | Control — humans need veto power |
| **P1** | 17.L Drift detection UI | 1d | Med-High | Backend exists, just needs frontend |
| **P2** | 17.A Codebase orientation | 2d | Medium | Understanding — helps new users |
| **P2** | 17.E Smart templates | 2d | Medium | Efficiency — speeds up repeat patterns |
| **P2** | 17.G Plan readiness score | 1d | Medium | Confidence — tells user when plan is "done" |
| **P2** | 17.I Import from external | 2d | Medium | Convenience — plans often start elsewhere |
| **P2** | 17.Q Execution configuration | 1.5d | Med-High | Precision — right model/settings per task, prevents waste |
| **P2** | 17.R External references | 2d | Medium | Context — agents get the "why" from issues/PRs automatically |
| **P3** | 17.B "What does this do?" | 1.5d | Medium | Requires connected agent for explanation |
| **P3** | 17.M Completion summary | 1.5d | Low-Med | Nice polish after execution |

---

## The 3-Minute Plan (target experience)

```
0:00  Open project. Graph loads. Architecture summary in sidebar.
0:15  See the module I want to change. Hover → impact preview shows dependents.
0:30  Shift+click to select the 4 files I want to change. Click "Plan these."
0:45  Workspace opens with a new task, all 4 files as targets.
1:00  Files auto-expand showing symbols. I check the 3 functions to modify.
1:15  Type description: "Add refresh token rotation to these auth functions."
1:30  Add constraint: "Don't change the public interface signatures."
1:45  Add test requirement: "Run src/__tests__/auth.test.ts after."
2:00  Readiness ring goes green. Click "Hand off to Claude Code."
2:15  Agent picks up the plan. Status flips to "in_progress."
2:30  Watch files being modified on the graph. Progress: 50%.
2:45  Task completes. Diff preview shows the changes. I click "Approve."
3:00  Plan complete. Summary: 4 files modified, tests pass, no drift.
```

---

## Technical Dependencies

| Feature | Depends on |
|---------|-----------|
| Multi-select | ReactFlow `selectionOnDrag` + `multiSelectionKeyCode` (built-in) |
| Symbol expansion | Existing `/api/symbols?file=<path>` endpoint |
| Blast radius | Existing diff-engine `computeDiff()` blast radius field |
| Cross-system overlay | Existing cross-system-service edges |
| Drift UI | Existing deviation-service `Deviation[]` + WS broadcast |
| One-click handoff | Existing agent session registry + `get_next_task()` MCP tool |
| Approval gates | New task field: `requiresApproval: boolean`. Agent checks after completion. |
| Live file stream | Existing Claude Code JSONL watcher + `file_changed` events |
| Git context | Existing plan fields: `baseRef`, `targetBranch`, `autoCreateBranch` |

Most features leverage data that already exists in the backend but
isn't surfaced in the UI.

---

## Non-Goals (Phase 18+)

- AI-generated plans (agent reads codebase and suggests changes)
- Multi-user collaboration (two humans editing same plan)
- CI/CD integration (trigger pipeline on plan completion)
- Plan versioning / branching (draft vs published)
- Cross-repo plans (changes spanning multiple repositories)
- Natural language plan creation ("just describe what you want and
  we'll figure out the rest") — this is the Phase 18 vision
