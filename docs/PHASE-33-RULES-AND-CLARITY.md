# Phase 33 — Rules and clarity

> The design. How it is run, step by step, is
> [PHASE-33-EXECUTION.md](PHASE-33-EXECUTION.md); where it stands is
> [PHASE-33-LOG.md](PHASE-33-LOG.md).

Phase 32 made CodeTrellis aware of parallel work. Phase 33 makes it the
**quality layer agents work inside**. The team writes its architecture
down once, as rules. Agents plan with the rules, check themselves against
them while they work, and CI enforces the ones that must hold. Changing
what is enforced is always a person's explicit act.

The same phase fixes what made the app hard to read and steer in 0.1.17
and 0.2.0. Those are the owner's reports, and they are cheap to fix.

## The three outcomes

1. **A rulebook.** The team can say, for any file, folder, package,
   exported name, URL or command, where it may and may not be used.
   - Each rule is strong enough to block CI, or quiet enough only to guide.
   - The rules live in files a pull request can review, not in settings.
   - Loosening a rule needs a person, every time.
2. **Checks that run anywhere, at any scope.** One rule, one suite, one
   path, or everything.
   - They run on a laptop or in any CI.
   - There are deterministic checks and agent checks. Agent checks use the
     team's own model endpoint and credentials, and are not tied to the
     repository host.
3. **An app that is easy to read and steer.**
   - It does not freeze when plans change on disk.
   - Every colour means one thing and has a legend.
   - The graph can be focused and filtered.
   - Selecting a file says which plans touch it.
   - Opening a plan shows the plan.

---

## 1. What is true today (0.2.0, `main` at `5fb23f4`)

Each fact below was read from the code on 2026-10-05.

### 1.1 Plans changing on disk freeze the app

The owner saw "Plan reloaded from disk" fire so many times that the Mac
froze (0.1.17). Nothing since has changed the path.

- **Backend.** The plan watcher calls `importPlan(planDir)` once **per
  changed file**, and broadcasts `plan-imported` each time
  (`plan-file-service.ts`, `handle`, about line 1222).
  - A whole-plan import is synchronous, on the backend's only thread.
  - Our own writes are skipped (`wasJustWrittenByUs`).
  - Writes going out are batched, at 200 ms per plan. Changes coming in
    are not.
- **Window.** Each `plan-imported` does three things (`useWebSocket.ts:194`):
  - refetches the plan list;
  - refetches the open plan;
  - shows a "Plan reloaded from disk" toast.
- **Result.** A pull or branch switch that touches 40 task files costs 40
  whole-plan imports, 80 fetches and 40 toasts. So does another device's
  shared task state, or an agent editing YAML.
- **Not this path.** The fixes since 0.1.17 are #329 (awareness refreshes
  one at a time), #333 (watcher descriptors) and #335 (native macOS
  watching). None of them touches this path.

### 1.2 Rules

- **Kept in the committed `.codetrellis/config.json`**, beside unrelated
  settings (`project-config-service.ts`, `architecture-rules.ts`).
- **One kind only.** A path boundary: `from` may not import `mayNotImport`,
  `except` …
- **Outside packages are dropped by every resolver.** For example,
  `resolvers/typescript.ts` step 3: "External package → skip". So "only the
  wrapper imports `stripe`" cannot be said.
- **The names an import brings in are stored** (`imports.specifiers`,
  `database.ts:386`) but no rule reads them.
- **Setting a rule is person-only, but only at the HTTP route.** It is
  enforced by `mayGrant` (`server.ts:2740`), and nothing guards the file.
- **The gate cannot catch a weakened rule:**
  - it ignores every change under `.codetrellis/` (`cli/conformity.ts:50`);
  - it reads the rules from the branch it is judging.

  **So a pull request can delete or loosen a rule and add the breach, and
  `codetrellis check` passes.**
- **Rules render only in Settings** (`ArchitectureRulesSection.tsx`, 145
  lines):
  - a list of rules;
  - an amber count of breaches;
  - a form;
  - a Stop button.

  Nothing draws a rule or a breach on the graph.
- **There is no strength.** Every rule blocks CI, or none does.
- **There is no way to check one rule, one group of rules, or one folder.**

### 1.3 The graph

- **Nothing hides import edges.**
  - The overlays (`graph-overlays.ts:15`) all decorate nodes.
  - Selection only fades the other edges (`MainCanvas.tsx:977-984`,
    opacity 0.18).
- **Edges have eight states** (`ImportEdge.tsx:15-76`), each a colour and a
  dash pattern. None is explained anywhere.
- **`cross_system` falls through to the default style.** It is set at
  `graph-builder.ts:1106`, but is not in the edge's union.
- **There is no full screen or focus mode.**
- **Hiding a side panel leaves its empty pane behind.** The sidebar and
  inspector return `null`, but their Allotment panes have no `visible`
  prop (`App.tsx:278`, `:302`).
- **No shortcut toggles the inspector.**
- **The same colour means different things in different places:**

  | Colour | Means, in different places |
  |---|---|
  | Green | function symbol, added, planned add, "planned" mode, passing test, "aligned" |
  | Violet | interface, planned (sidebar), planned overlap |
  | Fuchsia | unplanned, unexpected live, diff mode |
  | Red / rose | removed, collision, diverged, drift edge |

  - The graph has no legend.
  - Three small legends exist, each written separately:
    - plan canvas;
    - codebase orientation;
    - the file tree, which is the best one: it lists only states on screen,
      with glyphs.

### 1.4 Selecting a file, and opening plans

- **The plan item count for a file hides behind "View source".** The
  inspector's FileView fetches every plan's overlay for the file
  (`InspectorPanel.tsx:248`), but the count only shows inside the source
  view (`:344-348`). No list of the plans and tasks that touch the file is
  visible on selection.
- **Minimising a plan.** Esc or the header button (`PlanWorkspaceShellV2.tsx`)
  turns the plan into a chip (`MinimizedPlanChip.tsx`).
- **Opening is decided by whether the plan changed** (`App.tsx:110-129`).
  So **opening the plan that is already active leaves it minimised**,
  unless the caller also restores it. These callers do not:

  | Caller | Where |
  |---|---|
  | Pinned Open | `PlanListView.tsx:520` |
  | The Stack | `StackTab.tsx:213` |
  | Recurring | `RecurringSeriesList.tsx:35`, `RecurringDue.tsx:32` |
  | Other worktrees | `OtherWorktreesSection.tsx:47` |
  | Connected agents | `ConnectedAgents.tsx:230` |
  | The plan switcher | `PlanSwitcher.tsx:137` |
  | MCP `select_item` | `useWebSocket.ts:629` |

### 1.5 Review in CI

- `.github/workflows/claude-review.yml` runs Claude Code on pull requests,
  using the repo's own skill.
- It is advisory on purpose: "The review discovers rules; it does not
  enforce them."
- It runs on GitHub with an Anthropic credential only.

---

## 2. Principles

1. **Changing enforcement is explicit, and a person's.** Not a side effect
   of a settings save, an agent's edit or a merge.
   - An agent may **propose** a rule. Only a person makes one bind.
   - **Loosening** always needs a person: removing a rule, lowering its
     strength, narrowing its scope, or widening its exceptions.
   - The change is shown with its effect before it is confirmed, and kept
     in the record.
2. **Rules are files.** They are reviewable in a pull request, ownable by
   CODEOWNERS, and grouped into suites by file. The database keeps an
   index and the breaches, never the only copy.
3. **One rulebook, five moments.** The same rule appears:
   - when a task is planned (the brief);
   - before an edit (`check_conformity`);
   - while an agent works (the awareness `rule` signal);
   - in CI (`codetrellis check`);
   - in review (agent checks).
4. **Deterministic checks enforce; agent checks discover.** A finding that
   agent checks repeat becomes a proposed rule, and a person promotes it.
5. **Checks run at any scope, anywhere.** The same command and the same
   answer, on a laptop and in any CI.
6. **Every colour means one thing, and says so.** Glyph and word as well as
   colour. A legend shows what is on screen. (Phase 32's UX rules, §1.6 of
   its EXECUTION, still hold.)
7. **Quiet under load.** A burst of changes is one reload and one notice,
   never one per file.

---

## 3. The rulebook

### 3.1 Where rules live

One YAML file per **suite** under `.codetrellis/rules/`. For example,
`.codetrellis/rules/payments.yaml`:

```yaml
# Suite: payments. Who owns it is CODEOWNERS' business; what binds is this file.
suite: payments
because: Money moves through one place, so retries and idempotency are never forgotten.
rules:
  - id: stripe-via-wrapper
    kind: package
    package: npm:stripe
    only: [src/payments/index.ts]
    strength: block
    because: The wrapper sets idempotency keys and retries.

  - id: charge-from-checkout-only
    kind: symbol
    symbol: src/payments/index.ts#createCharge
    only: [src/checkout/]
    strength: warn
    because: Charges start at checkout; refunds use refundCharge.

  - id: no-direct-stripe-http
    kind: calls
    target: https://api.stripe.com
    only: [src/payments/]
    strength: block
    because: Going around the SDK skips the wrapper.

  - id: services-are-services
    kind: folder
    folder: src/backend/services/
    files: "*-service.ts"
    strength: warn
    guide: One service per file, named for its domain; pure helpers go in lib/.
```

**Why files, not `config.json` or the database** (the owner's direction,
2026-10-05):

- Files are reviewed in the pull request that changes them.
- CODEOWNERS can name who must approve a suite.
- Suites fall out of the folder.
- YAML takes comments.

SQLite keeps an index of rules and their breaches, rebuilt from the files.

**Migration.**
- When rules are found in `config.json`, the app offers to move them into
  `.codetrellis/rules/architecture.yaml`. A person confirms; the move is
  not silent.
- Until that confirm, the old rules keep working.

### 3.2 A rule

| Field | Meaning |
|---|---|
| `id` | A slug, unique in the project |
| `kind` | `imports` (today's rules, the default), `package`, `symbol`, `calls`, `folder`, `guide` |
| `scope` / `only` / `except` | Where it applies, who alone may, and the doors through it. Patterns as today (`inPattern`) |
| `strength` | `block`: fails CI (exit 3) and raises a high signal. `warn`: annotates; CI passes. `guide`: shown to agents whose work touches the scope; nothing is checked |
| `because` | One sentence. Printed with every breach, and read by agents |
| `guide` | Optional prose for the judgement half of a folder rule |

**New rules start at `warn`.** A blocking rule with false positives costs
more trust than it earns.

### 3.3 What each kind checks

Each kind is one module: a pure function from a rule and the project graph
to a list of breaches. If a convention cannot be written that way, it is a
`guide`. There is no rule language.

| Kind | Example | Reads | New work |
|---|---|---|---|
| `imports` | `src/frontend/` may not import `src/backend/` | Import edges | none |
| `package` | Only the wrapper imports `stripe` | Import edges with outside packages kept as `npm:`, `pypi:`, `go:`, `cargo:`, `maven:`, `nuget:`, `gem:`, `composer:` entries | Keep outside imports at the point imports are collected, for all eleven languages |
| `symbol` | Only `src/checkout/` may import `createCharge` | `imports.specifiers` | A reader over stored specifiers. Re-exports followed (A2.2 resolved them) |
| `calls` | Only `src/payments/` may call `api.stripe.com` or run `stripe` | Callsite extractors: HTTP, SQL table, subprocess, env | A matcher over callsites (`callsites/shared.ts` normalisation) |
| `folder` | Files in `services/` are `*-service.ts` | File list and symbols | Name and export checks |
| `guide` | "Agent-activity UI goes in `AgentTurns.tsx`" | Nothing | Shown in briefs and `get_brief` |

**What a rule cannot say yet.** A call inside one file to a function in
the same file, because there is no call graph. `symbol` covers every use
across files, which is where boundaries are.

---

## 4. Change control

### 4.1 In CI: a pull request cannot change the rules that judge it

- `codetrellis check` reads the rulebook **from the merge base**
  (`git show <base>:.codetrellis/rules/`), not from the branch. This is the
  same idea as `claude-code-action` refusing to run a modified workflow.
- It also compares the two rulebooks, and reports the change as its own
  finding.

| Change | Example | Finding |
|---|---|---|
| Loosen | A rule removed, strength lowered, `only` or `except` widened, scope narrowed | ✗ "This PR loosens `stripe-via-wrapper`: 3 imports it forbade become allowed." Blocks unless the change carries a person's approval (4.3) |
| Tighten | A rule added, strength raised | ⚠ "This PR adds `no-direct-stripe-http` at warn; 2 existing calls would breach it." Reported, never blocks |
| Neutral | `because` reworded, comments | Listed |

### 4.2 In the app: propose, see the effect, confirm

- Rules are made and changed in the **Rules view** (5.6), never Settings.
- Every change first shows its effect against the current code:
  - what becomes forbidden;
  - what becomes allowed;
  - which files breach it today.

  Only then is it confirmed.
- Agents use a new MCP tool, `propose_rule`, which needs a matrix entry
  and tests.
  - A proposal is an inbox item with the same preview.
  - Agents never write the rule files through CodeTrellis.
  - If an agent edits the files directly, 4.1 catches it.
- Confirmed changes are written to the suite file and kept in the record
  (B10's chain), with who, when, and the effect.

### 4.3 A person's approval travels with the change

- A confirmed loosening is **signed with the person's device key** (the C3
  key that already signs task records and packs), in its own namespace:
  `codetrellis-rule-change`.
- The signature covers the old and new rule and the base commit, and is
  written beside the suite.
- CI verifies it **against the keys on the base branch**. A pull request
  cannot add a key and use it in the same change.
- A loosening with no valid signature blocks. A code owner can still merge
  through the host's own override, which leaves its own trail.

---

## 5. Checks anywhere

### 5.1 Scope

```
codetrellis check                          # everything, as today
codetrellis check --suite payments         # one suite
codetrellis check --rule stripe-via-wrapper
codetrellis check --path src/payments/     # rules whose scope touches the path
codetrellis check --strict                 # warn counts as block
```

`check_changes` and `check_conformity` take the same scope.

### 5.2 Output each host shows

- **`--format sarif`** (SARIF 2.1.0). GitHub code scanning, GitLab and
  Azure DevOps take it, and show breaches on the changed lines.
- **`text` and `json` as today.**
- **Recipes** for GitLab CI, Azure Pipelines, Bitbucket Pipelines and
  Jenkins, beside `docs/recipes/github-actions.yml`.
- **Open question.** GitHub code scanning on a private repository appears
  to need a paid licence. The fallback there is review comments through
  the Checks API.

### 5.3 Debt

- Existing breaches are recorded per rule, and the count may only fall.
- New breaches fail.
- This repository already works this way with
  `tools/inventory/untested.json`.

### 5.4 Agent checks, locally and in CI

`codetrellis review` runs an agent with the team's skills (SKILL.md, the
open standard) over a change. The team supplies the endpoint, the model and
a credential:

- an Anthropic key;
- an OpenAI-compatible URL, including vLLM, Ollama and LiteLLM gateways;
- Bedrock, Vertex or Azure through OIDC.

**What the agent gets:**
- the diff;
- the rules in scope, at every strength;
- the gate's own results, so it does not repeat them;
- the claimed task and its criteria;
- the system docs covering the changed files.

That context is the difference from host- and model-neutral reviewers,
which already exist (PR-Agent).

**The same command runs on a laptop.** It uses the person's own model or
login, at the same scopes as `check`: `--suite`, `--rule`, `--path`.

**Safe by construction.** In April 2026, review agents in CI from three
vendors leaked their keys through text in a pull request (the "Comment and
Control" disclosures).

- **The reviewing agent gets no shell and no network.** It has read-only
  file tools inside the checkout, and returns findings as data.
- **Plain runner code posts the results**, with a host token the model
  never sees.
- **Pull request text is data,** in a marked block with no instruction
  authority.
- **No `pull_request_target`.** Fork pull requests are reviewed only after
  a maintainer's label, as `claude-review.yml` does now.
- **Every run is recorded:** the model, the endpoint, and a hash of each
  skill.
- **Advisory by default.** Exit 0.

### 5.5 Graduation

- When agent checks raise the same kind of finding twice, they propose a
  rule at `guide` strength, with its scope and reason filled in.
- It goes through 4.2 like any proposal.

### 5.6 Where rules are seen

- **A Rules view**, its own workspace beside graph, plan, docs and code:
  - suites, each with its status, breaches and debt count;
  - each rule with its `because`;
  - proposals waiting on a person;
  - the history of changes.
- **On the graph:**
  - a Rules overlay draws a breaching edge in the breach style;
  - a selected file lists the rules that cover it;
  - "show this suite" fades everything else.
- **Settings keeps only on/off switches.**

---

## 6. Clarity

### 6.1 Quiet under load (Track S)

- **The backend batches.** The watcher collects changed files per plan
  directory and imports once after a quiet moment. One `plan-imported` per
  plan carries the number of files.
- **The window batches.** One refetch per burst, and at most one toast:
  "Plan reloaded from disk (40 files)".
- **A harness test proves it.** Changing 200 task files at once yields
  imports bounded by the plans touched, not the files, and the backend
  answers a request within its usual time meanwhile.

### 6.2 One visual vocabulary, and a legend (G1, G2)

- **One module names every state the app draws.** For each state it gives
  a colour token, a glyph, a dash pattern (for edges) and its words.
  - Nodes, edges, overlays, the file tree, the plan canvas and the Timeline
    read from it.
  - Each colour family means one thing:
    - green and red for change;
    - dashes for planned;
    - one hue for drift;
    - the test glyphs for health;
    - one hue for rule breaches;
    - muted colours plus icons for symbol kinds.
- **One legend component, built from that module.**
  - It shows only what is on screen.
  - It is collapsible, in a corner of the graph, and the same component
    serves the plan canvas, the file tree and the Timeline.
  - Hovering an entry highlights the matching nodes and edges.
- **A guard test.** Graph components may only use colours from the
  vocabulary, like `reachable.test.ts`.

### 6.3 The graph (G3, G4)

- **Toggles for import edges, cross-system edges and symbol links,**
  beside Overlays. Remembered per machine. Off means not drawn, not faded.
  `cross_system` gets its own style.
- **Full screen and back.** A button on the canvas toolbar and a shortcut
  hide the sidebar, the inspector and the plan panel, and restore them as
  they were. The empty-pane gap is fixed by giving every pane a `visible`
  prop. An inspector shortcut is added.

### 6.4 Selecting a card says which plans touch it (G5)

- **On selection, the inspector lists the plans and tasks that touch the
  file:**
  - grouped by plan;
  - each task with its status glyph and who holds it;
  - each one click from opening.
- **Directories and clusters show counts.**
- **The plan item count no longer waits for "View source".**
- **The data is already fetched** (`/api/file/overlay`, every plan).

### 6.5 Opening a plan shows it (G6)

- One helper, `showPlan(uid, { item? })`, sets the active plan and restores
  the workspace from a chip.
- Every caller in 1.4 uses it. The Brief keeps its deliberate exception.
- A test enumerates the callers, so a new one cannot regress.

---

## 7. Not in this phase

- A call graph inside files.
- Host adapters for agent-check comments beyond GitHub first. SARIF covers
  the rest until then.
- Packaging and price of agent checks.

## 8. Open questions for the owner

1. **Rule files.** YAML under `.codetrellis/rules/` as the source, with
   SQLite as an index (3.1). Confirm, or keep the database as the source
   with an export.
2. **Approval.** Is the device-key signature (4.3) the way a person's
   approval travels, or is CODEOWNERS enough?
3. **Agent checks.** Part of the open CLI, or a paid tier?
4. **CI hosts after GitHub.** GitLab or Azure DevOps first?
5. **Naming.** "Agent checks" for the AI side, beside "checks" for the
   deterministic side?
