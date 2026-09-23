/**
 * Plan item tools — Object/Action CRUD, comments, attachments, external refs,
 * intelligence (suggest_specs, get_plan_summary), timeline, versioning.
 *
 * Phase 15 §C unified surface — Objects (durable context) and Actions
 * (graph-anchored work items) share one item tree.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { noteItemFocus } from '../../services/budget-service';
import { describeReference, findReferenceMatches } from '../../services/reference-service';
import { parseReference, formatReference } from '../../../shared/lib/references';
import { resultWithMeta, authorFromExtra } from '../helpers';

// ── Reusable schemas ──────────────────────────────────────────────────

const fileEditSchema = z.object({
  lineRange: z.object({
    start: z.number().int().min(1),
    end: z.number().int().min(1),
  }).optional(),
  symbol: z.string().optional().describe('AST symbol name; resolves via the symbols table.'),
  instruction: z.string().describe('Free-form natural language for the agent.'),
  intent: z.enum(['add', 'modify', 'remove', 'replace']).optional(),
});

const itemFileSpecSchema = z.object({
  path: z.string(),
  action: z.enum(['create', 'modify', 'delete', 'move']),
  moveTo: z.string().optional(),
  isDir: z.boolean().optional(),
  description: z.string().optional(),
  edits: z.array(fileEditSchema).optional().describe('M2 per-file granular edits (line/symbol-pinned).'),
});

const symbolSpecSchema = z.object({
  name: z.string().describe('Symbol name (function, class, etc.)'),
  kind: z.enum(['function', 'class', 'interface', 'type', 'method', 'enum']),
  action: z.enum(['add', 'modify', 'remove', 'move']),
  filePath: z.string().optional().describe('Project-relative path of the file the symbol lives in.'),
  description: z.string().optional(),
  signature: z.string().optional().describe('e.g. "signToken(payload: JwtPayload, secret: string): string"'),
  moveTo: z.string().optional().describe('Target file if action is "move".'),
});

const planItemEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
});

const planItemKindEnum = z.enum(['object', 'action']);
const taskStatusEnum = z.enum(['pending', 'assigned', 'in_progress', 'done', 'blocked', 'skipped']);
const itemCommentKindEnum = z.enum(['note', 'blocker', 'progress', 'question']);
const attachmentKindEnum = z.enum(['url', 'image', 'video', 'file_ref', 'code_block', 'transcript']);

export function register(server: McpServer, deps: ToolDeps): void {
  // --- add_item ---

  server.registerTool(
    'add_item',
    {
      description:
        'Create an Object (durable context) or Action (graph-anchored work item) inside a plan. ' +
        'Trees mix freely: Action can have an Object child (its references), Object can have an Action child (an embedded todo). ' +
        'Action-only fields (status, fileSpecs, scope_path, …) are silently ignored on Objects. Phase 15 §C unified surface.',
      inputSchema: {
        plan_uid: z.string(),
        kind: planItemKindEnum,
        parent_uid: z.string().optional().describe('Omit for top-level. Trees mix Object + Action.'),
        title: z.string(),
        body: z.string().optional().describe('Markdown body.'),
        template: z.string().optional().describe(
          'Object: executive_summary | references | ux_journey | competitor_analysis | architecture | patterns | …'
          + ' Action: phase | leaf | custom.'
        ),
        sort_order: z.number().int().optional().describe('Pinned position; auto-derived if omitted.'),
        status: taskStatusEnum.optional(),
        scope_path: z.string().optional(),
        file_specs: z.array(itemFileSpecSchema).optional(),
        new_connections: z.array(planItemEdgeSchema).optional(),
        removed_connections: z.array(planItemEdgeSchema).optional(),
        dependencies: z.array(z.string()).optional().describe('Other Action uids that must complete first.'),
        visibility: z.enum(['shared', 'local']).optional().describe(
          'Per-item sharing. `shared` (default) exports this item via git. `local` keeps it in the DB only.',
        ),
        override_parent_visibility: z.boolean().optional().describe(
          'Keep this item shared even if its parent is local. The item appears top-level on disk.',
        ),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.createItem({
        planUid: args.plan_uid,
        kind: args.kind,
        parentUid: args.parent_uid ?? null,
        sortOrder: args.sort_order,
        title: args.title,
        body: args.body ?? '',
        template: args.template ?? null,
        status: args.status,
        scopePath: args.scope_path ?? null,
        fileSpecs: args.file_specs,
        newConnections: args.new_connections,
        removedConnections: args.removed_connections,
        dependencies: args.dependencies,
        visibility: args.visibility,
        overrideParentVisibility: args.override_parent_visibility,
        author: id.author,
        authorType: id.authorType,
      });
      const n = deps.broadcast('plan-item-created', { planUid: item.planUid, item });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- bulk_add_items ---

  server.registerTool(
    'bulk_add_items',
    {
      description:
        'Create multiple Objects and/or Actions in one call. Items are created in array order. ' +
        'Use _temp_uid in an item and reference it as parent_uid in later items to build nested trees in a single call. ' +
        'Returns the created items with their real UIDs.',
      inputSchema: {
        plan_uid: z.string(),
        items: z.array(z.object({
          _temp_uid: z.string().optional().describe('Temporary ID for referencing as parent_uid in later items in this batch'),
          kind: planItemKindEnum,
          parent_uid: z.string().optional().describe('Real UID or _temp_uid of a preceding item in this batch'),
          title: z.string(),
          body: z.string().optional(),
          template: z.string().optional(),
          sort_order: z.number().int().optional(),
          status: taskStatusEnum.optional(),
          scope_path: z.string().optional(),
          file_specs: z.array(itemFileSpecSchema).optional(),
          symbol_specs: z.array(symbolSpecSchema).optional().describe('Symbol-level targets for this item.'),
          new_connections: z.array(planItemEdgeSchema).optional(),
          removed_connections: z.array(planItemEdgeSchema).optional(),
          dependencies: z.array(z.string()).optional(),
        })),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const tempToReal = new Map<string, string>();
      const created: any[] = [];
      let lastN = 0;
      for (const raw of args.items) {
        let parentUid = raw.parent_uid ?? null;
        if (parentUid && tempToReal.has(parentUid)) {
          parentUid = tempToReal.get(parentUid)!;
        }
        const item = deps.planItemService.createItem({
          planUid: args.plan_uid,
          kind: raw.kind,
          parentUid,
          sortOrder: raw.sort_order,
          title: raw.title,
          body: raw.body ?? '',
          template: raw.template ?? null,
          status: raw.status,
          scopePath: raw.scope_path ?? null,
          fileSpecs: raw.file_specs,
          symbolSpecs: raw.symbol_specs,
          newConnections: raw.new_connections,
          removedConnections: raw.removed_connections,
          dependencies: raw.dependencies,
          author: id.author,
          authorType: id.authorType,
        });
        if (raw._temp_uid) tempToReal.set(raw._temp_uid, item.uid);
        const n = deps.broadcast('plan-item-created', { planUid: item.planUid, item });
        created.push({ _temp_uid: raw._temp_uid ?? null, uid: item.uid, title: item.title, kind: item.kind });
        lastN = n;
      }
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ created: created.length, items: created }, lastN);
    },
  );

  // --- get_item ---

  server.registerTool(
    'get_item',
    {
      description: 'Fetch a single plan_items row without children / attachments / comments. Lightweight. Use read_item_full for the bundle.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const item = deps.planItemService.getItem(uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${uid} not found` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
    },
  );

  // --- read_item_full ---

  server.registerTool(
    'read_item_full',
    {
      description:
        'One round-trip context bundle: item + parent (if any) + immediate children + attachments + comments + acceptance criteria + recent versions. ' +
        'Use this when picking up an Action so you don\'t need separate calls for context.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const item = deps.planItemService.getItem(uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${uid} not found` }] };
      await deps.artefactService.refreshArtefactHashes(uid).catch(() => []);
      const parent = item.parentUid ? deps.planItemService.getItem(item.parentUid) : null;
      const children = deps.planItemService.getChildren(item.planUid, uid);
      const attachments = deps.taskAttachmentsService.listItemAttachments(uid);
      const comments = deps.commentService.listItemComments(uid);
      const versions = deps.planItemService.listItemVersions(uid).slice(0, 10);
      const criteria = criteriaForAgent(deps, uid);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ item, parent, children, attachments, comments, criteria, versions }, null, 2),
        }],
      };
    },
  );

  // --- update_item ---

  server.registerTool(
    'update_item',
    {
      description:
        'Update any field on an Object or Action. Content edits (body, title, status, fileSpecs, …) write a row to plan_item_versions; ' +
        'structural edits (parent_uid, sort_order) emit plan_events but skip the version log. ' +
        'Pass empty string for nullable fields (parent_uid, scope_path, blocked_reason) to clear.',
      inputSchema: {
        uid: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
        template: z.string().optional(),
        status: taskStatusEnum.optional(),
        assignee: z.string().optional(),
        progress_percent: z.number().int().min(0).max(100).optional(),
        blocked_reason: z.string().optional(),
        scope_path: z.string().optional(),
        file_specs: z.array(itemFileSpecSchema).optional(),
        symbol_specs: z.array(symbolSpecSchema).optional().describe(
          'Top-level symbol-level targets. Declare which symbols (functions, classes, etc.) this action touches. ' +
          'Complementary to file_specs — use file_specs for file-level intent and symbol_specs for symbol-level precision.',
        ),
        new_connections: z.array(planItemEdgeSchema).optional(),
        removed_connections: z.array(planItemEdgeSchema).optional(),
        dependencies: z.array(z.string()).optional(),
        parent_uid: z.string().optional().describe('Re-parent. Empty string detaches to top-level.'),
        sort_order: z.number().int().optional(),
        change_summary: z.string().optional(),
        visibility: z.enum(['shared', 'local']).optional().describe(
          'Per-item sharing. `shared` (default) exports this item to .codetrellis/plans/<slug>/items/ ' +
            'and rides via git. `local` keeps the item in the local DB only — won\'t appear in commits or ' +
            'reach teammates. Use when you have personal scratch / exploratory items in an otherwise-shared plan.',
        ),
        override_parent_visibility: z.boolean().optional().describe(
          'Escape hatch: keep this item `shared` even when its parent is `local`. The item appears at the top ' +
            'level on disk (its parent isn\'t there to anchor it). The in-DB tree remains nested.',
        ),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.updateItem(args.uid, {
        title: args.title,
        body: args.body,
        template: args.template,
        status: args.status,
        assignee: args.assignee,
        progressPercent: args.progress_percent,
        blockedReason: args.blocked_reason === '' ? null : args.blocked_reason,
        scopePath: args.scope_path === '' ? null : args.scope_path,
        fileSpecs: args.file_specs,
        symbolSpecs: args.symbol_specs,
        newConnections: args.new_connections,
        removedConnections: args.removed_connections,
        dependencies: args.dependencies,
        parentUid: args.parent_uid === undefined ? undefined : (args.parent_uid === '' ? null : args.parent_uid),
        sortOrder: args.sort_order,
        changeSummary: args.change_summary,
        visibility: args.visibility,
        overrideParentVisibility: args.override_parent_visibility,
        author: id.author,
        authorType: id.authorType,
      });
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      // Phase 23 — moving an item to in_progress is the other way an
      // agent tells us what it is working on. Agents that set status
      // directly never call claim_item, and their time would otherwise
      // land on the plan with no item attached.
      if (args.status === 'in_progress') {
        try {
          noteItemFocus(deps.sessionId, item.uid, item.planUid);
        } catch { /* accounting must never break an update */ }
      }
      const n = deps.broadcast('plan-item-updated', { planUid: item.planUid, itemUid: item.uid, kind: item.kind, changes: args });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- move_item ---

  server.registerTool(
    'move_item',
    {
      description: 'Re-parent and/or reorder an item. Single plan_events row written for the combined move.',
      inputSchema: {
        uid: z.string(),
        new_parent_uid: z.string().optional().describe('Empty string detaches to top-level.'),
        new_sort_order: z.number().int().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.moveItem(args.uid, {
        newParentUid: args.new_parent_uid === undefined ? undefined : (args.new_parent_uid === '' ? null : args.new_parent_uid),
        newSortOrder: args.new_sort_order,
        author: id.author,
        authorType: id.authorType,
      });
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      const n = deps.broadcast('plan-item-moved', {
        planUid: item.planUid,
        itemUid: item.uid,
        toParentUid: item.parentUid,
        sortOrder: item.sortOrder,
      });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  // --- delete_item ---

  server.registerTool(
    'delete_item',
    {
      description:
        'Delete an item. Default cascades to descendants. The full subtree is snapshotted in the plan_events row\'s ' +
        'before_state so a future restore_item can put it back. Append-only soft-delete.',
      inputSchema: {
        uid: z.string(),
        cascade: z.boolean().optional().describe('Default true. Pass false to fail the call when children exist.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const target = deps.planItemService.getItem(args.uid);
      if (!target) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      if (args.cascade === false) {
        const children = deps.planItemService.getChildren(target.planUid, target.uid);
        if (children.length > 0) {
          return { content: [{ type: 'text' as const, text: `Item has ${children.length} children; pass cascade=true to remove the subtree.` }] };
        }
      }
      const cascadedUids = deps.planItemService.deleteItem(args.uid, {
        cascade: args.cascade !== false,
        author: id.author,
        authorType: id.authorType,
      });
      const n = deps.broadcast('plan-item-deleted', { planUid: target.planUid, itemUid: args.uid, cascadedUids });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ ok: true, deleted: cascadedUids }, n);
    },
  );

  // --- claim_item ---

  server.registerTool(
    'claim_item',
    {
      description:
        'Atomically claim an Action (only succeeds if status=pending and unclaimed). Errors politely on Objects. ' +
        'Returns full item context (item + parent + children + attachments + comments) in the success payload, ' +
        'plus a `conflicts` list when other in-progress Actions touch overlapping files. ' +
        'Respects claim policies (human-only, assigned, agent-type restrictions) and skill requirements.',
      inputSchema: {
        uid: z.string(),
        agent_type: z.string().optional(),
        model: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const capabilities = deps.sessionService.getSessionCapabilities(deps.sessionId);
      const result = deps.planItemService.claimItem(
        args.uid,
        args.agent_type ?? id.author,
        args.agent_type ?? 'mcp',
        args.model,
        capabilities,
      );
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }
      const item = deps.planItemService.getItem(args.uid);
      const parent = item?.parentUid ? deps.planItemService.getItem(item.parentUid) : null;
      const children = item ? deps.planItemService.getChildren(item.planUid, item.uid) : [];
      const attachments = deps.taskAttachmentsService.listItemAttachments(args.uid);
      const comments = deps.commentService.listItemComments(args.uid);
      let n = 0;
      if (item) {
        // Phase 23 — a claim is the moment we learn what this session's
        // time is being spent on. Without it, time lands on the plan but
        // not on any item, and "which item ate the budget" has no answer.
        try {
          noteItemFocus(deps.sessionId, item.uid, item.planUid);
        } catch { /* accounting must never break a claim */ }

        n = deps.broadcast('plan-item-claimed', {
          planUid: item.planUid,
          itemUid: item.uid,
          agentId: args.agent_type ?? id.author,
          agentType: args.agent_type ?? 'mcp',
        });
        if (result.conflicts) {
          deps.broadcast('conflict-detected', { planUid: item.planUid, itemUid: item.uid, message: result.conflicts.join('; ') });
        }
      }
      deps.saveNow(() => deps.exportDatabase());
      const message = result.conflicts
        ? `Item claimed. WARNING: ${result.conflicts.join('; ')}`
        : `Item ${args.uid} claimed.`;
      const criteria = item ? criteriaForAgent(deps, item.uid) : [];
      return resultWithMeta({ ok: true, message, conflicts: result.conflicts ?? null, item, parent, children, attachments, comments, criteria }, n);
    },
  );

  // --- get_next_item ---

  server.registerTool(
    'get_next_item',
    {
      description:
        'Get the next claimable Action from a plan. Respects dependency order and approval gates. ' +
        'When an approval gate blocks the next item, returns a `gated` payload telling you to wait.',
      inputSchema: {
        plan_uid: z.string(),
        parent_uid: z.string().optional().describe('Scope to children of a specific item. Omit for all.'),
      },
    },
    async (args) => {
      const parentFilter = args.parent_uid === undefined
        ? undefined
        : (args.parent_uid === '' ? null : args.parent_uid);
      const result = deps.planItemService.getNextItem(args.plan_uid, parentFilter);
      if (result.gated) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              available: false,
              reason: result.gated.reason,
              gated_item_uid: result.gated.itemUid,
              gated_item_title: result.gated.itemTitle,
            }, null, 2),
          }],
        };
      }
      if (!result.item) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No items available — all claimed, completed, or blocked by dependencies.',
          }],
        };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.item, null, 2) }] };
    },
  );

  // --- approve_gate ---

  server.registerTool(
    'approve_gate',
    {
      description:
        'Retired. Sign-off is a person\'s decision, taken in CodeTrellis or on a paired phone — no MCP tool can make it. ' +
        'Use submit_criterion to offer evidence against the item\'s criteria; the person approves or sends it back.',
      inputSchema: {
        uid: z.string().describe('The item uid. Ignored — this tool always refuses.'),
      },
    },
    async () => ({
      content: [{
        type: 'text' as const,
        text:
          'approve_gate is retired: sign-off happens in CodeTrellis or on a paired phone, never over MCP. ' +
          'Call list_criteria to see what this item is judged on, and submit_criterion to offer evidence for each.',
      }],
      isError: true,
    }),
  );

  // --- Phase 31 §4.1–4.3: acceptance criteria ---

  server.registerTool(
    'record_artefact',
    {
      description:
        'Record a file that matters to an item: a "material" it was given (a spreadsheet, a guide), an "output" the work ' +
        'produced (the report you wrote), or "evidence" captured to prove something. The path must be a file inside the ' +
        'item\'s project (absolute or relative); it is hashed, so a person\'s approval later notices if it changes. ' +
        'Types: pdf, images, video, xlsx/xls/xlsm/csv, docx, pptx, md/txt/json/log, html. Returns the attachment uid ' +
        'to cite in submit_criterion.',
      inputSchema: {
        item_uid: z.string(),
        path: z.string().describe('A file inside the item\'s project.'),
        role: z.enum(['material', 'output', 'evidence']),
        note: z.string().optional().describe('A label for the file, e.g. what it is.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      try {
        const artefact = await deps.artefactService.recordArtefact({
          itemUid: args.item_uid,
          path: args.path,
          role: args.role,
          note: args.note ?? null,
          actor: { author: id.author, authorType: id.authorType },
        });
        deps.startArtefactWatching(artefact);
        const item = deps.planItemService.getItem(args.item_uid);
        const n = deps.broadcast('plan-item-criteria-changed', { planUid: item?.planUid ?? null, itemUid: args.item_uid });
        deps.saveNow(() => deps.exportDatabase());
        return resultWithMeta({
          attachment_uid: artefact.uid, path: artefact.path, role: artefact.role, sha256: artefact.sha256, size: artefact.size,
        }, n);
      } catch (err) {
        if (err instanceof deps.artefactService.ArtefactError) {
          return { content: [{ type: 'text' as const, text: err.message }], isError: true };
        }
        throw err;
      }
    },
  );

  server.registerTool(
    'list_criteria',
    {
      description:
        'The acceptance criteria an item is judged on: verbatim text, kind (what evidence satisfies it), policy ' +
        '(agent = your submission marks it met; propose / human = a person decides), state, and — when a person sent it ' +
        'back — their note. Read this before you claim an item is done.',
      inputSchema: { item_uid: z.string() },
    },
    async ({ item_uid }) => {
      if (!deps.planItemService.getItem(item_uid)) {
        return { content: [{ type: 'text' as const, text: `Item ${item_uid} not found` }], isError: true };
      }
      // A criterion approved on a file that has since changed reads `stale`.
      await deps.artefactService.refreshArtefactHashes(item_uid).catch(() => []);
      return { content: [{ type: 'text' as const, text: JSON.stringify(criteriaForAgent(deps, item_uid), null, 2) }] };
    },
  );

  server.registerTool(
    'add_criterion',
    {
      description:
        'Add an acceptance criterion to an item, in the requester\'s own words — do not reword what they asked for. ' +
        'It starts at policy "propose" (a person decides; "manual" ones are always a person\'s), and only a person can change that.',
      inputSchema: {
        item_uid: z.string(),
        text: z.string().describe('The criterion, verbatim.'),
        kind: z.enum(['manual', 'artefact', 'citation', 'code', 'test']).optional()
          .describe('What evidence satisfies it. Default manual (a judgement).'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      try {
        const criterion = deps.criteriaService.addCriterionAsAgent(
          args.item_uid, { text: args.text, kind: args.kind }, { author: id.author, authorType: id.authorType },
        );
        const n = broadcastCriteria(deps, args.item_uid);
        deps.saveNow(() => deps.exportDatabase());
        return resultWithMeta(slimCriterion(criterion), n);
      } catch (err) {
        return criterionError(deps, err);
      }
    },
  );

  server.registerTool(
    'submit_criterion',
    {
      description:
        'Offer evidence that a criterion is met: files recorded on the same item with record_artefact, each with an ' +
        'optional locator — {sheet, range}, {page}, {t}, {lines} or {text} — plus a note saying what shows it. ' +
        'The criterion\'s mechanical checks run first and a submission that fails one is refused with the list, so ' +
        'call check_criterion with the same evidence until it passes. On an "agent"-policy criterion a passing ' +
        'submission marks it met; otherwise it waits for a person, who approves or sends it back with a note.',
      inputSchema: {
        criterion_uid: z.string(),
        evidence: z.array(z.object({
          attachment_uid: z.string(),
          locator: z.record(z.string(), z.unknown()).optional(),
        })).optional(),
        note: z.string().optional().describe('What in the evidence shows this criterion is met.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      try {
        const { criterion } = await deps.criterionLoop.submitChecked(
          args.criterion_uid,
          {
            evidence: (args.evidence ?? []).map((e) => ({ attachmentUid: e.attachment_uid, locator: e.locator })),
            note: args.note ?? null,
          },
          { author: id.author, authorType: id.authorType },
        );
        const n = broadcastCriteria(deps, criterion.itemUid);
        deps.saveNow(() => deps.exportDatabase());
        return resultWithMeta(slimCriterion(criterion), n);
      } catch (err) {
        return criterionError(deps, err);
      }
    },
  );

  // --- Phase 31 §8: the loops ---

  server.registerTool(
    'check_criterion',
    {
      description:
        'Run a criterion\'s mechanical checks and say, in words, what fails: an output file that is missing or older ' +
        'than the item, a citation to a sheet, range, page, line or quote the file does not have, a test report that is ' +
        'stale or red, code the item names that has not changed. Pass the evidence you are about to submit to check it ' +
        'first; with none, it checks the latest submission and the item\'s recorded files. Loop — work, check, fix — ' +
        'until ok is true, then submit_criterion. "unverified" findings are not failures. Nothing is recorded.',
      inputSchema: {
        criterion_uid: z.string(),
        evidence: z.array(z.object({
          attachment_uid: z.string(),
          locator: z.record(z.string(), z.unknown()).optional(),
        })).optional().describe('What you intend to submit. Omit to check what is already there.'),
      },
    },
    async (args) => {
      try {
        const result = await deps.criterionLoop.checkCriterion(
          args.criterion_uid,
          args.evidence?.map((e) => ({ attachmentUid: e.attachment_uid, locator: e.locator })),
        );
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          ok: result.ok,
          findings: result.findings.map((f) => ({ status: f.status, message: f.message })),
        }, null, 2) }] };
      } catch (err) {
        return criterionError(deps, err);
      }
    },
  );

  server.registerTool(
    'get_worklist',
    {
      description:
        'Everything you owe on a plan, in the order to work it: criteria a person sent back (their note, the evidence ' +
        'and place it points at, and a reference such as "task 9f2c41ab" to quote), criteria gone stale because a file ' +
        'changed after approval, submissions whose checks now fail, and criteria not started. Criteria waiting on a ' +
        'person are counted, not listed. Call this when you resume work on a plan.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }) => {
      if (!deps.planService.getPlan(plan_uid)) {
        return { content: [{ type: 'text' as const, text: `Plan ${plan_uid} not found` }], isError: true };
      }
      const list = await deps.criterionLoop.getWorklist(plan_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        owed: list.entries.map((e) => ({
          reason: e.reason,
          criterion_uid: e.criterionUid,
          item: e.itemRef,
          item_title: e.itemTitle,
          criterion: e.text,
          kind: e.kind,
          policy: e.policy,
          ...(e.note ? { note: e.note } : {}),
          ...(e.anchors.length ? { points_at: e.anchors.map((a) => ({ attachment_uid: a.attachmentUid, path: a.path, locator: a.locator })) } : {}),
          ...(e.details.length ? { details: e.details } : {}),
        })),
        waiting_for_person: list.waitingForPerson,
        met: list.met,
        total: list.total,
      }, null, 2) }] };
    },
  );

  server.registerTool(
    'run_checks',
    {
      description:
        'Re-hash every recorded file on a plan and re-run every criterion\'s checks, and record the run so it can be ' +
        'compared with the next one. Says what moved since the last run ("2 went stale — Q3-sales.xlsx changed"). ' +
        'A check run never approves anything: it can only report a criterion stale or failing.',
      inputSchema: { plan_uid: z.string() },
    },
    async ({ plan_uid }, extra: any) => {
      if (!deps.planService.getPlan(plan_uid)) {
        return { content: [{ type: 'text' as const, text: `Plan ${plan_uid} not found` }], isError: true };
      }
      const id = authorFromExtra(deps, extra);
      const run = await deps.criterionLoop.runCheckRun({
        planUid: plan_uid, trigger: 'manual', by: id.author, byType: id.authorType,
      });
      const n = deps.broadcast('plan-check-run', { planUid: plan_uid, runUid: run.uid });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({
        run_uid: run.uid,
        since_last: run.sinceLast,
        criteria: run.outcomes.length,
        failing: run.outcomes.filter((o) => !o.ok).map((o) => ({ criterion_uid: o.criterionUid, criterion: o.text, failures: o.failures })),
        stale: run.outcomes.filter((o) => o.state === 'stale').map((o) => ({ criterion_uid: o.criterionUid, criterion: o.text, changed: o.changedFiles })),
      }, n);
    },
  );

  // --- list_items ---

  server.registerTool(
    'list_items',
    {
      description:
        'Query items in a plan. Returns title + kind + status + sortOrder + childCount per item (no bodies). ' +
        'Filter by parent_uid (one level), kind, status, or title substring. Use limit/offset for large plans.',
      inputSchema: {
        plan_uid: z.string(),
        parent_uid: z.string().optional().describe('Pass empty string for top-level only. Omit to get the whole plan.'),
        kind: planItemKindEnum.optional(),
        status: taskStatusEnum.optional().describe('Filter to items with this status'),
        title_contains: z.string().optional().describe('Case-insensitive substring match on title'),
        limit: z.number().int().min(1).max(500).optional().describe('Max items to return (default 100)'),
        offset: z.number().int().min(0).optional().describe('Skip this many items (default 0)'),
      },
    },
    async (args) => {
      let all = deps.planItemService.listItemSummaries(args.plan_uid);
      if (args.parent_uid !== undefined) {
        const targetParent = args.parent_uid === '' ? null : args.parent_uid;
        all = all.filter((i: any) => i.parentUid === targetParent);
      }
      if (args.kind) all = all.filter((i: any) => i.kind === args.kind);
      if (args.status) all = all.filter((i: any) => i.status === args.status);
      if (args.title_contains) {
        const q = args.title_contains.toLowerCase();
        all = all.filter((i: any) => i.title.toLowerCase().includes(q));
      }
      const total = all.length;
      const start = args.offset ?? 0;
      const end = start + (args.limit ?? 100);
      const page = all.slice(start, end);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ total, offset: start, limit: args.limit ?? 100, items: page }, null, 2) }] };
    },
  );

  // --- search_items ---

  server.registerTool(
    'search_items',
    {
      description:
        'Search item titles and bodies within a plan. Returns matches with a short excerpt around the hit. ' +
        'Case-insensitive substring match.',
      inputSchema: {
        plan_uid: z.string(),
        query: z.string().describe('Search string (case-insensitive substring)'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
      },
    },
    async ({ plan_uid, query, limit }) => {
      const db = deps.getDb();
      const q = `%${query}%`;
      const r = db.exec(
        `SELECT uid, title, body, kind, status, parent_uid FROM plan_items
         WHERE plan_uid = ? AND (title LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE)
         ORDER BY updated_at DESC
         LIMIT ?`,
        [plan_uid, q, q, limit ?? 20],
      );
      if (!r[0]) return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results: [] }, null, 2) }] };
      const results = r[0].values.map((row: any[]) => {
        const body = (row[2] as string) || '';
        const lowerBody = body.toLowerCase();
        const idx = lowerBody.indexOf(query.toLowerCase());
        const excerptStart = Math.max(0, idx - 60);
        const excerptEnd = Math.min(body.length, idx + query.length + 60);
        const excerpt = idx >= 0
          ? (excerptStart > 0 ? '...' : '') + body.slice(excerptStart, excerptEnd) + (excerptEnd < body.length ? '...' : '')
          : '';
        return { uid: row[0], title: row[1], excerpt, kind: row[3], status: row[4], parentUid: row[5] };
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results }, null, 2) }] };
    },
  );

  // --- get_plan_timeline ---

  server.registerTool(
    'get_plan_timeline',
    {
      description:
        'Read the plan_events log — every structural mutation (item created/moved/deleted/renamed/reparented/reordered/status_changed/restored). ' +
        'Drives the activity rail and the timeline scrubber. Filter with since_ms / kinds / limit.',
      inputSchema: {
        plan_uid: z.string(),
        since_ms: z.number().int().optional(),
        kinds: z.array(z.string()).optional().describe('Filter to specific event types.'),
        limit: z.number().int().min(1).max(2000).optional(),
      },
    },
    async (args) => {
      const events = deps.planEventService.listPlanEvents(args.plan_uid, {
        sinceMs: args.since_ms,
        eventTypes: args.kinds as any,
        limit: args.limit,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(events, null, 2) }] };
    },
  );

  // --- restore_item_version ---

  server.registerTool(
    'restore_item_version',
    {
      description:
        'Restore an item to a prior version from plan_item_versions. Writes a new version row and emits a plan_events: item_restored event.',
      inputSchema: {
        uid: z.string(),
        version: z.number().int().min(1),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.restoreItemVersion(args.uid, args.version, id.author, id.authorType);
      if (!item) {
        return { content: [{ type: 'text' as const, text: `Could not restore — item or version not found.` }] };
      }
      const n = deps.broadcast('plan-item-version-saved', { planUid: item.planUid, itemUid: item.uid, restoredFrom: args.version });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(item, n);
    },
  );

  server.registerTool(
    'list_item_versions',
    {
      description:
        'List all saved versions of an item, ordered by version number. Each version captures the item\'s body, title, status, ' +
        'and structured fields (fileSpecs, symbolSpecs, connections) at the time of each update. Use this to see how an item evolved.',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const versions = deps.planItemService.listItemVersions(uid);
      if (versions.length === 0) {
        return { content: [{ type: 'text' as const, text: `No versions found for item ${uid}` }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(versions, null, 2) }] };
    },
  );

  // --- Item Comments ---

  // What a person pasted. "task 9f2c41ab isn't right — I've left notes" is
  // how people steer agents; this is the call that turns it into the thing
  // and the notes. Every other tool also accepts references directly (they
  // are resolved in mcp/server.ts), so this is for orientation, not a
  // required first step.
  server.registerTool(
    'resolve_reference',
    {
      description:
        'Look up a CodeTrellis reference a person gave you — e.g. "task 9f2c41ab", "plan 1c0d9e22", "comment 7b3a…" '
        + 'or a bare 8+ character id — and get what it is: kind, full uid, title, its plan, its status, and the most recent '
        + 'notes people left on it. Use this first when someone says a task is not done right. Every other tool also accepts '
        + 'these references wherever it takes a uid.',
      inputSchema: {
        ref: z.string().describe('The reference as given, e.g. "task 9f2c41ab".'),
      },
    },
    async ({ ref }) => {
      const parsed = parseReference(ref);
      if (!parsed) {
        const text = `"${ref}" is not a reference. References look like "task 9f2c41ab": a kind and at least 8 hex characters.`;
        return { content: [{ type: 'text' as const, text }], isError: true };
      }
      const matches = findReferenceMatches(parsed);
      if (matches.length === 0) {
        return { content: [{ type: 'text' as const, text: `Nothing matches "${ref}".` }], isError: true };
      }
      if (matches.length > 1) {
        const text = JSON.stringify({
          ambiguous: true,
          candidates: matches.map((m) => ({ reference: formatReference(m.kind, m.uid), uid: m.uid, title: m.title })),
          hint: 'Ask which one is meant, or use the full uid.',
        }, null, 2);
        return { content: [{ type: 'text' as const, text }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(describeReference(matches[0]), null, 2) }] };
    },
  );

  server.registerTool(
    'list_item_comments',
    {
      description:
        'Read all comments on an item, ordered chronologically. Each comment carries kind (note/blocker/progress/question) + source (agent/human) + optional metadata (e.g. progressPercent).',
      inputSchema: { uid: z.string() },
    },
    async ({ uid }) => {
      const comments = deps.commentService.listItemComments(uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }] };
    },
  );

  server.registerTool(
    'add_item_comment',
    {
      description:
        'Leave a structured comment on an item. kind=note/blocker/progress/question; source=agent (auto-set). ' +
        'For blockers prefer set_item_blocked (which also flips status); for progress prefer update_item_progress (which also stamps progressPercent on the item).',
      inputSchema: {
        uid: z.string(),
        kind: itemCommentKindEnum,
        body: z.string(),
        parent_comment_uid: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      const legacyType =
        args.kind === 'progress' ? 'status_update' :
        args.kind === 'blocker' ? 'concern' :
        args.kind === 'question' ? 'suggestion' : 'comment';
      const comment = deps.commentService.addComment('item', args.uid, id.author, id.authorType, args.body, {
        kind: args.kind,
        source: 'agent',
        commentType: legacyType,
        parentUid: args.parent_comment_uid,
      });
      const n = deps.broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta(comment, n);
    },
  );

  server.registerTool(
    'update_item_progress',
    {
      description:
        'Mid-task progress heartbeat. Updates the Action\'s progressPercent column AND emits a kind=progress comment with metadata.progressPercent. ' +
        'Call frequently during long Actions so the human sees movement.',
      inputSchema: {
        uid: z.string(),
        percent: z.number().int().min(0).max(100),
        message: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      if (item.kind !== 'action') {
        return { content: [{ type: 'text' as const, text: 'Progress only applies to Actions (not Objects).' }] };
      }
      deps.planItemService.updateItem(args.uid, {
        progressPercent: args.percent,
        author: id.author,
        authorType: id.authorType,
      });
      const body = args.message?.trim() || `Progress: ${args.percent}%`;
      const comment = deps.commentService.addComment('item', args.uid, id.author, id.authorType, body, {
        kind: 'progress',
        source: 'agent',
        commentType: 'status_update',
        metadata: { progressPercent: args.percent },
      });
      const n = deps.broadcast('plan-item-progress', { planUid: item.planUid, itemUid: args.uid, percent: args.percent, message: body, commentUid: comment.uid });
      deps.broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ uid: args.uid, percent: args.percent, message: body }, n);
    },
  );

  server.registerTool(
    'set_item_blocked',
    {
      description:
        'Mark an Action blocked with a reason. Sets status=blocked, stores blockedReason on the row, and emits a kind=blocker comment so the activity rail surfaces it. ' +
        'Prefer this over silently stopping — humans see blockers prominently and can intervene.',
      inputSchema: {
        uid: z.string(),
        reason: z.string(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      if (item.kind !== 'action') {
        return { content: [{ type: 'text' as const, text: 'Only Actions can be blocked (not Objects).' }] };
      }
      deps.planItemService.updateItem(args.uid, {
        status: 'blocked',
        blockedReason: args.reason,
        author: id.author,
        authorType: id.authorType,
      });
      const comment = deps.commentService.addComment('item', args.uid, id.author, id.authorType, args.reason, {
        kind: 'blocker',
        source: 'agent',
        commentType: 'concern',
      });
      const n = deps.broadcast('plan-item-blocked', { planUid: item.planUid, itemUid: args.uid, reason: args.reason, commentUid: comment.uid });
      deps.broadcast('plan-item-updated', { planUid: item.planUid, itemUid: args.uid, kind: 'action', changes: { status: 'blocked' } });
      deps.broadcast('plan-item-comment-added', { planUid: item.planUid, itemUid: args.uid, comment });
      deps.saveNow(() => deps.exportDatabase());
      return resultWithMeta({ uid: args.uid, status: 'blocked', reason: args.reason }, n);
    },
  );

  // --- Attachments ---

  server.registerTool(
    'add_item_attachment',
    {
      description:
        'Pin a URL / image / file_ref / code_block / transcript to an item. For images with raw bytes, pass data_base64 + content_type + project_root and the file lands under <project_root>/.codetrellis/attachments/<item_uid>/<uid>.<ext>.',
      inputSchema: {
        uid: z.string(),
        kind: attachmentKindEnum,
        value: z.string(),
        label: z.string().optional(),
        content_type: z.string().optional(),
        data_base64: z.string().optional(),
        project_root: z.string().optional(),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.getItem(args.uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.uid} not found` }] };
      try {
        const attachment = deps.taskAttachmentsService.addAttachment({
          targetType: 'item',
          targetUid: args.uid,
          kind: args.kind,
          value: args.value,
          label: args.label,
          contentType: args.content_type,
          dataBase64: args.data_base64,
          projectRoot: args.project_root,
          author: id.author,
          authorType: id.authorType,
        });
        const n = deps.broadcast('plan-item-attachment-added', { planUid: item.planUid, itemUid: args.uid, attachment });
        deps.saveNow(() => deps.exportDatabase());
        return resultWithMeta(attachment, n);
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.registerTool(
    'delete_item_comment',
    {
      description: 'Delete a comment from a plan item by its UID.',
      inputSchema: {
        comment_uid: z.string().describe('UID of the comment to delete.'),
      },
    },
    async ({ comment_uid }) => {
      const ok = deps.commentService.deleteComment(comment_uid);
      if (!ok) {
        return { content: [{ type: 'text' as const, text: `Comment ${comment_uid} not found` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: `Deleted comment ${comment_uid}` }] };
    },
  );

  server.registerTool(
    'delete_item_attachment',
    {
      description: 'Delete an attachment from a plan item by its UID.',
      inputSchema: {
        attachment_uid: z.string().describe('UID of the attachment to delete.'),
      },
    },
    async ({ attachment_uid }) => {
      const ok = deps.taskAttachmentsService.deleteAttachment(attachment_uid);
      if (!ok) {
        return { content: [{ type: 'text' as const, text: `Attachment ${attachment_uid} not found` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: `Deleted attachment ${attachment_uid}` }] };
    },
  );

  // --- External References ---

  server.registerTool(
    'list_external_refs',
    {
      description: 'List external references (GitHub issues, PRs, Jira tickets, Figma frames, etc.) linked to a plan item.',
      inputSchema: {
        item_uid: z.string().describe('The plan item uid to list refs for.'),
      },
    },
    async (args) => {
      const refs = deps.externalRefsService.getExternalRefs(args.item_uid);
      return { content: [{ type: 'text' as const, text: JSON.stringify(refs, null, 2) }] };
    },
  );

  server.registerTool(
    'add_external_ref',
    {
      description:
        'Link an external resource (GitHub issue, PR, Jira ticket, Figma frame, any URL) to a plan item. ' +
        'The kind is auto-detected from the URL pattern.',
      inputSchema: {
        item_uid: z.string().describe('The plan item uid to link the ref to.'),
        url: z.string().describe('The URL of the external resource.'),
        title: z.string().optional().describe('Display title. Auto-extracted from URL if omitted.'),
        kind: z.enum([
          'github_issue', 'github_pr', 'github_commit',
          'jira', 'linear', 'figma', 'notion', 'slack', 'url',
        ] as const).optional().describe('Reference kind. Auto-detected if omitted.'),
      },
    },
    async (args, extra: any) => {
      const id = authorFromExtra(deps, extra);
      const item = deps.planItemService.getItem(args.item_uid);
      if (!item) return { content: [{ type: 'text' as const, text: `Item ${args.item_uid} not found` }] };
      try {
        const ref = deps.externalRefsService.createExternalRef({
          itemUid: args.item_uid,
          url: args.url,
          title: args.title,
          kind: args.kind,
          author: id.author,
          authorType: id.authorType,
        });
        deps.broadcast('external-ref-added', { ref });
        deps.saveNow(() => deps.exportDatabase());
        return { content: [{ type: 'text' as const, text: JSON.stringify(ref, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : err}` }] };
      }
    },
  );

  server.registerTool(
    'remove_external_ref',
    {
      description: 'Remove an external reference from a plan item.',
      inputSchema: {
        uid: z.string().describe('The external ref uid to remove.'),
      },
    },
    async (args) => {
      deps.externalRefsService.deleteExternalRef(args.uid);
      deps.broadcast('external-ref-deleted', { uid: args.uid });
      deps.saveNow(() => deps.exportDatabase());
      return { content: [{ type: 'text' as const, text: `Removed external ref ${args.uid}` }] };
    },
  );

  // --- Intelligence Tools ---

  server.registerTool(
    'suggest_specs',
    {
      description:
        'Query the codebase graph for a given scope (directory or file path) and return candidate fileSpecs and symbolSpecs. ' +
        'Use this to populate an Action\'s fileSpecs/symbolSpecs based on what actually exists in the codebase — avoids guessing file paths or symbol names. ' +
        'Returns files under the scope, their symbols, and dependency edges (imports in + out).',
      inputSchema: {
        scope_path: z.string().describe('Relative path prefix to scope the query (e.g. "src/backend/services" or "src/frontend/stores/plan-store.ts"). Matches files whose relative_path starts with this string.'),
        include_symbols: z.boolean().optional().describe('Include symbols (functions, classes, etc) for each file. Default true.'),
        include_deps: z.boolean().optional().describe('Include import edges (in/out) for each file. Default true.'),
        limit: z.number().int().min(1).max(200).optional().describe('Max files to return. Default 50.'),
      },
    },
    async ({ scope_path, include_symbols, include_deps, limit }) => {
      const db = deps.getDb();
      const maxFiles = limit ?? 50;
      const wantSymbols = include_symbols !== false;
      const wantDeps = include_deps !== false;

      const filesResult = db.exec(
        `SELECT id, path, relative_path, language FROM files
         WHERE relative_path LIKE ? OR relative_path = ?
         ORDER BY relative_path
         LIMIT ?`,
        [`${scope_path}%`, scope_path, maxFiles],
      );
      if (!filesResult[0]) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ scopePath: scope_path, files: [], message: 'No files found under this scope' }, null, 2) }] };
      }

      const files = filesResult[0].values.map((row: any[]) => {
        const fileId = row[0] as number;
        const filePath = row[1] as string;
        const relativePath = row[2] as string;
        const language = row[3] as string;

        const entry: Record<string, unknown> = {
          path: relativePath,
          language,
          suggestedFileSpec: { path: relativePath, action: 'modify', description: '' },
        };

        if (wantSymbols) {
          const syms = db.exec(
            `SELECT name, kind, start_line, end_line FROM symbols
             WHERE file_id = ? AND parent_symbol_id IS NULL
             ORDER BY start_line`,
            [fileId],
          );
          if (syms[0]) {
            entry.symbols = syms[0].values.map((s: any[]) => ({
              name: s[0] as string,
              kind: s[1] as string,
              startLine: s[2] as number,
              endLine: s[3] as number,
              suggestedSymbolSpec: {
                name: s[0] as string,
                kind: s[1] as string,
                action: 'modify',
                filePath: relativePath,
                description: '',
              },
            }));
          }
        }

        if (wantDeps) {
          const importsOut = db.exec(
            `SELECT f2.relative_path, i.specifiers FROM imports i
             JOIN files f2 ON i.resolved_path = f2.path
             WHERE i.file_id = ? AND i.resolved_path IS NOT NULL
             LIMIT 30`,
            [fileId],
          );
          const importsIn = db.exec(
            `SELECT f1.relative_path, i.specifiers FROM imports i
             JOIN files f1 ON i.file_id = f1.id
             WHERE i.resolved_path = ?
             LIMIT 30`,
            [filePath],
          );
          if (importsOut[0]) {
            entry.imports = importsOut[0].values.map((r: any[]) => ({
              target: r[0], specifiers: JSON.parse((r[1] as string) || '[]'),
            }));
          }
          if (importsIn[0]) {
            entry.importedBy = importsIn[0].values.map((r: any[]) => ({
              source: r[0], specifiers: JSON.parse((r[1] as string) || '[]'),
            }));
          }
        }

        return entry;
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            scopePath: scope_path,
            fileCount: files.length,
            files,
            hint: 'Copy suggestedFileSpec / suggestedSymbolSpec into your add_item fileSpecs / symbolSpecs and fill in the description + action fields.',
          }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'get_plan_summary',
    {
      description:
        'Returns plan health in a single call: completion percentage, status breakdown, blocked/pending/done counts, ' +
        'deviation count, and comment activity. Use this for a quick dashboard view before diving into details.',
      inputSchema: {
        plan_uid: z.string(),
      },
    },
    async ({ plan_uid }) => {
      const plan = deps.planService.getPlan(plan_uid);
      if (!plan) return { content: [{ type: 'text' as const, text: 'Plan not found' }] };

      const items = deps.planItemService.listItemSummaries(plan_uid);
      const objects = items.filter((i: any) => i.kind === 'object');
      const actions = items.filter((i: any) => i.kind === 'action');

      const statusCounts: Record<string, number> = {};
      for (const a of actions) {
        const s = (a as any).status ?? 'pending';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      }

      const doneCount = statusCounts['done'] ?? 0;
      const blockedCount = statusCounts['blocked'] ?? 0;
      const inProgressCount = statusCounts['in_progress'] ?? 0;
      const pendingCount = statusCounts['pending'] ?? 0;
      const totalActions = actions.length;
      const completionPercent = totalActions > 0 ? Math.round((doneCount / totalActions) * 100) : 0;

      let progressSum = 0;
      for (const a of actions) {
        if ((a as any).status === 'done') progressSum += 100;
        else if ((a as any).progressPercent != null) progressSum += (a as any).progressPercent;
      }
      const weightedProgress = totalActions > 0 ? Math.round(progressSum / totalActions) : 0;

      const deviations = deps.getDeviations(plan_uid);
      const pendingDeviations = deviations.filter((d: any) => d.resolution === 'pending');

      const oneDayAgo = Date.now() - 86400000;
      const recentComments = deps.commentService.listCommentsForPlanSince(plan_uid, oneDayAgo);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            plan: { uid: plan.uid, title: plan.title, status: plan.status },
            items: {
              total: items.length,
              objects: objects.length,
              actions: totalActions,
            },
            progress: {
              completionPercent,
              weightedProgress,
              byStatus: statusCounts,
              done: doneCount,
              inProgress: inProgressCount,
              blocked: blockedCount,
              pending: pendingCount,
            },
            deviations: {
              total: deviations.length,
              pending: pendingDeviations.length,
            },
            recentActivity: {
              commentsLast24h: recentComments.length,
              blockers: recentComments.filter((c: any) => c.kind === 'blocker').length,
              questions: recentComments.filter((c: any) => c.kind === 'question').length,
            },
          }, null, 2),
        }],
      };
    },
  );
}

// ── criteria helpers ──────────────────────────────────────────────────

type AgentCriterion = ReturnType<ToolDeps['criteriaService']['listCriteria']>[number];

/** What an agent needs from a criterion — no internal bookkeeping. */
function slimCriterion(c: AgentCriterion) {
  return {
    uid: c.uid,
    text: c.text,
    kind: c.kind,
    policy: c.policy,
    state: c.state,
    sent_back_note: c.state === 'sent_back' ? c.latestSignoff?.note ?? null : null,
    decided_by: c.latestSignoff ? { actor: c.latestSignoff.actor, actor_type: c.latestSignoff.actorType } : null,
  };
}

function criteriaForAgent(deps: ToolDeps, itemUid: string) {
  return deps.criteriaService.listCriteria(itemUid).map(slimCriterion);
}

function broadcastCriteria(deps: ToolDeps, itemUid: string): number {
  const item = deps.planItemService.getItem(itemUid);
  return deps.broadcast('plan-item-criteria-changed', { planUid: item?.planUid ?? null, itemUid });
}

function criterionError(deps: ToolDeps, err: unknown) {
  if (err instanceof deps.criteriaService.CriterionError) {
    return { content: [{ type: 'text' as const, text: err.message }], isError: true };
  }
  throw err;
}
