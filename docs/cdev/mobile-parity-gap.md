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
| Inline `[[item/file/symbol]]` chips in bodies | ✅ | ✅ *(now — MarkdownBody chips)* | **P1 done** |
| Channel/event messages as markdown | ✅ | ✅ *(now)* | **P2 done** |

### Authoring / editing (the biggest track)
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Edit plan/item **title** | ✅ inline autosave | ✅ *(now)* | **P1 done** |
| Edit plan/item **body** | ✅ markdown editor | ✅ *(now — body-editor)* | **P1 done** |
| Change item **status** | ✅ | ✅ | — |
| Set assignee / blocked / progress | ✅ | ✅ *(now)* | **P1 done** |
| **Create** page/task/subtask | ✅ slash + tree | ✅ *(now — ItemCreator)* | **P2 done** |
| Post **comment** (note/blocker/question) | ✅ | ✅ *(now)* | **P1 done** |
| @-mention files/symbols/items → chips | ✅ | ◑ RefPicker in body-editor | P2 |
| Add context anchors / targets / refs / attachments | ✅ | ◑ refs (now); anchors/attachments ✗ | P2 |
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
| Node inspect → source preview + git gutter | ✅ | ◑ source preview *(now)*, no git gutter | P2 |
| Select nodes → plan these / add to task | ✅ | ✗ | P3 |
| Cross-system edges | ✅ | ✅ (file detail) | — |

### Project / Terminal / System
| Capability | Desktop | Mobile | Priority |
|---|---|---|---|
| Open / browse projects | ✅ | ✅ *(now)* | — |
| Multiple project tabs / branch pin / rescan | ✅ | ✗ | P3 |
| Terminal (create, I/O, presets, resize) | ✅ | ✅ *(kill now)*; shell preset only | ◑ |
| System docs browse/edit | ✅ | ✗ | P3 |
| Plan lifecycle (create/delete/template/import) | ✅ | ◑ create/delete *(now)*; template/import ✗ | P3 |
| Settings (identity/MCP/sync/data) | ✅ | ◑ pairing only | P3 |
| MCP drives the phone (navigate/screenshot/present) | n/a | ✅ *(M8 part 3)* | **done** |

## Roadmap (recommended order)

1. ~~**P0 — Notion-clean reading**~~ **✅ done**: markdown for plan body, item
   body, comments via a shared `components/Markdown.tsx`; plan Overview section.
   → reads like the desktop pages.
2. ~~**P1 — Lightweight authoring**~~ **✅ done**: edit title/body (markdown
   editor sheet → `plan.update` / `plan.item.update` with `body`), post a
   comment (`comment.add` RPC), set assignee/blocked/progress.
3. ~~**P1 — Inline chip rendering**~~ **✅ done**: `[[item|title]]` /
   `[[file|name]]` parsed into tappable chips (`MarkdownBody`).
4. **P2 — mostly done**: ✅ create items (`ItemCreator`), ✅ refs authoring,
   ✅ source preview, ✅ MCP-drives-phone (M8 part 3). _Remaining:_ @-mention
   picker for inline body chips; richer graph (file-level nodes, baseline mode);
   handoff / copy-as-prompt; presence walkthrough depth.
5. **P3 — Lifecycle/admin** _(remaining track)_: ✅ plan create/delete; _todo:_
   template/import, system docs, settings (identity/MCP/sync/data),
   multi-tab/branch pin, routing & execution guardrails.

### What's left after this pass
All P0/P1 and the high-value P2 gaps are closed. The outstanding work is the
**P3 admin/lifecycle tail** plus a few P2 polish items:
- **Settings screen** on mobile (identity / MCP / sync / data) — currently
  pairing-only.
- **System docs** browse/edit.
- **Plan template + import**; **multi-project tabs**, branch pin, rescan.
- **Graph depth**: file-level visual nodes + baseline mode + git gutter.
- **Handoff**: copy-plan-as-prompt / hand to agent from the phone.
- **@-mention** inline chip insertion in the body editor (RefPicker covers
  external links today).
- **Infra**: off-LAN / TURN relay, real-device + Android testing, EAS cloud
  build (needs the user's Apple/Google accounts), store assets.

## Notes
- Every desktop authoring action already has an `mcp__codetrellis__*` tool +
  service method; mobile authoring is mostly a matter of exposing thin RPC
  wrappers (`plan.item.update` already exists for status — extend it) and a
  small editor UI. The hard part is UX, not backend.
- Channels are already full parity and are the model for how an authoring
  surface should feel on mobile.
