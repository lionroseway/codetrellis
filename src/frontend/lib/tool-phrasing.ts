import type { AgentEvent } from '@shared/types';

/**
 * Plain-English phrasing for agent events — Phase 22, change B.
 *
 * See [docs/PHASE-22-AGENT-ACTIVITY-CLARITY.md](../../../docs/PHASE-22-AGENT-ACTIVITY-CLARITY.md).
 *
 * The timeline used to render an MCP tool call as its raw payload JSON,
 * because `formatPayload` only knew the shapes the Claude Code JSONL
 * watcher produces. So a row read:
 *
 *   {"tool":"update_item","args":"{\"uid\":\"itm_4f…\",\"status\":\"in_p…
 *
 * from which a user is expected to infer what the agent is doing. Nobody
 * does that inference. A row should read as a sentence about the work:
 *
 *   Started "Add refresh-token rotation"
 *
 * Unknown tools degrade to a readable fallback rather than throwing or
 * dumping JSON — a tool shipping without a phrasing should look plain,
 * not broken.
 */

export interface PhrasedEvent {
  /** One sentence describing what happened. */
  text: string;
  /** `read`, `write`, `ask`, `session`, `error` — drives the icon. */
  intent: EventIntent;
  /** The raw tool name, for the disclosure. Null for non-MCP events. */
  tool: string | null;
  /** True when the event changed something rather than observing it. */
  mutating: boolean;
}

export type EventIntent = 'read' | 'write' | 'ask' | 'session' | 'error';

interface ToolPhrasing {
  intent: EventIntent;
  mutating: boolean;
  /** Build the sentence. `args` is already parsed and never null. */
  phrase: (args: Record<string, unknown>) => string;
}

/** `itm_4f3a…` is noise in a sentence; a title is not. */
function subject(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === 'string' && v.trim() && !/^(itm|pln|doc|evt)_/.test(v)) {
      return `"${v.length > 60 ? `${v.slice(0, 57)}…` : v}"`;
    }
  }
  // Fall back to a short uid so the row still identifies something.
  for (const key of keys) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return `${v.slice(0, 12)}…`;
  }
  return 'an item';
}

const STATUS_VERB: Record<string, string> = {
  in_progress: 'Started',
  done: 'Finished',
  blocked: 'Blocked',
  pending: 'Reset',
  cancelled: 'Cancelled',
};

/**
 * Tool → sentence. Mutating tools describe intent; reading tools
 * describe a lookup. Both matter, but only the first kind explains what
 * an agent is *doing*.
 */
const TOOL_PHRASINGS: Record<string, ToolPhrasing> = {
  // ── Plan items: the ones that describe intent ──────────────────────
  update_item: {
    intent: 'write',
    mutating: true,
    phrase: (a) => {
      const status = typeof a.status === 'string' ? a.status : null;
      const verb = status ? (STATUS_VERB[status] ?? `Set ${status} on`) : 'Updated';
      return `${verb} ${subject(a, 'title', 'uid', 'item_uid')}`;
    },
  },
  add_item: {
    intent: 'write',
    mutating: true,
    phrase: (a) => `Added ${subject(a, 'title', 'uid')}`,
  },
  bulk_add_items: {
    intent: 'write',
    mutating: true,
    phrase: (a) => {
      const items = Array.isArray(a.items) ? a.items.length : null;
      return items ? `Added ${items} items` : 'Added several items';
    },
  },
  delete_item: { intent: 'write', mutating: true, phrase: (a) => `Deleted ${subject(a, 'title', 'uid')}` },
  move_item: { intent: 'write', mutating: true, phrase: (a) => `Moved ${subject(a, 'title', 'uid')}` },
  claim_item: { intent: 'write', mutating: true, phrase: (a) => `Claimed ${subject(a, 'title', 'uid')}` },
  set_item_blocked: { intent: 'write', mutating: true, phrase: (a) => `Blocked ${subject(a, 'title', 'uid')}` },
  update_item_progress: {
    intent: 'write',
    mutating: true,
    phrase: (a) => {
      const pct = typeof a.progress === 'number' ? ` to ${a.progress}%` : '';
      return `Moved ${subject(a, 'title', 'uid')}${pct}`;
    },
  },
  add_item_comment: { intent: 'write', mutating: true, phrase: (a) => `Commented on ${subject(a, 'title', 'uid')}` },

  // ── Plans ─────────────────────────────────────────────────────────
  create_plan: { intent: 'write', mutating: true, phrase: (a) => `Created plan ${subject(a, 'title')}` },
  create_plan_from_template: {
    intent: 'write',
    mutating: true,
    phrase: (a) => `Created plan ${subject(a, 'title')} from the ${String(a.template_id ?? 'a')} template`,
  },
  update_plan: { intent: 'write', mutating: true, phrase: (a) => `Updated plan ${subject(a, 'title', 'plan_uid')}` },
  delete_plan: { intent: 'write', mutating: true, phrase: (a) => `Deleted plan ${subject(a, 'title', 'plan_uid')}` },
  set_active_plan: { intent: 'session', mutating: false, phrase: (a) => `Switched to plan ${subject(a, 'title', 'plan_uid')}` },
  export_plan_to_files: { intent: 'write', mutating: true, phrase: (a) => `Exported plan ${subject(a, 'plan_uid')} to disk` },

  // ── Asking the human ──────────────────────────────────────────────
  post_channel_event: {
    intent: 'ask',
    mutating: true,
    phrase: (a) => {
      const type = typeof a.event_type === 'string' ? a.event_type : 'note';
      const what: Record<string, string> = {
        stuck: 'Reported being stuck',
        'need-decision': 'Asked for a decision',
        'need-context': 'Asked for context',
        'handing-off': 'Handed off',
        steer: 'Gave direction',
        'weigh-in': 'Asked for a second opinion',
      };
      const msg = typeof a.message === 'string' && a.message ? `: ${a.message.slice(0, 60)}` : '';
      return `${what[type] ?? 'Posted a note'}${msg}`;
    },
  },
  await_user_input: { intent: 'ask', mutating: false, phrase: () => 'Waiting for your answer' },
  await_ack: { intent: 'ask', mutating: false, phrase: () => 'Waiting for acknowledgement' },
  approve_gate: { intent: 'error', mutating: false, phrase: (a) => `Tried to clear the approval gate on ${subject(a, 'uid')} — refused, sign-off is yours` },
  record_artefact: { intent: 'write', mutating: true, phrase: (a) => `Recorded ${({ material: 'a material', output: 'an output', evidence: 'evidence' } as Record<string, string>)[String(a.role)] ?? 'a file'}: ${subject(a, 'path')}` },
  list_criteria: { intent: 'read', mutating: false, phrase: (a) => `Read the criteria for ${subject(a, 'item_uid')}` },
  add_criterion: { intent: 'write', mutating: true, phrase: (a) => `Added a criterion: ${subject(a, 'text')}` },
  submit_criterion: { intent: 'ask', mutating: true, phrase: (a) => `Submitted evidence for ${subject(a, 'criterion_uid')}` },

  // ── Reading ───────────────────────────────────────────────────────
  search_symbols: { intent: 'read', mutating: false, phrase: (a) => `Looked for \`${String(a.query ?? '')}\`` },
  search_items: { intent: 'read', mutating: false, phrase: (a) => `Searched the plan for \`${String(a.query ?? '')}\`` },
  get_dependencies: { intent: 'read', mutating: false, phrase: (a) => `Checked what depends on ${String(a.file_path ?? a.path ?? 'a file')}` },
  check_architecture: { intent: 'read', mutating: false, phrase: () => 'Checked the architecture' },
  check_conformity: { intent: 'read', mutating: false, phrase: () => 'Checked conformity' },
  get_drift_report: { intent: 'read', mutating: false, phrase: () => 'Checked for drift' },
  get_next_item: { intent: 'read', mutating: false, phrase: () => 'Asked what to work on next' },
  get_item: { intent: 'read', mutating: false, phrase: (a) => `Read ${subject(a, 'title', 'uid')}` },
  resolve_reference: { intent: 'read', mutating: false, phrase: (a) => `Looked up ${subject(a, 'ref')}` },
  read_item_full: { intent: 'read', mutating: false, phrase: (a) => `Read ${subject(a, 'title', 'uid')} in full` },
  get_plan: { intent: 'read', mutating: false, phrase: (a) => `Read plan ${subject(a, 'title', 'plan_uid')}` },
  list_items: { intent: 'read', mutating: false, phrase: () => 'Listed plan items' },
  list_plans: { intent: 'read', mutating: false, phrase: () => 'Listed plans' },
  read_system_doc: { intent: 'read', mutating: false, phrase: (a) => `Read the ${String(a.doc_type ?? 'system')} doc` },
  list_cross_system_edges: { intent: 'read', mutating: false, phrase: () => 'Checked cross-system links' },

  // ── Session ───────────────────────────────────────────────────────
  register_session: { intent: 'session', mutating: false, phrase: (a) => `${String(a.agent_type ?? 'An agent')} connected` },
  open_project: { intent: 'session', mutating: false, phrase: (a) => `Opened ${String(a.path ?? 'a project')}` },
  rescan_project: { intent: 'session', mutating: false, phrase: () => 'Rescanned the project' },

  // ── System docs + git ─────────────────────────────────────────────
  write_system_doc: { intent: 'write', mutating: true, phrase: (a) => `Wrote the ${String(a.doc_type ?? 'system')} doc` },
  commit_manifest_changes: { intent: 'write', mutating: true, phrase: () => 'Committed plan changes' },
  set_freeze: {
    intent: 'write',
    mutating: true,
    phrase: (a) => (a.active === false ? 'Lifted the freeze' : 'Started a freeze'),
  },
};

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* a truncated or unserialisable arg string is not worth failing over */
    }
  }
  return {};
}

/** `update_item` → `Update item`. The last-resort readable form. */
function humaniseToolName(tool: string): string {
  const words = tool.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Turn one agent event into a sentence.
 *
 * Handles both event families: MCP `tool_call` / `tool_error` (any
 * agent), and the Claude Code session-JSONL events, which carry
 * read/write/edit/bash actions instead of tool names.
 */
export function phraseEvent(event: AgentEvent): PhrasedEvent {
  const payload = event.payload ?? {};

  // ── MCP tool events ───────────────────────────────────────────────
  const tool = typeof payload.tool === 'string' ? payload.tool : null;
  if (tool && (event.type === 'tool_call' || event.type === 'tool_error')) {
    const args = parseArgs(payload.args);
    const phrasing = TOOL_PHRASINGS[tool];

    if (event.type === 'tool_error') {
      const err = typeof payload.error === 'string' ? `: ${payload.error.slice(0, 80)}` : '';
      return {
        text: `${humaniseToolName(tool)} failed${err}`,
        intent: 'error',
        tool,
        mutating: false,
      };
    }

    if (phrasing) {
      return { text: phrasing.phrase(args), intent: phrasing.intent, tool, mutating: phrasing.mutating };
    }

    // No phrasing for this tool. Readable, not raw JSON — and obvious
    // enough that a newly added tool gets noticed.
    return { text: humaniseToolName(tool), intent: 'read', tool, mutating: false };
  }

  // ── Claude Code session-JSONL events ──────────────────────────────
  const file = typeof payload.file === 'string' ? payload.file.split('/').pop() : null;
  switch (payload.action) {
    case 'read':
      return { text: `Read ${file ?? 'a file'}`, intent: 'read', tool: null, mutating: false };
    case 'write':
      return { text: `Wrote ${file ?? 'a file'}`, intent: 'write', tool: null, mutating: true };
    case 'edit':
      return { text: `Edited ${file ?? 'a file'}`, intent: 'write', tool: null, mutating: true };
    case 'bash':
      return {
        text: `Ran \`${String(payload.command ?? '').slice(0, 60)}\``,
        intent: 'write',
        tool: null,
        mutating: true,
      };
    default:
      break;
  }

  if (typeof payload.tool === 'string' && payload.pattern) {
    return {
      text: `${payload.tool === 'Grep' ? 'Searched for' : 'Looked for files matching'} \`${String(payload.pattern)}\``,
      intent: 'read',
      tool: null,
      mutating: false,
    };
  }

  if (event.type === 'session_start') return { text: 'Session started', intent: 'session', tool: null, mutating: false };
  if (event.type === 'session_end') return { text: 'Session ended', intent: 'session', tool: null, mutating: false };

  const message = payload.message ?? payload.text;
  if (typeof message === 'string' && message.trim()) {
    return { text: message.slice(0, 120), intent: 'read', tool: null, mutating: false };
  }

  return { text: humaniseToolName(event.type), intent: 'read', tool: null, mutating: false };
}

/** The raw payload, for the row's disclosure. Never throws. */
export function rawPayloadText(event: AgentEvent): string {
  try {
    return JSON.stringify(event.payload, null, 2);
  } catch {
    return String(event.payload);
  }
}
