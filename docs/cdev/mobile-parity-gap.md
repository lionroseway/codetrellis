# Mobile ↔ Desktop Parity — Gap Analysis

_Companion to `16-mobile-companion.md`. Snapshot taken after M8 + project-browser
+ graph-scene. Goal: "what they can do on desktop they can do here," with a
Notion-clean reading experience._

## Principle

The desktop is **both human- and agent-operable** — almost every surface is
rich-edit + MCP-drivable. The mobile companion is currently a strong **reader +
controller**: it mirrors a streamed `WorkspaceSnapshot` (read) and acts via
`rpc()` over WebRTC (write). The parity goal is not "port the desktop" but
"cover the high-value flows a developer needs away from the keyboard," with the
same clarity.

## Parity matrix

Legend: ✅ full · ◑ partial · ✗ missing

### Reading (the immediate "Notion-like" gap)
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Plan body / description rendered as markdown | ✅ | ✅ *(now — was ✗)* | **P0 done** |
| Item (Object/Action) body rendered as markdown | ✅ | ✅ *(now — was raw text)* | **P0 done** |
| Comments rendered as markdown | ✅ | ✅ *(now)* | **P0 done** |
| Spec docs rendered (code blocks, tables) | ✅ | ✅ (doc-viewer) | — |
| Inline `[[item/file/symbol]]` chips in bodies | ✅ | ✗ (shows raw `[[…]]`) | P1 |
| Channel/event messages as markdown | ✅ | ◑ plain text | P2 |

### Authoring / editing (the biggest track)
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Edit plan/item **title** | ✅ inline autosave | ✗ | P1 |
| Edit plan/item **body** | ✅ markdown editor | ✗ | P1 |
| Change item **status** | ✅ | ✅ | — |
| Set assignee / blocked / progress | ✅ | ✗ (RPC exists desktop-side) | P1 |
| **Create** page/task/subtask | ✅ slash + tree | ✗ | P2 |
| Post **comment** (note/blocker/question) | ✅ | ✗ (channels only) | **P1** |
| @-mention files/symbols/items → chips | ✅ | ✗ | P2 |
| Add context anchors / targets / refs / attachments | ✅ | ✗ (read-only) | P2 |
| Resolve deviation (accept/ignore/revert) | ✅ | ✅ | — |
| Routing & execution config / guardrails | ✅ | ✗ | P3 |

### Collaboration
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Channel threads — start (6 types), reply, resolve | ✅ | ✅ | — |
| Presence / walkthrough narration | ✅ | ◑ read banner | P2 |
| Connected agents view | ✅ | ✅ | — |
| Input-request response (await_user_input) | ✅ | ✅ | — |
| Handoff to agent / copy-as-prompt | ✅ | ✗ | P2 |

### Graph
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Drill-down browse (overview→dir→file→symbol) | ✅ | ✅ | — |
| Visual interactive map | ✅ file-level | ◑ cluster-level (pan/zoom/tap) | P2 (file-level depth) |
| Trellis Live/Baseline/Planned/Diff | ✅ 4 modes | ◑ Live/Planned/Diverged | P2 (baseline) |
| Node inspect → source preview + git gutter | ✅ | ◑ file detail, no source | P2 |
| Select nodes → plan these / add to task | ✅ | ✗ | P3 |
| Cross-system edges | ✅ | ✅ (file detail) | — |

### Project / Terminal / System
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Open / browse projects | ✅ | ✅ *(now)* | — |
| Multiple project tabs / branch pin / rescan | ✅ | ✗ | P3 |
| Terminal (create, I/O, presets, resize) | ✅ | ✅ (no kill, shell preset only) | ◑ |
| System docs browse/edit | ✅ | ✗ | P3 |
| Plan lifecycle (create/delete/template/import) | ✅ | ✗ | P3 |
| Settings (identity/MCP/sync/data) | ✅ | ◑ pairing only | P3 |
| MCP drives the phone (navigate/screenshot/present) | n/a | ✗ | P2 (M8 part 3) |

## Roadmap (recommended order)

1. **P0 — Notion-clean reading** *(done this pass)*: markdown for plan body,
   item body, comments via a shared `components/Markdown.tsx`; plan Overview
   section. → reads like the desktop pages.
2. **P1 — Lightweight authoring**: edit title/body (a simple markdown editor
   sheet → `plan.update` / `plan.item.update` with a new `body` param), post a
   comment (`add_item_comment` exposed as an RPC), set assignee/blocked/progress.
3. **P1 — Inline chip rendering**: parse `[[item|title]]` / `[[file|name]]` in
   bodies and render tappable chips (markdown-it rule or pre-pass).
4. **P2 — Create items** + @-mention picker; richer graph (file-level nodes,
   baseline mode, source preview); MCP-drives-phone (M8 part 3).
5. **P3 — Lifecycle/admin**: plan create/template/import, system docs, settings,
   multi-tab/branch.

## Notes
- Every desktop authoring action already has an `mcp__codetrellis__*` tool +
  service method; mobile authoring is mostly a matter of exposing thin RPC
  wrappers (`plan.item.update` already exists for status — extend it) and a
  small editor UI. The hard part is UX, not backend.
- Channels are already full parity and are the model for how an authoring
  surface should feel on mobile.
