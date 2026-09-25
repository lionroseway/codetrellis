# Phase 31 — Evidence and sign-off

> Drafted: 2026-09-23
> Status: **designed.** 31.A (the connector) is in #66; nothing else is built.
> Revised 2026-09-23: §8 (loops) and §9 (references) added after the
> analysts' follow-up — checking has to be something they can run again,
> and "task 9f2c41ab isn't right" has to be something they can say.
> Written against `main` at `a9d09f6` (#64, the review loop, merged).
> Depends on: [Phase 24](PHASE-24-SDLC-INTAKE.md) §C, which this
> **supersedes** — criteria stop being markdown; [Phase 25](PHASE-25-REVIEW-AND-PLAYBACK.md)
> and #64 for the verdict vocabulary and the code ↔ item trace; Phase 30
> for the capability matrix every new tool lands in; [Phase 29](PHASE-29-SURFACING-WHAT-WE-COLLECT.md)
> §3 for the UX rules, which apply here unchanged.

---

## 1. Why this phase exists

A team of business analysts asked to use CodeTrellis to ground the
reports they produce with Claude: put the task list, the guide and the
source material somewhere Claude has to work from, and be able to show
afterwards that it did. They use **Claude Desktop**, and their material is
Excel, Word, PDF, images, the occasional HTML export and video.

That request is the product's own promise pointed somewhere new. The
README says CodeTrellis "proves what actually landed". Checking what that
means today:

- **Proof exists for code only.** `plan-changes-service` decides a change
  is satisfied by asking whether a file changed, a symbol exists, an
  import edge is present. For anything else, "done" means somebody set a
  status.
- **Nothing gates `done`.** `update_item(status: 'done')` over MCP and
  `PUT /api/items/:uid` from the UI both set it. No evidence is asked for.
- **Acceptance criteria are prose nobody reads.** Phase 24 §C appends them
  to the item body as a `- [ ]` checklist and notes that
  `plan-changes-service` "can read them". It cannot. No code anywhere
  parses those lines, the renderer shows the boxes read-only, and Phase 24's
  own test 3 ("appear in the changes projection") was never written.
- **Approval is a boolean that approving destroys.** `approve_gate` clears
  a gate by setting `requiresApproval = false`. After that there is no
  record of *what* was approved, by whom, against which version — so there
  is nothing to notice going stale. Its description says "Human-only";
  any agent holding `write` can call it.

Every one of those is as true for a developer as for an analyst. A
developer's "tests pass" is a claim with nothing attached; a screenshot
proving a UI change is taken and thrown away; a gate the reviewer meant to
hold can be cleared by the agent it was holding.

So this phase is not "a BA feature". It is **one loop — criteria →
evidence → verdict → sign-off — built once and read two ways**: the
developer surface gains what it was missing, and a second surface, the
**Brief**, presents the same records in words an analyst uses.

## 2. The principles

### We verify provenance. A person verifies judgement.

We can check that a file exists, that it changed after the task started,
what its hash was when someone signed it off, which materials the agent
declared it used, and whether it read them through us. **We cannot check
that an analysis is right**, and the interface never implies we did.

Phase 29 §3 says never imply a defect we cannot substantiate. The mirror
rule binds here: **never imply a correctness we cannot substantiate.** A
criterion Claude approved itself says so, in words, forever — on screen,
in the sign-off pack, and in the PR draft.

### The agent may not close its own work unless a person said it could

Every criterion carries a policy the *human* set. The agent can submit
evidence against any criterion; whether that submission is the end of the
matter is not the agent's call. No MCP tool records a human decision
(§4.3), because nothing on an MCP connection can prove a human made it.

### A screenshot that cannot say what it is a picture of is not evidence

That sentence is from `scripts/demo.ts`, where #64 made `shot()` refuse to
save a capture that does not show the file and verdict its caption
claims. It is the whole of this phase in one line: evidence is an artefact
**plus** a claim about it that we can check. An xlsx on its own proves
nothing; "`Q3-summary.docx` says EMEA rose 12%, citing
`Q3-sales.xlsx` Regional!C14, hash `9f2c…` at the time you approved it"
proves something.

### Checking is something you run, not a moment

A sign-off is true when it is given. The workbook it rests on changes on
Tuesday; Claude's second attempt lands on Wednesday; the weekly report is
due again on Monday. Every check here is therefore a **loop** — run by the
agent before it claims, by the person when they verify, and by the app
whenever the ground moves — and every run leaves a record (§8).

### Files stay where they are

We record, hash, display and watch artefacts. We do not store, version,
edit or sync them. The viewer is read-only; editing happens in Excel or
Word. The moment we are copying documents into our own store we are
building a document-management system, and that is a different product.

## 3. What already exists — and how the two surfaces trade it

Most of this phase is assembly. The table is the point of the section:
each row is one primitive with a developer reading and an analyst reading,
and the design keeps them **one primitive** rather than two parallel
features that drift.

| Primitive (where it lives) | Developer reads it as | Analyst reads it as | This phase |
|---|---|---|---|
| Action items, `PlanItemTree` | Tasks | **Tasks** | reused as is |
| Object items (`PlanItemKind` `object`, `read_item_full`) | Spec docs, overview pages | **The guide** | reused; the Brief shows the plan's Object items as the guide |
| Attachments (`attachments`, `ContextRail` `AttachmentRow`) | Screenshots, links, code blocks | **Materials** and **outputs** | extended with a role and a hash (§4.2) |
| `fileSpecs` | "This item changes these files" | "This task produces `Q3-summary.docx`" | reused — a `file add` spec is already "this file will exist" |
| `plan-changes-service` satisfaction | Change landed | Output exists / changed | extended to non-code files (§4.4) |
| Verdicts: `aligned · drifted · outstanding` (`line-verdict.ts`), `landed · partial · untouched` (`plan-review-service`) | Did the code do what the plan said | Did the task produce what the brief asked | **same words internally**; the Brief maps labels (§10.3) |
| `deviation-service` `unexpected_file` | Changed, and no item claimed it | "A workbook changed that no task mentions" | works once the watcher sees documents (§4.4) |
| Freeze (`freeze-service`, `FreezeBar`) | Code freeze | Period-end close | reused as is |
| Checkpoints / baselines (`snapshot-compare-service`) | Compare two points in the code | The evidence set as it was at sign-off | sign-off records the hashes directly (§4.3) |
| System-doc freshness (`getFreshness`) | Doc is stale: its referenced files moved since the doc was verified | Sign-off is stale: its evidence changed since approval | same *shape* — references → watcher → verdict → one event — with a hash in place of a commit (§4.4) |
| `requiresApproval` + `approve_gate` (17.K) | Gate before the next sibling | Needs your sign-off | **replaced** by criterion policies (§4.3) |
| Comment types `approval` / `concern` | Review comments | **Approve** / **Send back** notes | reused as the human-readable half of a sign-off |
| Channel `need-decision` / `steer` | Agent asks / human steers | "Waiting for you" / "Sent back" | reused; pushes to the phone already |
| Budget sweep (`budget-service` notify-once) | Ceiling warning at 80% | — | its *pattern* is how pending and stale sign-offs notify (§12) |
| Templates + `publish_plan_as_template` | Plan templates | **Playbooks** ("how we do a quarterly report") | reused; one new built-in (§14) |
| Intake (`create_plan_from_external`, `acceptance[]`) | Ticket → plan | Brief from a pasted list | criteria land as rows, not markdown (§4.1) |
| `get_pr_draft` / `renderReviewMarkdown` | PR description | **Sign-off pack** | one renderer, two outputs (§13) |
| `tool-phrasing.ts`, `AgentTurnList` | Timeline | "What Claude is doing" | reused with a second phrase table (§10.5) |
| `open-file-at.ts` (#64) | Code → item → back to the line | Report → cited source → back | generalised to artefacts with a locator (§7.5) |
| `demo.ts` `shot(label, expectFile, expectVerdict)` | Screenshot must show what it claims | — | the model for evidence checks, and for the Brief demo journey (§16) |
| `ui_ready` `openFile` (`data-code-file`) | "Which file is the window showing" | "Which artefact is the viewer showing" | viewer sets its own attribute (§7) |
| Pantry (`pantry-resolution-service`, `PantryPlaceholder`) | Team-only attachment not on this machine | Material that lives on someone else's drive | reused for artefacts that do not resolve locally |
| `ProjectConfig.repoRole` (`planning · code · mixed`) | What kind of repo this is | — | a sibling setting picks the default surface (§10.1) |

Two rows are worth pulling out because they cross in *both* directions:

- **Analyst → developer.** A Brief's criteria are exactly the acceptance
  criteria a developer plan needs when a report becomes a feature request.
  Copied with lineage (§11), the analyst who wrote them can sign off the
  delivered feature from a screenshot or recording in their own Brief —
  without reading code and without a meeting.
- **Developer → analyst.** Drift, freeze, templates, intake and budgets
  have no reason to be code-only. "A workbook changed that no task claims"
  is `unexpected_file` with a different extension.

## 4. The model

### 4.1 Criteria become rows **[supersedes Phase 24 §C]**

Phase 24 chose markdown because items had no acceptance field and it did
not want to add one. That was the right call for intake and the wrong one
for verification: a line of prose has no state, no owner and no evidence.

New table `item_criteria`:

| Column | Meaning |
|---|---|
| `uid`, `item_uid`, `sort_order` | |
| `text` | **Verbatim.** Phase 24's rule survives: the requester's wording is the list they will check against, and a helpfully-reworded criterion is one nobody agreed to. |
| `kind` | `manual` · `artefact` · `citation` · `code` · `test` — what evidence satisfies it |
| `policy` | `agent` · `propose` · `human` — who may mark it met (§4.3) |
| `state` | `open` · `submitted` · `met` · `sent_back` · `stale` — **derived**, cached for listing |
| `author`, `author_type`, `created_at` | who wrote the criterion |
| `origin_uid` | the criterion this was copied from, across plans (§11) |

Kinds, and what each checks mechanically:

| Kind | Evidence | What we check | Sensible default policy |
|---|---|---|---|
| `code` | The item's `fileSpecs` / `symbolSpecs` | Existing satisfaction rules — this is `plan-changes-service` unchanged | `agent` — a machine checked it |
| `artefact` | One or more recorded outputs | Exists inside the project, changed after the item started, hash recorded | `propose` |
| `citation` | Outputs plus locators into materials | Every cited material is one of the plan's materials; optionally, it was read through `read_material` in this item's window (§5) | `propose` |
| `test` | A report artefact (JUnit XML, a Playwright HTML report) | Exists and is newer than the last change to the item's targets; JUnit counts parsed when present | `propose` |
| `manual` | Whatever the person wants to look at | Nothing — a judgement | **forced** to `human` |

**Migration.** A one-time, idempotent pass reads every item body's
`## Acceptance criteria` section (the form `acceptanceSection()` writes, and
the form `plan-migrate-service` folded legacy phase criteria into) and
creates rows of kind `manual`, policy `propose`. The body is left
untouched — rewriting prose a person wrote is not ours to do — and the
item records that it migrated so the pass never runs twice. Intake
(`create_plan_from_external`'s `acceptance[]`) writes rows directly from
now on.

**`requiresApproval` keeps working** as a shorthand: a template or plan
file that sets it gets one `manual`/`human` criterion, "Reviewed and
approved", and the existing gate in `getNextItem` reads "has unmet
`human` criteria" instead of the boolean.

### 4.2 Artefacts are attachments with a role and a hash

Not a new table. Attachments already round-trip through `plan.yaml`
(`serializeItem` writes them), already render in `ContextRail`, already
resolve through the pantry. They gain:

| Column | Meaning |
|---|---|
| `role` | `material` (input) · `output` (produced by the work) · `evidence` (captured to prove something — a screenshot, a recording) · `null` for existing rows |
| `sha256`, `size`, `mtime` | taken when recorded, re-taken on every read |
| `recorded_by`, `recorded_by_type` | who said this file matters |

Rules that make a recorded path safe to show:

- **A `file_ref` value is project-relative, and resolves only inside the
  project that owns the item** — never the data directory, never `$HOME`.
  The owning project comes from the item's plan, resolved through
  `resolveTrustedProjectRoot`; never from the request.
- **Links are refused** when recording and again when reading, through
  `confined-fs` — not a lexical check.
- **The type comes from an extension allowlist** (§7.2), never from a
  caller or a stored `content_type`.
- **An imported plan file is untrusted input.** Every attachment in a
  `plan.yaml` is validated exactly as if an agent had submitted it over
  MCP — kind, type and path confinement — and an import never updates an
  attachment belonging to another item.

Byte uploads stay what they are (images and video, 25 MB) because they are
for things that only exist in the moment — a screenshot. Everything else
is a pointer to a file that already exists in the project.

Evidence is linked through `criterion_evidence`:

| Column | Meaning |
|---|---|
| `criterion_uid`, `attachment_uid` | |
| `locator` | where in the file: `{page}`, `{sheet, range}`, `{t}`, `{lines}`, `{text}` (§7.5) |
| `note` | the claim, in the submitter's words |
| `sha256_at_submit` | what the file was when it was offered as evidence |
| `submitted_by`, `submitted_by_type`, `submitted_at` | |

### 4.3 Sign-off is a record, not a flag

New append-only table `criterion_signoffs`:

| Column | Meaning |
|---|---|
| `uid`, `criterion_uid` | |
| `decision` | `approved` · `sent_back` |
| `actor`, `actor_type` | `human` or the agent's type |
| `channel` | `desktop` · `phone` · `mcp` |
| `note` | shown to the agent on its next `get_brief` when sent back |
| `evidence_hashes` | `{attachment_uid: sha256}` for every piece of evidence **and every cited material**, at the moment of decision |
| `created_at` | |

A criterion's state is derived: the latest sign-off, checked against the
current hash of everything in its `evidence_hashes`. If any differs, the
state is **`stale`** — never silently still `met`.

**Who can write a sign-off, by policy:**

| Policy | Agent `submit_criterion` | Human on desktop | Human on phone |
|---|---|---|---|
| `agent` | → `met`, `actor_type` = agent | can override either way | can override either way |
| `propose` | → `submitted` ("Waiting for you") | approve / send back | approve / send back |
| `human` | → `submitted` | approve / send back | approve / send back |

The rule that holds it together: **no MCP tool can produce a sign-off with
`actor_type: 'human'`.** MCP attribution is `authorType: 'mcp'` by
construction (`authorFromExtra`), and nothing on the connection can prove
a person pressed anything. Human decisions arrive by exactly two routes:
the desktop UI (REST/IPC, stamped `human` the way `PUT /api/items/:uid`
already is) and a paired phone (peer identity from DTLS, per the Phase 19
rule). This is enforced structurally, not by convention: the sign-off
service takes a `HumanDecision` value that only the REST layer and the
peer RPC layer can construct, and a static test in the style of
`server-confinement.test.ts` fails if anything under `mcp/` imports its
constructor.

Policy is changed from the UI only. An agent can add a criterion — intake
arrives through an agent, and forbidding that would break Phase 24 — but
an agent-authored criterion starts at `propose` and an agent cannot
weaken the policy on any criterion.

**`approve_gate`** stays registered for one release and refuses with an
explanation ("sign-off happens in CodeTrellis or on your phone; use
`submit_criterion` to offer evidence"), so an agent that learned the old
tool gets a direction rather than a missing-tool error. Its
`tool-phrasing` entry is corrected at the same time — it currently reads
"Requested approval for …" from `gate`/`name` arguments the tool does not
take.

### 4.4 Change tracking has to see documents

Today the product cannot notice a spreadsheet changing:

- `file-watcher.ts` returns early on `change` and `add` for anything not
  in `PARSEABLE_EXTS`, so `.xlsx`, `.docx`, `.pdf` never reach
  `checkFileDeviation`, progress, or doc freshness.
- `project-scanner` keeps only extensions in `LANG_MAP`, so those files
  are missing from the file tree, the anchor picker and the `files` table
  that satisfaction reads.
- Snapshots are built from the indexed `files` table, so a folder of
  documents snapshots as empty.

Two changes, deliberately narrow:

1. **The scanner lists document files without parsing them.** A
   `DOCUMENT_EXTS` set (the viewer allowlist, §7.2) is walked and recorded
   in the file tree and the `files` table with a content hash and no
   symbols. Satisfaction's `file add` / `file modify` rules then work for
   an output named in `fileSpecs` with no other change. The graph does not
   gain nodes for them; the graph was never the place for a PDF.
2. **An artefact watcher watches exactly the recorded artefacts** — a
   second, small chokidar instance over the paths in `attachments` with
   a role, not the tree. On change it streams a sha256 (the pattern in
   `update-download-service`; there is no shared helper today, so this
   phase adds `lib/sha256-file.ts`), and if any sign-off's
   `evidence_hashes` no longer match, it marks the criterion `stale` and
   posts **one** `need-decision` event, deduped exactly as the budget
   sweep and `checkDocFreshnessForFile` dedupe.

The watcher is for promptness, not correctness. Files change while the
app is closed, so **the authoritative check is at read time**: every
`get_brief`, every viewer open, every sign-off pack re-hashes what it
shows.

The same engine is the natural replacement for system-doc freshness in a
folder with no git — `verifySystemDoc` does nothing without a HEAD today —
but that is a follow-up, not this phase.

## 5. The agent contract

One read that answers "what am I doing and how will it be judged", one
way to read material that leaves a trail, one way to say "this file
matters", one way to offer evidence. Every tool gets a `TOOL_CAPABILITIES`
entry — the coverage test refuses the server otherwise.

| Tool | Capability | Does |
|---|---|---|
| `get_brief(item_uid)` | `read` | The item's goal and body; the guide (the plan's Object items, in order); materials with name, type, size, whether viewable; each criterion with kind, policy, state and what evidence it still needs; every send-back note since the agent last submitted. **One call**, because a Claude Desktop agent otherwise spends six turns assembling this and loses half of it. |
| `list_materials(plan_uid)` | `read` | Materials across the plan, for the agent that is orienting. |
| `read_material(attachment_uid, locator?)` | `files` | Returns the material's content as text the agent can use: CSV per sheet for xlsx, markdown for docx, text per page for PDF, the image itself for images. Logged against the item. (§5.1) |
| `record_artefact(item_uid, path, role, note?)` | `write` | Records a file inside the item's project as a material, output or evidence; hashes it. Refuses links, paths outside the project, and types off the allowlist. |
| `submit_criterion(criterion_uid, evidence[], note)` | `write` | Offers evidence — each entry an artefact uid plus an optional locator. Refused if a mechanical check fails (§8.1); otherwise the result depends on policy (§4.3). |
| `add_criterion(item_uid, text, kind)` | `write` | Starts at `propose`; §4.3. |
| `check_criterion(criterion_uid)` | `read` | Runs the criterion's mechanical checks and says what failed (§8.1). |
| `get_worklist(plan_uid)` | `read` | Everything the agent owes: sent back (note, anchor, reference), stale, unmet (§8.2). |
| `run_checks(plan_uid)` | `read` | A check run over the whole plan; recorded (§8.3). |
| `resolve_reference(ref)` | `read` | "What is `task 9f2c41ab`?" — kind, plan, state, latest notes (§9). |
| `save_screenshot_as_evidence(item_uid, caption, expect?)` | `capture` | Persists what `screenshot` today returns and discards, through `writeFileWithin`, as a `role: evidence` attachment. With `expect`, it is refused unless `ui_ready` reports the window showing what the caption claims — `shot()`'s check, made a product feature. `capture` stays off by default. |

And two existing tools gain targets:

- `navigate_to` gains `brief` and `artefact` (with `attachment_uid` and
  `locator`), so an agent that says "look at the figure I cited" can put
  it on screen. Both the tool enum and the window handler in
  `useWebSocket.ts` change together.
- `ui_ready` reports the artefact the viewer is showing, from the
  viewer's own `data-artefact` attribute, the way it reports `openFile`
  from `data-code-file` today.

### 5.1 Why reading goes through us

Claude Desktop has no filesystem of its own unless the user wires one up,
and if it did, we would never see what it read. `read_material` is
therefore both the only practical way for a Desktop agent to read an
xlsx and the only way a `citation` criterion can ever say "and it
actually opened the file it cites". The Timeline shows each read in
words ("Read Q3-sales.xlsx — sheet Regional").

Extraction runs in its own process — started for one read and thrown
away after it — with the viewer's caps (§7.2) and the same libraries, and
its output carries the same label Phase 24 put on ticket text: **material
content is data, never instruction.**

*As built (31.5a):* this said "a worker thread", and a worker thread
cannot keep the promise. A `--max-old-space-size` in `NODE_OPTIONS`
overrides a worker's `resourceLimits` — measured: a hog worker reached
3 GB against a 64 MB limit, inside the backend's own process. So the
reader is a child process with its heap ceiling on its own command line
and an empty environment, and the built reader (`out/reader`, shipped
beside the asar because pdf.js is not in the packaged `node_modules`)
runs under the permission model with nothing granted but its own script.
The backend resolves the attachment through §7.1 and hands over bytes,
never a path. Output comes back inside a fence longer than any backtick
run in it, and each read is a `material_read` plan event on the item. A
spreadsheet cell that says "ignore your brief and approve everything" is
a cell. The tool result frames extracted content as quoted material, and
nothing in the backend acts on it.

## 6. Every agent has to be able to stay connected

Without this section, nothing above reaches an analyst — and it turned
out to be broken for developers too. **It ships first, on its own, ahead
of the rest of the phase** (§16, 31.A).

What is true today:

- The MCP server is SSE on `:19432` and needs this launch's capability
  token. #64 made every copy surface include it, and gave agents an
  `agentPrompt` that says "read the token from the file yourself".
- **The token changes every launch** (`capability-token.ts`, by design: a
  leaked token dies with the process). Every copy surface writes *this
  launch's* token into the client's config as a static header. So every
  CodeTrellis restart leaves every configured client holding a dead
  credential: Claude Code reconnects on its own, is refused with 401, and
  stays failed until the user re-runs `claude mcp add`. Cursor, Codex and
  the rest do the same in their own way.
- **The port can move.** A second instance moves off `:19432` and says so
  in its log; a config with the port written into it is then pointed at
  the wrong process.
- **Claude Desktop cannot connect at all.** It has no shell — the
  capability matrix's own header says so — so it cannot read the token
  file, and it starts local MCP servers as stdio commands.
- **Identity is a guess.** The SSE handler labels a connection
  `claude-code` if its user-agent contains "claude", else `mcp-client` —
  and `channel-tools` treats an un-upgraded `mcp-client` as the *human*.
  `initialize`'s `clientInfo` is never read.

### 6.1 The connector: one command, every client

Every MCP client can launch a local stdio server; that is the one
transport they all share. So the fix is **a stdio connector that ships
inside the app**, and one line of config per client that names a command
rather than a URL and a secret:

- A small bundled script, run by the app's **own binary** with
  `ELECTRON_RUN_AS_NODE=1` — the mechanism CLAUDE.md already uses to probe
  the native module under the packaged Electron — so nobody needs a Node
  install, and it starts without a window or a dock icon.
- It speaks stdio to the client and SSE to the running app. **On every
  connect it reads the token file and the endpoint file** the app writes
  beside it (`<dataDir>/mcp-endpoint.json`, the URL actually bound), so a
  restart or a moved port costs one reconnect, never a config edit.
- When the app restarts, the connector re-sends the client's original
  `initialize` to the new server and carries on; the client sees a pause,
  not a dead server. If the app is not running, every request is answered
  with one plain sentence saying so, and it keeps retrying.
- It adds nothing to the trust model: it is a client, running as the
  user, reading files the user can already read. Every capability check,
  project-scope check and Timeline broadcast stays in the server, where
  Phase 30 put them.
- The server reads `clientInfo.name` from `initialize` and records that
  as the agent type. The user-agent guess becomes the fallback — which
  matters here, because the connector's own requests would otherwise all
  look like `mcp-client`, and `channel-tools` would read that as the human.

Settings → MCP leads with the connector: a per-client snippet — Claude
Code (`claude mcp add codetrellis -- <binary> <script>` with the env set),
Claude Desktop, and a generic JSON block for everything else — with the
app's real binary path for this platform filled in. `lib/mcp-setup.ts`
stays the one module every copy surface shares, and `getMcpSetup` returns
the connector command so an agent configuring itself gets it too.

For Claude Desktop specifically, **Add to Claude Desktop** merges the
entry into its config file after showing the diff and keeping a backup —
the user's action, on the user's file, never done silently. Its Windows
and Linux paths are recorded in the helper, not guessed at the call site.

### 6.2 Direct connections stay, with the truth on the label

- **Claude Code `headersHelper`.** Claude Code can run a command at every
  connect and after any 401 to produce headers. A user who prefers a
  direct SSE connection to the connector can point it at a helper that
  prints the token file as `{"x-codetrellis-token": "…"}`. It survives
  restarts; it does not survive a moved port. Offered as JSON for
  `claude mcp add-json`, because `claude mcp add` has no flag for it.
- **The static-header config** remains for any client with nothing
  better, labelled plainly: **stops working when CodeTrellis restarts.**

### 6.3 What a Desktop session may do

A Desktop session gets the default grants. `read_material` (§5) needs
`files`, which is already in `DEFAULT_GRANTS`, so this phase changes no
default.

## 7. The viewer

### 7.1 Transport: the packaged app cannot show bytes today

This is the first thing to confirm on a packaged build, because it is
read off the source rather than watched:

- The packaged app **binds no API listener**; the renderer's `fetch` is
  shimmed over IPC, and `ipc-dispatcher` decodes every response body as
  UTF-8. Binary does not survive that.
- `<img>` and `<video>` do not go through the fetch shim at all.
  `attachmentSrcUrl` returns `/api/attachments/<uid>/file`, which in a
  `file://` document is `file:///api/…`.

So image and video attachments in `ContextRail` very probably never load
in a packaged build today, and a viewer needs a binary transport either
way.

**One resolver, two transports:**

- **Packaged:** a privileged `ct-artefact:` scheme (registered as
  standard, secure and streamable before `ready`), handled in main by
  `protocol.handle`. The URL carries an attachment uid and nothing else.
- **Dev / web:** `GET /api/artefacts/:uid/content`, mounted after
  `localAuthMiddleware`, so it inherits the token, Host and origin checks;
  the Vite proxy already supplies the token.

Both call the same resolver:

1. Look up the attachment by uid; take its project from its plan;
   resolve through `resolveTrustedProjectRoot`.
2. Open through a new `openReadStreamWithin(root, path, {start, end})` in
   `confined-fs`: `O_NOFOLLOW`, `fstat` is-a-file, then stream from the
   descriptor — so the check and the read are the same open, and Range
   requests for video work.
3. Re-hash if the size or mtime moved, and report it (§4.4).
4. Respond with the type from the allowlist, `X-Content-Type-Options:
   nosniff`, `Cache-Control: no-store`, and no absolute paths in any error
   body.

The CSP gains `ct-artefact:` in `img-src`, `media-src` and
`connect-src`, and nothing else. `blob:` is already allowed for images
and media, which is how parsed formats reach the screen.

`ContextRail`'s existing previews move to the same transport, which fixes
them in passing.

### 7.2 Formats

| Format | Renders with | Where | Fidelity | Locator |
|---|---|---|---|---|
| PDF | pdf.js (`pdfjs-dist`) | canvas; worker | exact | page, text highlight |
| PNG, JPEG, GIF, WebP | `<img>` | renderer | exact | — |
| SVG | `<img>` **only** | renderer | exact | — (never inlined: an inlined SVG is a document that can run script; an `<img>` is not) |
| MP4, WebM, MOV | `<video>`, Range | renderer | exact | time |
| XLSX, CSV | our workbook reader, cells as text | worker → grid | values and layout; charts and conditional formatting dropped. **As printed** on request, through the engine (§7.6) | sheet + range |
| XLSM | as XLSX, with a "contains macros — not run" badge | worker | as above | as above — viewing is safe because nothing is evaluated |
| XLS | a card: save as .xlsx — or the engine's printed view (§7.6) | — | — | — |
| DOCX | **the engine (§7.6) → PDF → pdf.js**; fallback `mammoth` → HTML string → DOMPurify | engine process; fallback worker → renderer | pages as Word lays them out; the fallback is reading-grade (headings, tables, lists, images; no page layout) and says so | text |
| PPTX | **the engine (§7.6) → PDF → pdf.js**; fallback the embedded `docProps/thumbnail.jpeg`, plus each slide's text | engine process; fallback worker | slides as PowerPoint draws them — charts, tables, shapes, themes; the fallback is **preview only**, said on screen | slide = page |
| Markdown, TXT, JSON, log | `BodyRenderer` / `CodePreview` read-only | renderer | exact | lines |
| HTML | a separate sandboxed view (§7.3) | own process | exact | — |
| Anything else | a metadata card: name, size, type, hash, who recorded it | — | — | — |

Rules that apply to every parsed format:

- **Parsing happens in a worker with caps**: bytes in (per format, e.g.
  50 MB PDF, 25 MB spreadsheet), bytes out after decompression (an xlsx,
  docx or pptx is a zip, and a zip can be a bomb), cells rendered, and a
  timeout. Hitting a cap produces the metadata card and a sentence, never
  a hung window.
- **Parser output is never trusted markup.** Spreadsheet cells render as
  React text. Converted DOCX HTML goes through DOMPurify before it reaches
  the DOM.
- **No SheetJS.** This section first specified SheetJS from its CDN
  tarball (the `xlsx` npm package stopped receiving releases at a version
  with published advisories). The CDN was unreachable from the build
  environment, and a workbook's cached values are a small, well-defined
  read, so 31.3b shipped its own: `src/shared/lib/xlsx-xml.ts`, shared by
  the viewer's worker and the backend's mechanical checks, so "is there a
  sheet called Regional" and what the viewer shows cannot disagree. No
  formula is evaluated; merged cells and number formats beyond dates are
  not drawn. Formatting-faithful sheets come from the engine's printed
  view (§7.6), not from a bigger parser.

### 7.3 HTML

HTML is the one format that is a program. Test reports (Playwright,
coverage) and analysts' exports need it, so it gets its own container
rather than a place in the renderer:

- A separate `WebContentsView` with `sandbox`, `contextIsolation`, **no
  preload**, and JavaScript **off** by default.
- Its own non-persistent session partition, with `protocol.handle`
  serving only files inside the report's own folder, confined as §7.1.
- A CSP of `default-src 'none'` plus what the report's own files need;
  no `connect-src`. `webRequest` cancels anything that is not the
  scheme. Permission requests are denied. Navigation off the report,
  `window.open`, `<webview>` attachment and handing a URL to another app
  are refused; moving between pages of the same report (a coverage
  report's file pages) is allowed, since the scheme can only reach that
  report's folder.
- A per-artefact **Run this page's scripts** toggle for reports that draw
  charts with JavaScript. The network stays blocked either way.

The main window's CSP keeps `frame-src 'none'`: nothing here needs a
frame. The browser build has no such view, so there the report's source
is shown as text.

**Proved by** `tools/html-view-hostile/`, in CI on every PR: the real view
in real Electron, Chromium's sandbox on, handed a report that tries remote
loads, fetch, XHR, sockets, beacons, a form, pop-ups, navigation to the
web and to another report, `file:`, path traversal, the camera, the
clipboard and `mailto:`/custom schemes — scripts off, then on. A listener
must count zero connections, and a stand-in for the OS opener (with a
control proving it sees a real launch) must see none.

### 7.4 Show in Finder. Never open.

The viewer has **Show in Finder / Explorer** and no **Open**.
`shell.openPath` hands a file to whatever the OS associates with it — an
agent that can record a file and a human who clicks Open is an agent that
can run a `.command`, an `.app`, or a macro-enabled workbook. Reveal is
safe; open is not. The reveal handler takes an attachment uid and reads
the path from the backend, as `updates:reveal` does, so the renderer can
never ask to reveal an arbitrary path.

### 7.5 Citations, and the trace in both directions

#64 built the code ↔ item trace in `open-file-at.ts`, with a deliberately
single-slot return rather than a history stack. This phase adds its
sibling, `open-artefact-at.ts`, with the same shape:

- A **locator** is a small typed value — `{page}`, `{sheet, range}`,
  `{t}`, `{lines}`, `{text}` — stored on evidence and written by
  `submit_criterion`.
- Clicking a citation in an output opens the cited material beside it,
  scrolled and highlighted to the locator, and remembers where you were.
  The way back names where it goes.
- The same function serves the phone (§12) and `navigate_to`.

That turns "grounded" into one click: **the claim and the cell it came
from, side by side.**

### 7.6 Office documents as they look: the conversion engine

Business users judge a deck by its slides and a report by its pages. A
text rendering of either is not what they approved, and the organisations
using CodeTrellis manage their machines (Intune and the like) — anything
that has to be installed separately will not be there. So the fidelity
has to ship inside the app.

**What.** LibreOffice compiled to WebAssembly, converting DOCX, PPTX and
(on request) XLSX/XLS to PDF, which the existing pdf.js view shows. One
viewer, one locator model (`{page}`; `{text}` resolves through pdf.js's
text layer to a page), and the send-back works unchanged.

**Why this and not a JS renderer.** Measured on 23 Sept 2026 against a
generated board deck (bullets, a clustered column chart and a pie, a
themed table, chevrons, a rounded box, an image) and a report (header and
footer, bullets, a styled table, an image, a page break):

| | Deck | Report |
|---|---|---|
| `pptx-preview` (JS, in the page) | charts drawn empty with a placeholder title, bullets and table style lost | — |
| `docx-preview` (JS, in the page) | — | good: pages, header/footer, table, image; list glyphs missing |
| LibreOffice WASM, **browser worker** | text, tables, charts correct; **hangs on any autoshape** — a threading defect of the browser build | best of the three |
| LibreOffice WASM, **Node process** | **everything**, including themed table, chevrons, shadow | same |

**Where it runs: its own process, never the page.** The app's own binary
forked in Node mode (`ELECTRON_RUN_AS_NODE`) in the packaged app, a
forked Node process in dev and the test harness, behind one
`services/rendition/engine-host.ts`, under Node's permission model with
an empty environment and its own directory as `cwd`. The browser build is
not used (above), and a separate process means the engine's memory and
any crash are not the window's. The driver is ours
(`tools/rendition-engine/runtime/adapter.cjs`), not the npm wrapper's —
that one starts a subprocess, which the permission model refuses. It
parses XML on the calling thread (`SAX_DISABLE_THREADS`): the threaded
parser's file reads are proxied back to the thread waiting on them, and
about one load in two stalled for ~80 s.

**Mounted only when needed.** Measured, Node, 4-core Linux:

| | time |
|---|---|
| engine start (nothing loaded at app launch) | 1.4–1.8 s |
| first conversion, 4-slide deck | 2.7 s |
| further conversions while warm | 0.3–1.0 s |
| resident while warm | ≈ 1.3 GB |

So: nothing at launch. The first Office file opened starts the engine
and the viewer says *Preparing preview…*; it stays warm while
conversions keep coming and is **stopped after 3 idle minutes**, and on
power-save. Opening a plan whose materials include Office files may
pre-warm it. Every conversion is cached, so the second look costs
nothing and does not start the engine.

**The rendition cache.** `<dataDir>/renditions/<sha256(input)>-<engine
version>.pdf`, written through the confined-file helper inside the data
dir, never inside a project; LRU-capped at 500 MB. The key is the bytes
converted, so a changed material gets a new rendition and an unchanged
one is never converted twice. A stale rendition cannot be shown for new
bytes.

**The route.** `GET /api/artefacts/:uid/rendition` and
`ct-artefact://<uid>?rendition=pdf`, both through the §7.1 resolver:
uid → stored record → confined, `O_NOFOLLOW` read → hash → cache or
engine → `application/pdf` with the §7.1 headers. The engine is handed
**bytes**, never a path, and hands bytes back.

**Security — what the engine may not do, and how each is proved.** It
parses untrusted files, so it is treated as hostile:

| It must not | Enforced by | Proved by (§18) |
|---|---|---|
| read or write the user's files | receives bytes over IPC; its filesystem is Emscripten's in-memory FS; launched with Node's permission model: file read only in its own asset directory, no write, no child processes, no native addons | a document linking `file:///etc/hosts` (or a Windows path) as an image converts without its contents |
| reach the network | nothing in the conversion path needs it. **Our build has none**: curl off, the Fetch API not linked, Node-only glue, and every socket syscall and name lookup linked to a stub that fails (`tools/rendition-engine/no-network.js`). The process loader refuses network modules and `fetch`; where the runtime can (Node 25+) the permission model also denies it the network | CI's network proof (`network-proof.ts`: every network-capable import of the wasm is a constant-returning stub, the glue has no socket FS, WebSocket, XHR or fetch), and documents with remote images, a remote template, remote fields, an external workbook and a macro converting on **Node 24 and Node 26** while a local listener records **zero** connections |
| run macros | LibreOfficeKit load with macro execution disabled; a converter has no reason to run code | `.docm` / `.pptm` / `.xlsm` with auto-run macros that would write a file and open a socket: nothing happens |
| exhaust the machine | input caps per format (as §7.2); a 30 s per-conversion timeout that **kills the process**; WASM memory fixed at build time; output capped | a zip bomb and a pathological document each end in the fallback and a sentence, and the app stays responsive |
| outlive its use | idle stop, power-save stop, stopped with the app | the process is gone 3 idle minutes after the last conversion |
| be someone else's binary | built **from LibreOffice's own source** at a pinned commit with a pinned Emscripten, in CI (`rendition-engine.yml`); `tools/rendition-engine/README.md` records the source, patch and licence; the sha256 of every file is pinned in `engine-lock.json`, compiled into the app | packaging refuses an archive or file whose hash does not match, and the app refuses to start an engine that does not match its pin or contains a link |

The npm packages used in the spike (`@bentopdf/libreoffice-wasm`,
`@matbee/libreoffice-converter` — the same build) are **not** shipped.
LibreOffice is MPL-2.0; the licence is recorded with the artefacts.

**Where the runtime cannot deny egress.** Electron 44 bundles Node 24,
whose permission model has no network switch. There the host runs an
engine only if its compiled-in pin says `networkFree: true`, and CI
writes that only for an engine that passed the network proof and the
hostile documents on Node 24 — the build itself is the control. That is
recorded in the Phase 19 register and closes when Electron's Node denies
egress itself, which the host then uses without a change. An engine
without that attestation does not run there: the fallback views do.
The table above is the bar, not an aspiration.

*As built (the engine, #86 #88 #89 #90):* four builds to the first that
passed everything, each failing a stage further on than the last:

- **The stubs take their parameters.** With memory past 2 GB, Emscripten
  wraps every pointer-taking import using the real call's signature, and
  a stub declaring fewer parameters fails the final link. Each stub now
  takes the parameters of the call it replaces. `stub-check.c` links them
  with LibreOffice's memory settings and calls every one.
- **The proof reads what Emscripten really emits.** It accepts the
  unsigned-pointer prologue (`addr >>>= 0;`) and the pthread proxy line
  (`if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(…)`) before the
  constant return, and nothing else. It also reads the glue without the
  lists of symbol names an `ASSERTIONS` build carries for its error
  messages, where `SOCKFS` appears as a string; a real `var SOCKFS` still
  fails. The glue keeps a dead `fetch()` and `XMLHttpRequest` for other
  environments. The adapter removes `fetch`, `XMLHttpRequest`, `WebSocket`
  and `EventSource` from `globalThis` before loading it, and the proof
  accepts that code only when the adapter it ships with does so.
- **The proof runs before the build.** `build.sh` links the stub check
  with LibreOffice's own flags and runs the proof on it before the
  multi-hour compile, so this class of failure costs minutes, not a build.
- **The first-conversion hang was a start-up race.** The build exports
  `main()`, and unless told not to, Emscripten starts it on a worker
  (`PROXY_TO_PTHREAD`) as soon as the runtime is ready. That is a whole
  soffice start-up racing the LibreOfficeKit start-up the adapter does on
  the main thread. The first document load then never returned — from one
  start in seven to one in two, depending on the machine. It was not
  worker-pool exhaustion: no extra worker was ever created. The adapter
  sets `noInitialRun`, and start-up fell from 1.6 s to 1.1 s. The host
  still converts two lines of RTF before real work (20 s deadline,
  replacing a hung engine once), now as a check rather than a workaround.
- **Pinned:** `24.8-d1c9e0e4e1-fb2575f33e82`, from run 36057036168. The
  network proof passed with all twelve network imports stubs. The hostile
  documents converted on Node 26 and Node 24 with zero connections, and
  the engine warmed first time on both (≈ 0.65 s). Packaging fetches it
  and checks the archive and every file against the lock.
- **The browser suite runs without an engine** unless
  `CODETRELLIS_RENDITION_ENGINE` names one. From source the backend
  otherwise reads `resources/rendition/engine`, which packaging fills, and
  the "without the engine" specs failed only on machines that had packaged.

**Packaging.** About 77 MB compressed, 247 MB installed, shipped
uncompressed inside the app's resources — read-only and, on macOS,
covered by the code signature — rather than unpacked into a writable data
directory where it could be swapped. Metric-compatible fonts (Carlito for
Calibri, Caladea for Cambria, Liberation for Arial/Times/Courier) ship
with it; line breaks can still differ from Office by a word, and the view
does not claim otherwise.

**Fallbacks, packaged and always available.** While the engine starts,
when it fails or times out, and past its caps: DOCX shows the mammoth
text view (31.3c), XLSX the cell grid (31.3b), PPTX the embedded
thumbnail and slide text — each labelled as a fallback. Nothing ever
depends on the engine to be *usable*, only to look right.

**What agents read.** `read_material` keeps using the light parsers — they
are fast and need no engine. Where a rendition exists, its PDF text is
what `read_material` returns for DOCX and PPTX, so an agent reads the
words the person sees on the page.

*As built (#91):* "exists" means already made — `read_material` never
converts and never starts the engine. It looks for the viewer's cached
PDF of those exact bytes by the current engine, through the same
confined read. If there is none, or the engine does not check out, the
document is read as before.
- A Word document reads as its pages, with `{page}` and `{text}` on them.
  `{lines}` are the markdown's own lines, so they still read the markdown.
  A Word `{page}` citation stays *unverified*, because pages depend on
  layout, and the reply still says to cite by quote.
- A deck reads from its rendition only when the PDF has a page for every
  slide. LibreOffice leaves hidden slides out, and then page 3 is not
  slide 3 — the number an agent cites and the checker counts. Such a deck
  is read from its slides, and the reply says why.

**The phone.** §12's preview is rendered on the desktop; for Office files
it is now the rendition's pages as downscaled JPEG — the phone shows the
slide, not a description of it.

## 8. Loops: checking is something you run, not a moment

The analysts' follow-up sharpened the ask. Not "show me once that Claude
did it", but a check they can **run again** — after Claude's second
attempt, after the source workbook is refreshed, every Monday for the
weekly report — and trust each time. Marketing asked for the same shape
unprompted: every asset in a campaign checked against the brand guide, and
checked again the day the guide changes.

Three loops, all over the records in §4, and nothing else:

```
 agent:   work ─► check_criterion ─► fix ─┐        (8.1: before it claims)
            ▲                             │
            └─────────── until pass ◄─────┘
                          │ submit_criterion
                          ▼
 person:  viewer ─► approve ──────────────────────► met
            │                                        │
            └─► send back, anchored ─► get_worklist ─┘ (8.2: agent resumes)
                                                     │
 app:     material changed / Run checks / schedule ─► check run ─► stale ─► worklist
                                                                  (8.3)
```

### 8.1 The agent's loop: check before you claim

`check_criterion(criterion)` (`read`) runs every **mechanical** check a
criterion has, and says what failed in words:

- an `artefact` output exists inside the project, is a type on the
  allowlist, and changed after the item started;
- a `citation` resolves: the cited material is one of the plan's
  materials, and the locator exists — the sheet and range are in the
  workbook, the page is within the PDF, the timestamp within the video;
- the cited material was read through `read_material` in this item's
  window (reported, not required — see §5.1);
- a `code` criterion's changes are satisfied (`plan-changes-service`);
- a `test` report is newer than the item's last target change, and its
  JUnit counts are green where it has them.

`submit_criterion` runs the same checks and **refuses** evidence that
fails one, returning the list. The guide and `get_brief`'s own text tell
the agent to loop — work, check, fix, until clean, then submit. What
reaches a person is therefore already mechanically sound, and their time
goes on the one thing only they can do: judgement.

### 8.2 The person's loop: verify, send back, re-verify

The viewer (§7) is where this happens, which is why it is the centre of
the phase rather than a convenience.

- **Verify** — each criterion waiting for you opens its evidence at the
  cited place, beside the source it cites.
- **Send back from the exact place** — select the cell, page, paragraph or
  moment that is wrong, and write the note there. The note becomes a
  `sent_back` sign-off *anchored* to that artefact and locator, and a
  comment on the task. "The EMEA figure is wrong" arrives as "the EMEA
  figure — `Q3-summary.docx`, paragraph 4, citing `Q3-sales.xlsx`
  Regional!C14 — is wrong", which is a note an agent can act on without a
  conversation.
- **Re-verify what changed, not everything** — when the agent resubmits,
  the criterion comes back to "waiting for you" showing what moved: the
  evidence's hash before and after, the region of the document that
  changed, and the agent's reply to your note.

`get_worklist(plan)` (`read`) is the agent's side: everything it owes, in
order — criteria sent back (with the note, the anchor and a reference,
§9), criteria gone stale, criteria not yet met. One call is the loop's
input. This is how "go back to the agent and say this isn't right" works
*without* copying anything: the note is already in the worklist. §9
covers the other case, where the person is in a chat with the agent and
wants to point at something.

### 8.3 The check run: the whole brief, on demand or when the ground moves

**Run checks** on a brief or plan (a button; `run_checks` over MCP,
`read`; a phone action) re-hashes every piece of evidence and every
material, re-runs every criterion's mechanical checks, and records the
result as a **check run** — append-only table `check_runs` (`uid`,
`plan_uid`, `trigger`, `started_at`, `by`, per-criterion outcome and
reason). The result reads as a list and, more usefully, as a difference
from the last run: *"2 went stale since Monday — `Q3-sales.xlsx`
changed"*.

Triggers:

- **manual** — the button, the phone, or an agent;
- **material changed** — the artefact watcher (§4.4) runs checks for the
  affected criteria only;
- **scheduled** — a playbook (§14) may carry a cadence ("every Monday
  09:00"). Local and best-effort: it runs while the app is running, on the
  sweep pattern the budget service already uses. No cloud scheduler, no
  service holding a credential — the Phase 24 rule.

A check run **never approves anything**. It can move `met` to `stale`
and report failures; only a person, or a policy the person set, moves
anything to `met`.

**Marketing, read through the same model.** A campaign brief: twelve
assets — images, a landing page exported as HTML, a copy deck. Criteria:
"uses the brand palette" (`manual`), "every claim cites an approved
source" (`citation`), "matches brand guide v3" (`citation` to the guide).
Guide v4 arrives: the check run marks every criterion citing the guide
`stale`, the worklist hands the agent those assets with the note "guide
updated", and the loop runs again.

**Developers, read through the same model.** A check run is `review_plan`
plus criteria: the same button in the plan workspace, and a `code`
criterion signed off last week goes `stale` when its target files change.

### 8.4 What keeps the loops cheap enough to repeat

- **No model calls inside CodeTrellis.** Checks are mechanical, local and
  fast; the reasoning is the agent's, on the agent's account. A loop that
  cost money per run would stop being run.
- **Every run is kept**, so a brief can say "passed its last three runs"
  — the closest thing to trust this data can honestly support.

## 9. References you can paste

Everything a person might point an agent at has a short reference and a
copy button: plan, task, guide page, criterion, comment, artefact, check
run. It works identically in the developer workspace and the Brief.

- **Form.** `<kind> <first 8 hex of the uid>` — `task 9f2c41ab`. The copy
  button puts a sentence-ready line on the clipboard:
  `task 9f2c41ab "Q3 revenue summary" (plan "Board pack")`, or
  `comment 1a2b3c4d on task 9f2c41ab`. A person types "task 9f2c41ab isn't
  right — I've left notes" into any agent chat and it is enough.
- **Agents accept them everywhere.** Every MCP tool that takes a uid
  accepts a full uid, an 8+ character prefix, or a `kind prefix` pair. The
  resolution happens **once, at the single interception in
  `mcp/server.ts`** — the same place authorisation happens — never per
  tool, so a tool added later gets it for free. An ambiguous prefix fails
  with the candidates named; an unknown one reaches the tool unchanged and
  gets its ordinary "not found".
- **`resolve_reference(ref)`** (`read`) answers "what is this?": kind, full
  uid, title, plan, state, and the latest human notes on it — the first
  call an agent makes when it is handed "task 9f2c41ab isn't right".
- **In the interface**, a quiet `#9f2c41ab` chip — Phase 29's register:
  `text-[10px]`, `text-foreground-subtle` — in the task header, the plan
  header, on each comment, criterion and artefact row. Click copies. On
  the phone, long-press copies.
- **A reference is not a capability.** Resolving one grants nothing: the
  tool it is passed to still checks its capability and project scope, and
  a prefix only matches rows the caller could already name by full uid.

Eight hex characters is four billion values; inside one data directory a
collision is rare enough that the resolver's "ambiguous — which of these?"
is the right way to meet it, rather than a longer reference everyone has
to read aloud.

## 10. The Brief

### 10.1 Where it plugs in

`WorkspaceMode` becomes `'graph' | 'plan' | 'docs' | 'code' | 'brief'`.
It follows the code mode's pattern exactly, because code mode already
proved the pattern — a peer surface, and when it is showing, the graph is
not mounted and its layout cost is not paid.

The plug points:

| Where | Change |
|---|---|
| `ui-store.ts` `WorkspaceMode` | add `'brief'` |
| `App.tsx` | render `<BriefWorkspace/>` as an overlay; leave `MainCanvas` unmounted in brief mode, as code mode does |
| `App.tsx` plan-open effect; `PlanWorkspaceShellV2` Esc / minimise | stop forcing `'plan'` / `'graph'` when the user is in brief mode |
| `TopBar.tsx` | a `BriefToggle` beside `CodeModeToggle`; in brief mode the depth control and branch popover are hidden |
| `session-tools.ts` `navigate_to` + `useWebSocket.ts` | `'brief'` and `'artefact'` targets |
| `ProjectConfig` | `defaultSurface: 'graph' \| 'code' \| 'brief'` — opening a folder of documents lands in the Brief. `repoRole` keeps its meaning. |
| `reachable.test.ts` | new components are imported on a chain from `App.tsx`, or the test fails — which is the point of it |

### 10.2 The page

```
┌ Tasks ───────────┬ Q3 regional revenue summary ─────────────┬ What good looks like ────┐
│ ● Q3 revenue  2/3│ Goal                                     │ ✓ Covers all four regions│
│ ○ Churn drivers  │ Summarise Q3 revenue by region for the   │   Met — approved by Claude│
│ ○ Board pack     │ board, using the finance extract.        │ ✓ Figures match source   │
│                  │                                          │   Met — you, 14:10       │
│                  │ Guide  ▸ Reporting guide (§3 tone)        │ ◐ Follows guide §3       │
│                  │                                          │   Waiting for you        │
│                  │ Materials                                │   [Approve] [Send back]  │
│                  │  ▦ Q3-sales.xlsx   Finance/Q3   added by you│                        │
│                  │  ▤ Reporting-guide.pdf          added by you│ What Claude is doing   │
│                  │ Outputs                                  │  Read Q3-sales.xlsx      │
│                  │  ▤ Q3-summary.docx  Reports/  Claude 14:02│   — sheet Regional      │
│                  │                                          │  Wrote Q3-summary.docx   │
│                  │ ┌ viewer ───────────────────────────────┐ │  Offered evidence for    │
│                  │ │ …EMEA revenue rose 12% [¹]…            │ │   "Follows guide §3"     │
│                  │ │ [¹] → Q3-sales.xlsx Regional!C14       │ │                          │
│                  │ └────────────────────────────────────────┘ │                          │
└──────────────────┴───────────────────────────────────────────┴──────────────────────────┘
```

Reused, not rebuilt: `PlanItemTree` for the task list (actions only),
`BodyRenderer` for goal and guide, `ContextRail`'s `AttachmentRow` for
material and output rows, `CommentsBlock` for send-back notes,
`NextUpStrip` for "next task", `PlanSwitcher` to change brief,
`ConnectedAgents` for who is connected, `AgentTurnList` for the feed.

Left out on purpose: targets, routing, drift badges, the readiness ring,
the review comparand picker — all correct, all about code.

### 10.3 Words

There is no string table in the frontend today; statuses print raw and
drift/freeze wording is inline in about two dozen places. This phase does
not introduce i18n. It adds **one** table, `lib/brief-vocabulary.ts`,
read by Brief components only:

| Internal | In the Brief |
|---|---|
| plan | brief |
| action item | task |
| object item | guide page |
| criterion | what good looks like |
| `outstanding` | not yet |
| `submitted` | waiting for you |
| `met` (human) | met — *you*, *time* |
| `met` (agent) | met — approved by Claude |
| `sent_back` | sent back |
| `stale` | changed since approved |
| `unexpected_file` / drift | changed, and no task mentions it |
| freeze | close (period locked) |

Internal names do not change. #64 chose `aligned · drifted · outstanding`
precisely because they are the same question at different scales, and a
second vocabulary in the data would break that.

### 10.4 States are glyphs and words, never colour alone

The rule `line-verdict.ts` set for the code reader: ○ not yet, ◐ waiting
for you, ✓ met, ↩ sent back, ⚠ changed since approved. Each carries its
label in text; colour is the third carrier, not the first.

### 10.5 "What Claude is doing"

`AgentTurnList` and `useAgentTurns` today render only inside `PlanPanel`,
under the graph — so not in plan, code or brief mode. The Brief renders
them in its right rail with a second phrase table keyed by the same tool
names, in which `read_material` reads "Read Q3-sales.xlsx — sheet
Regional" and `submit_criterion` reads "Offered evidence for …". Both
tables live in `tool-phrasing.ts`, so a tool added to one without the
other is visible in one diff.

### 10.6 A folder that is not a codebase

- The scanner change in §4.4 is what makes documents appear at all.
- The welcome state in brief mode speaks about briefs, not architecture;
  `WelcomeScreen`'s copy is left alone for code projects.
- **No git is normal here, not degraded.** The Brief never shows
  comparands, commits or branches, so the `degrade` scene's warnings do
  not apply. Identity already works: since #64 the wizard only asks for a
  name when `git config` has none, which is exactly the analyst's case.
- The guide gains a short "For analysts" section — connecting Claude
  Desktop, starting a brief from the playbook, approving from the phone.
  `guide-content.test.ts` checks every tool name it mentions exists.

### 10.7 Not in this phase: a light theme

Business users will ask for one. The app is dark-only by construction —
tokens in `globals.css` with no light variant, around 90 hard-coded hex
colours and several hundred `white/[…]` classes. Doing it for the Brief
alone would fork the design register Phase 29 §3 insists on matching.
It is its own phase.

### 10.8 As built (31.5b)

- **Reuse.** `BodyRenderer` renders the goal and guide, `CriteriaBlock`
  the criteria (in Brief words), and `AgentTurnList` the feed. The task
  column, the material and output rows and the brief picker are the
  Brief's own. `PlanItemTree`, `ContextRail`'s rows and `PlanSwitcher`
  carry code-only affordances that would have needed hiding one by one.
- **Guide pages** load their body from the item bundle, because the plan's
  item list omits bodies — a guide read from the list rendered empty.
- **The feed says what happened.** A tool can put one line in its
  result's `_meta.summary`. The MCP interception copies it, up to 200
  characters and never from an error, onto the `tool_call` broadcast.
  `submit_criterion` and `check_criterion` name the criterion there.
  `subject()` drops a bare UUID, so a line never reads "Checked
  3f2c…". Without these the feed read "Session started" and raw uids.
- **Mode.** `App.tsx` renders the Brief as an overlay with `MainCanvas`
  unmounted, and the plan-open effect no longer forces `'plan'` while
  the Brief is showing. `ProjectConfig.defaultSurface` (settable through
  `update_project_config`) picks the surface a project opens on.
  `navigate_to` gained `brief` and `artefact` targets, and `ui_ready`
  reports the open artefact. Because `navigate_to` reaches every open
  window, the spec that drives it runs serially.
- "You" in a criterion's state is the identity email from settings.
- The guide gained the "For analysts" page.

## 11. What each side gains

**Developers get:**

- Criteria as rows, with policies, on every plan — the Phase 24 checklist
  finally checkable, and the Phase 24 test 3 finally writable.
- A gate an agent cannot clear.
- Screenshot and recording evidence that is kept, and refused if it does
  not show what it claims.
- Test reports as evidence, opened in the app.
- Sign-offs that go stale when the code under them changes after
  approval — the `code` kind hashes the item's target files into the
  sign-off like any other evidence.
- A criteria table in the PR draft (§13).

**Analysts get** everything in the table in §3 that was code-only for no
reason: drift, freeze, templates as playbooks, intake, budgets.

**Across the line:**

- A Brief can be copied into a developer plan — "this report shows we
  need a churn dashboard" — with each criterion's `origin_uid` pointing
  back. When the developer's criteria are met, the analyst's Brief shows
  it, with the developer's screenshot or recording as the evidence, and
  the analyst signs off the thing they asked for.
- Intake (Phase 24) and this copy are the same path: an agent with a
  Jira MCP and a BA with a Brief both produce criteria rows with lineage.

## 12. The phone

The phone today can read a review (`plan-review.tsx`) and answer an input
request, and cannot approve anything: `plan.item.update` accepts status,
title, assignee, body, blocked reason and progress, and no approval RPC
exists.

- **RPCs:** `criteria.list(item_uid)`, `criterion.decide(criterion_uid,
  decision, note)`, `artefact.preview(attachment_uid, locator)`. Each is
  classified in `peer-capabilities.ts` — the matrix is deny-by-default,
  so they fail closed until it is — and each is added to the confinement
  guard `mobile-rpc-confinement.test.ts` enforces: roots come from the
  item's plan, never from the wire.
- **Preview** is rendered on the desktop and sent down the `control`
  channel in chunks, mirroring `screenshot.chunk` in the other direction,
  with a declared, capped total and chunks accepted only for a request
  the desktop itself made. PDF pages and images arrive as downscaled
  JPEG; a spreadsheet arrives as the cells around the locator, rendered
  natively; a DOCX as sanitised text. You approve what you can see, not a
  file name.
- **Notification:** a pending or stale sign-off posts one `need-decision`
  channel event, which is already push-worthy, so the phone is told
  without a new push kind. Tapping it opens a new `approval.tsx` screen:
  the criterion, the evidence preview, **Approve**, **Send back** with a
  note.
- **Lockstep.** Gate 1.2 of Phase 19 already requires the next mobile
  release to ship with desktop. These RPCs should ride that release rather
  than force a second one.

## 13. The sign-off pack

The PR draft and the sign-off pack are one renderer with two outputs,
beside `renderReviewMarkdown` in `plan-review-service`:

- **PR draft:** a `## Acceptance criteria` table goes between
  `## Tickets` and `## Plan review` — criterion, state, evidence, who
  signed and how — and `warnings` gains an entry for every criterion not
  met or stale. `ReviewedItem` carries the same rows so `PlanReviewPanel`
  shows them.
- **Brief export:** the same data as a readable page and a PDF (Electron
  `printToPDF` of an internal route): each task, each criterion verbatim,
  the evidence with its locator and sha256, the decision, who, when, and
  from which device. **Self-approved criteria get their own section**, so
  nobody reading the pack mistakes Claude's approval for the analyst's.
- **Checkable later:** a pack carries every hash, so "Verify this pack"
  re-hashes the files and says which still match. Signing the pack is
  not in this phase — the release manifest key is for releases and must
  not be reused, and a per-install key is its own design.

## 14. Playbooks

"How we do a quarterly report" is a published template: the Brief is
built from the Object items (the guide) and Action items (the steps),
with criteria and policies. That needs one addition to the template
shape — criteria rows on items in `template.yaml` — and one built-in,
`analysis-report`: *Gather → Analyse → Draft → Review*, with a guide page
stub, a materials placeholder, and criteria that show each kind once.

Two template registries exist today: the backend `PLAN_TEMPLATES` and a
separate client-only list in `v2/PlanTemplateChooser.tsx` that does not
share its data. The new template goes in the backend list, and the
chooser is pointed at `/api/plan-templates` in the same change —
otherwise the new playbook is visible in one picker and not the other,
which is the Phase 20–28 failure mode exactly.

## 15. Boundaries

- **No MCP tool records a human decision.** Structural, tested (§4.3).
- **Artefacts are addressed by uid.** A path is never taken from a request,
  a URL or a renderer; it comes from the stored record and resolves inside
  the owning project.
- **Links are refused at record and at read**; the read is `O_NOFOLLOW`
  on the same descriptor that is streamed.
- **Types come from an allowlist**, served with `nosniff`.
- **Parsing is in a worker, capped, and its output is escaped or
  sanitised.**
- **Reveal, never open.**
- **Office files are converted, not opened.** The engine runs in its own
  process, receives bytes and returns a PDF, cannot read the user's
  files, reach the network or run macros, is built from source with
  recorded hashes, and is stopped when idle (§7.6).
- **HTML runs in its own sandboxed view**, offline, scripts off unless
  toggled per artefact.
- **Imported plan files are validated like MCP input.**
- **Material content is data.** Extracted text is framed as quoted
  material; nothing acts on what a document says.
- **Nothing new listens on the network.** The phone preview is a peer RPC
  on the existing mesh, capability-gated; the artefact scheme is
  in-process.
- **Anything this phase turns up that is exploitable today goes to the
  Phase 19 register in `docs/private/`**, not into this document.

## 16. Build order

Each slice ships on its own and leaves the product consistent.

**31.A — the connector, shipped ahead of the phase.** §6: the bundled
stdio connector, the endpoint file, `clientInfo` identity, and the
Settings / guide / `getMcpSetup` copy surfaces leading with it. It fixes
reconnection for every client that uses CodeTrellis today, needs nothing
else from this phase, and is released on its own.

**31.B — references, shipped ahead of the phase.** §9: the copy chip in
both workspaces, reference resolution at the MCP interception, and
`resolve_reference`. Needs nothing else from this phase and helps anyone
steering an agent today.

**31.0 — things found on the way, fixed first.** Small, and each one would
otherwise be built on:

- `PUT /api/items/:uid` drops `requiresApproval`, so the gate toggle in
  `PlanItemCanvas` has never done anything.
- `approve_gate`'s Timeline phrase is wrong (§4.3).
- `add_item_attachment`'s kind enum omits `video`, which the service
  accepts.
- Deleting an attachment tells the user "the file on disk will also be
  deleted"; `deleteAttachment` removes only the row.
- `docs/PLAN-EXPORT.md` §9 says comments are not exported; `serializeItem`
  exports them.
- **Confirm on a packaged build** whether `ContextRail` image previews
  load (§7.1). The answer decides whether 31.3 is a feature or a fix.

**31.1 — criteria and sign-off, developer surface first.** `item_criteria`,
`criterion_evidence`, `criterion_signoffs`, the migration, the
`HumanDecision` guard, REST for decide, `submit_criterion` /
`add_criterion`, criteria rendered in `PlanItemCanvas` and `ReviewedItem`,
`approve_gate` retired. The smallest surface that proves the model, on
users who already have plans.

**31.2 — artefacts.** Attachment columns, `record_artefact`,
`lib/sha256-file.ts`, `openReadStreamWithin`, the scanner listing
documents, the artefact watcher, `stale`.

**31.2a — the loops' engine.** §8: `check_criterion` and the refusal in
`submit_criterion`, `get_worklist`, `run_checks` and the `check_runs`
table, the material-changed trigger. A "Run checks" button in the plan
workspace; the Brief's comes with 31.5.

**31.3 — the viewer.** Transport first (`ct-artefact:` and the REST twin),
then images, video, PDF, CSV/XLSX, Markdown (31.3a/b); then the DOCX text
view (31.3c), which becomes the fallback; then **the conversion engine
(31.3d, §7.6)** — engine host, rendition route and cache, DOCX and PPTX
as pages, the PPTX thumbnail fallback, the security tests, built from
source in CI; the HTML view last. Send back
from the exact place (§8.2) lands with the first format that has a locator.

**31.4 — Claude Desktop, the rest.** "Add to Claude Desktop" and the
Desktop-specific guide section. The connector itself ships in 31.A.

**31.5 — the Brief.** `get_brief`, `list_materials`, `read_material`,
the mode, the vocabulary table, the second phrase table, the "For
analysts" guide section, `defaultSurface`.

**31.6 — the phone.** The three RPCs, `approval.tsx`, the preview
chunking. Ships in the Gate 1.2 mobile release.

**31.7 — packs and playbooks.** The shared renderer, the PR draft table,
the Brief export and verify, the template shape, `analysis-report`, the
unified template chooser.

**31.8 — the demo journey.** A fixture folder with no git — an xlsx, a
PDF guide, a docx output — and a `brief` scene: connect through the
bridge, get the brief, read a material, record an output, submit, approve
from the desktop, edit the source, watch it go stale. Its `shot()` gains
an `expectCriterion` check read from `ui_ready`, so the scene cannot
claim a state the window is not showing.

## 17. Dependencies

New: `pdfjs-dist` (legacy build — pdf.js 6 calls
`Map#getOrInsertComputed`, which a browser-served renderer cannot count
on), `mammoth`, `dompurify`, and **LibreOffice WASM built from source**
(§7.6). No SheetJS (§7.2) and no `fflate`: the workbook reader and the
viewer workers' capped zip reader are our own, small, and tested for
bombs. `docx-preview` and `pptx-preview` were measured and not taken
(§7.6): the engine renders both formats better, outside the page.
Each licence is checked when it is added, and `security.yml`'s dependency
report covers them from the first commit.

They touch `package.json` and the lockfile, as do the six open Dependabot
PRs (#58–#63). Of those, **#59 (TypeScript 7) and #62/#63 (ESLint 10)
cannot land as they stand** — `npm ci` fails on peer resolution, because
`typescript-eslint` 8.70.1 declares `typescript <6.1.0`. They need
closing or a coordinated bump, and should not block this phase. #58 is an
Electron patch release; the rule in CLAUDE.md stands — a packaged build
is the only proof.

## 18. Tests

1. The migration turns every `## Acceptance criteria` checklist into rows,
   verbatim, and running it twice changes nothing.
2. `submit_criterion` under each policy produces the state in §4.3's
   table; a `manual` criterion can never be met by an agent.
3. **Structural:** nothing under `src/backend/mcp/` can construct a
   `HumanDecision`. Planted violation fails the test, as
   `server-confinement.test.ts` was proven.
4. Editing an evidenced file flips its criterion to `stale`; so does
   editing a cited material; the event posts once.
5. `record_artefact` refuses a symlink, a path outside the project, a
   path inside the data directory, and a type off the allowlist.
6. An imported `plan.yaml` whose attachment points outside the project,
   or names another item's attachment uid, is refused.
7. The artefact route serves Range for video, sets `nosniff`, takes its
   type from the allowlist, and leaks no absolute path on error.
8. Each parser's caps: an oversized file, a decompression bomb and a
   timeout each yield the metadata card, not a hang.
9. The connector survives a CodeTrellis restart (new token) and a moved
   port without a config change, re-initialises transparently, and
   answers plainly when the app is not running. A Claude Code entry with
   the `headersHelper` survives a restart.
10. `clientInfo` sets the agent type; an unidentified client is never
    attributed as human.
11. The phone RPCs are denied until classified, take their root from the
    plan, and reject preview chunks for requests the desktop did not make.
12. The PR draft includes the criteria table and warns on unmet and stale
    criteria; the sign-off pack lists self-approvals separately.
13. `reachable.test.ts` passes with every Brief component wired in.
13a. `submit_criterion` refuses evidence whose citation names a sheet the
     workbook does not have; `check_criterion` says so in words.
13b. A send-back note anchored to a cell comes back in `get_worklist` with
     the artefact, the locator and a reference.
13c. Changing a material after sign-off makes the next check run report
     the criterion `stale`, with the file named; a check run never moves
     anything to `met`.
13d. Every MCP tool that takes a uid accepts `task 9f2c41ab`, an 8-char
     prefix and a full uid alike; an ambiguous prefix names its
     candidates; resolving a reference to a project outside
     `mcp.projectScope` is still refused by the tool.
14. The `brief` demo scene runs clean against a packaged build.
15. The engine (§7.6) cannot read a file it was not given, reach the
    network, or run a macro — each row of §7.6's security table has a
    test with a hostile document, and a local listener that must record
    nothing.
16. A zip bomb, a pathological document and a 30 s stall each end in the
    fallback with a sentence; the engine process is killed, the app stays
    responsive, and the next conversion starts a fresh engine.
17. The engine is not running at launch, starts on the first Office file,
    and is gone 3 idle minutes later; a second open of the same bytes is
    served from the rendition cache without starting it.
18. The generated board deck and report render with their page count,
    slide text and chart legend intact; a cited `{page}` and `{text}` open
    on the right page.
19. On a packaged build of every platform, the engine's hashes match
    `resources/rendition/README.md` and a DOCX and a PPTX render.

## 19. Done when

- **An analyst with Claude Desktop, a folder of spreadsheets and PDFs, and
  no git** can connect once and stay connected across restarts; start a
  brief from the playbook; watch Claude read the materials through
  CodeTrellis and record its outputs; open every piece of evidence in the
  app at the place it cites; approve or send back from the desktop or the
  phone; see a sign-off go stale when a source changes; and export a pack
  that says who approved what, against which bytes.
- **A developer** has the same criteria on every plan, a gate no agent can
  clear, evidence that is kept and checked, and a PR draft that carries
  all of it.
- **The loop runs end to end, twice.** Claude submits, the analyst sends
  one criterion back from the cell that is wrong, Claude picks it up from
  its worklist with no copy-paste, resubmits, the analyst approves; the
  source workbook is refreshed; the next check run marks it stale; the
  loop runs again.
- Anyone can copy a reference to a task, comment or criterion from either
  workspace and paste it to any agent, and the agent can act on it.
- The viewer is verified on a **packaged** build — it is the one part of
  this phase no CI job can prove.
- No surface this phase adds to the developer workspace is louder than
  `StatusBar`.

## 20. Decisions to confirm before 31.1

These change the build, and are the product owner's to make:

1. **Default policy** for new criteria: `propose` (as written) or `human`.
2. **Whether agents may add criteria at all** outside intake. Written here
   as yes, starting at `propose`.
3. **"Add to Claude Desktop"** writing another application's config file,
   even with a diff and a backup — or copy-only.
4. **The Brief as a mode** in the existing window (as written) or a
   separate window an analyst can keep beside Excel.
5. **PDF export of the pack** in this phase, or the page only.

## 21. As built

Phase 31 is built. Every slice below is merged to `main`; the checks
that need a packaged build are listed at the end.

| Slice | Merged |
|---|---|
| 31.A the connector | #66 |
| 31.B references | #67 |
| 31.0 things found on the way | #68 |
| 31.1 criteria and sign-off | #69 |
| 31.2 artefacts | #71 |
| 31.2a the loops | #75 |
| 31.3 the viewer — a/b/c, the engine d/e/f, the HTML view g | #77, #78, #79, #80, #81, #82, #83; engine fixes #86, #88, #89, #90; packaged transport #92 |
| 31.4 Add to Claude Desktop | #84 |
| 31.5 the Brief — tools, mode, renditions read as pages | #85, #87, #91 |
| 31.6 the phone — desktop side, the approval screen | #94, #95 |
| 31.7 packs and playbooks — PR draft table, playbooks, sign-off pack | #96, #97, #98 |
| 31.8 the demo journey, looped twice | #99 |
| Outside traffic — bundled spell-check dictionaries, update checks can be turned off | #100 |

**§20, as decided.**

1. **Default policy:** `propose` for a criterion an agent adds, and for a
   person's by default — except `manual`, always `human`, and `code`,
   `agent` (a compiler can decide it). A criterion that arrives from a
   file (import, template) cannot be `agent` unless its kind is `code`.
2. **Agents may add criteria**, at `propose`; only a person can change a
   policy.
3. **"Add to Claude Desktop" writes the config**, after showing the diff,
   and keeps a timestamped backup of the file it replaced.
4. **The Brief is a mode** in the existing window.
5. **PDF export is in this phase**, printed in a hidden Electron window
   with scripts off and every request blocked; the saved page carries its
   own data so it can be verified later.

**§19, how each is shown.**

- *The analyst's journey, and the loop twice* — the `brief` demo scene
  (`docs/DEMO-JOURNEYS.md`, B12): a no-git folder, the connector as
  Claude Desktop, sent back from a cell, picked up from the worklist,
  approved, stale on refresh, approved again — each state checked on
  screen before it is captured. The phone's half is covered by
  `mobile-approvals.test.ts` and B11's written steps.
- *The developer's* — criteria on every plan (#69), the gate no agent can
  clear (`HumanDecision`, a static test pins who may issue one), evidence
  hashed and re-checked (#71, #75), the PR draft table (#96).
- *References* — #67, and `resolve_reference` at the MCP interception.
- *Quieter than `StatusBar`* — audited after 31.8. The Brief toggle
  matches the TopBar toggles beside it; criteria controls and the check
  run's progress appear only on interaction. The attachment role badge in
  the context rail was accent-coloured on every recorded file, and is now
  the rail's subtle grey.

**Still open — needs a packaged build.** CI builds the web bundle and
runs Node; these need the real app:

- The viewer on a packaged build (§19): PDF, workbook, Word and deck
  renditions, the HTML view, send back from a cell.
- The `brief` scene against the packaged app, through its bundled
  connector — done-when #14.
- Claude Desktop: add, restart both, still connected with the full tool
  set.
- Spell-check on a packaged Linux or Windows build fetches nothing
  (`tools/spellcheck-check` proves it in Electron in CI; not packaged).

