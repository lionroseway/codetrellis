/**
 * Phase 33 G1 — one visual vocabulary.
 *
 * Every state the graph, the file tree, the plan canvas and the Timeline
 * draw, with the one colour, glyph, dash and word that mean it. Drafted
 * from the 0.3 colour audit, which found amber meaning about twenty things,
 * blue fifteen and violet fourteen, and the same state ("planned", "in
 * progress", "modified") drawn in up to five hues depending on the panel.
 *
 * The rules this module holds the app to:
 * - One hue family per meaning family. A tone is a meaning, not a colour
 *   somebody liked: `attention` is amber because amber means "needs you",
 *   and nothing else may be amber.
 * - Glyph and word are always present, so colour is never the only carrier.
 * - A dash means "not happened yet" (planned), on edges and on outlines.
 * - Selection (white) and the interactive accent are not states.
 *
 * Two hue families are shared on purpose, and `visual-language.test.ts`
 * names them so a third cannot creep in: green for done and git-added
 * (both "good / new"), red for blocked and git-deleted (deleted always
 * carries D/− and a strikethrough).
 *
 * Tailwind finds class names by scanning source text, so every class below
 * is written out in full. Never build one from pieces (`text-${hue}-300`):
 * the scanner cannot see it and the class silently does not exist.
 *
 * Pure data and pure functions, no React: components, lib code and tests
 * all read it.
 */

/** A hue family. Neutral greys carry no meaning by hue; glyph and dash tell them apart. */
export type Hue =
  | 'blue' | 'green' | 'red' | 'amber' | 'orange' | 'violet' | 'fuchsia' | 'sky' | 'cyan'
  | 'indigo' | 'pink' | 'lime' | 'teal' | 'yellow' | 'neutral';

export interface Tone {
  /** The one colour of this token, for SVG, inline styles and the minimap. */
  hex: string;
  /** Its hue family: two tones in one family must be an accepted pair. */
  hue: Hue;
  /** The meaning family, in words. */
  meaning: string;
  /** Glyphs and words on the dark ground. */
  text: string;
  /** Text inside a tinted chip. */
  soft: string;
  /** A tint behind. */
  bg: string;
  border: string;
  /** A solid fill, for a status dot. */
  dot: string;
  ring: string;
  /** A row in a list: soft text on a faint tint. */
  row: string;
  /** A badge on a graph node: border, an opaque dark ground, text. */
  mark: string;
}

export const TONES = {
  active: {
    hex: '#3b82f6', hue: 'blue', meaning: 'happening now: in progress, an agent working',
    text: 'text-blue-400', soft: 'text-blue-100', bg: 'bg-blue-500/15', border: 'border-blue-400/30',
    dot: 'bg-blue-500', ring: 'ring-blue-400/60', row: 'text-blue-100/95 bg-blue-500/6',
    mark: 'border-blue-400/70 bg-blue-950 text-blue-300',
  },
  done: {
    hex: '#22c55e', hue: 'green', meaning: 'done: finished, landed, passing',
    text: 'text-green-400', soft: 'text-green-100', bg: 'bg-green-500/15', border: 'border-green-400/30',
    dot: 'bg-green-500', ring: 'ring-green-400/60', row: 'text-green-100/95 bg-green-500/6',
    mark: 'border-green-400/60 bg-green-950 text-green-300',
  },
  blocked: {
    hex: '#ef4444', hue: 'red', meaning: 'stopped: blocked, failing, breach, high severity',
    text: 'text-red-400', soft: 'text-red-100', bg: 'bg-red-500/15', border: 'border-red-400/40',
    dot: 'bg-red-500', ring: 'ring-red-400/60', row: 'text-red-100/95 bg-red-500/8',
    mark: 'border-red-400/70 bg-red-950 text-red-300',
  },
  attention: {
    hex: '#f59e0b', hue: 'amber', meaning: 'needs you: warning, paused, waiting, medium severity',
    text: 'text-amber-300', soft: 'text-amber-100', bg: 'bg-amber-500/15', border: 'border-amber-400/40',
    dot: 'bg-amber-500', ring: 'ring-amber-400/60', row: 'text-amber-100/95 bg-amber-500/6',
    mark: 'border-amber-400/70 bg-amber-950 text-amber-300',
  },
  planned: {
    hex: '#a78bfa', hue: 'violet', meaning: 'planned: intended, not happened yet',
    text: 'text-violet-300', soft: 'text-violet-100', bg: 'bg-violet-500/15', border: 'border-violet-400/40',
    dot: 'bg-violet-400', ring: 'ring-violet-400/60', row: 'text-violet-100/95 bg-violet-500/6',
    mark: 'border-violet-400/80 bg-violet-950 text-violet-200',
  },
  drift: {
    hex: '#e879f9', hue: 'fuchsia', meaning: 'drift: plan and code disagree (unplanned, missing)',
    text: 'text-fuchsia-300', soft: 'text-fuchsia-100', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-400/40',
    dot: 'bg-fuchsia-400', ring: 'ring-fuchsia-400/60', row: 'text-fuchsia-100/95 bg-fuchsia-500/6',
    mark: 'border-fuchsia-400/70 bg-fuchsia-950 text-fuchsia-300',
  },
  idle: {
    hex: '#71717a', hue: 'neutral', meaning: 'not started, skipped, nothing to say',
    text: 'text-zinc-500', soft: 'text-zinc-300', bg: 'bg-zinc-500/10', border: 'border-zinc-500/25',
    dot: 'bg-zinc-500', ring: 'ring-zinc-500/60', row: 'text-zinc-300 bg-zinc-500/6',
    mark: 'border-white/15 bg-zinc-900 text-zinc-400',
  },
  assigned: {
    hex: '#a1a1aa', hue: 'neutral', meaning: 'has an owner, not started',
    text: 'text-zinc-300', soft: 'text-zinc-100', bg: 'bg-zinc-400/10', border: 'border-zinc-400/30',
    dot: 'bg-zinc-400', ring: 'ring-zinc-400/60', row: 'text-zinc-100 bg-zinc-400/6',
    mark: 'border-zinc-400/50 bg-zinc-900 text-zinc-200',
  },
  added: {
    hex: '#34d399', hue: 'green', meaning: 'git: added, new to git',
    text: 'text-emerald-300', soft: 'text-emerald-100', bg: 'bg-emerald-500/15', border: 'border-emerald-400/30',
    dot: 'bg-emerald-400', ring: 'ring-emerald-400/60', row: 'text-emerald-100/95 bg-emerald-500/6',
    mark: 'border-emerald-400/60 bg-emerald-950 text-emerald-300',
  },
  modified: {
    hex: '#fb923c', hue: 'orange', meaning: 'git: modified, renamed, not staged',
    text: 'text-orange-300', soft: 'text-orange-100', bg: 'bg-orange-500/15', border: 'border-orange-400/30',
    dot: 'bg-orange-400', ring: 'ring-orange-400/60', row: 'text-orange-100/95 bg-orange-500/6',
    mark: 'border-orange-400/60 bg-orange-950 text-orange-300',
  },
  deleted: {
    hex: '#f87171', hue: 'red', meaning: 'git: deleted, removed',
    text: 'text-red-300', soft: 'text-red-100', bg: 'bg-red-500/10', border: 'border-red-300/30',
    dot: 'bg-red-400', ring: 'ring-red-300/60', row: 'text-red-100/95 bg-red-500/6',
    mark: 'border-red-300/60 bg-red-950 text-red-200',
  },
  index: {
    hex: '#38bdf8', hue: 'sky', meaning: 'git: in the index (staged)',
    text: 'text-sky-300', soft: 'text-sky-100', bg: 'bg-sky-500/15', border: 'border-sky-400/30',
    dot: 'bg-sky-400', ring: 'ring-sky-400/60', row: 'text-sky-100/95 bg-sky-500/6',
    mark: 'border-sky-400/60 bg-sky-950 text-sky-300',
  },
  importEdge: {
    hex: '#94a3b8', hue: 'neutral', meaning: 'an import: structure, not news',
    text: 'text-slate-400', soft: 'text-slate-200', bg: 'bg-slate-500/10', border: 'border-slate-400/25',
    dot: 'bg-slate-400', ring: 'ring-slate-400/60', row: 'text-slate-200 bg-slate-500/6',
    mark: 'border-slate-400/50 bg-slate-900 text-slate-300',
  },
  system: {
    hex: '#22d3ee', hue: 'cyan', meaning: 'a cross-system link: http, sql, subprocess, env',
    text: 'text-cyan-300', soft: 'text-cyan-100', bg: 'bg-cyan-500/15', border: 'border-cyan-400/30',
    dot: 'bg-cyan-400', ring: 'ring-cyan-400/60', row: 'text-cyan-100/95 bg-cyan-500/6',
    mark: 'border-cyan-400/60 bg-cyan-950 text-cyan-300',
  },
  affected: {
    hex: '#cbd5e1', hue: 'neutral', meaning: 'in the blast radius of a change',
    text: 'text-slate-300', soft: 'text-slate-100', bg: 'bg-slate-300/10', border: 'border-slate-300/30',
    dot: 'bg-slate-300', ring: 'ring-slate-300/60', row: 'text-slate-100 bg-slate-300/6',
    mark: 'border-slate-300/50 bg-slate-900 text-slate-200',
  },
  link: {
    hex: '#e4e4e7', hue: 'neutral', meaning: 'a file defines a symbol',
    text: 'text-zinc-200', soft: 'text-zinc-100', bg: 'bg-white/5', border: 'border-white/15',
    dot: 'bg-zinc-200', ring: 'ring-white/30', row: 'text-zinc-100 bg-white/4',
    mark: 'border-white/20 bg-zinc-900 text-zinc-200',
  },
  select: {
    hex: '#ffffff', hue: 'neutral', meaning: 'selected or focused',
    text: 'text-white', soft: 'text-white', bg: 'bg-white/10', border: 'border-white/85',
    dot: 'bg-white', ring: 'ring-white/85', row: 'text-white bg-white/8',
    mark: 'border-white/85 bg-zinc-900 text-white',
  },
} as const satisfies Record<string, Tone>;

export type ToneName = keyof typeof TONES;

/**
 * Identity hues: an agent or a workstream, never a state. Reserved so that
 * Claude Code is no longer amber (= needs you) and Codex no longer emerald
 * (= added), as they were before G1 (audit collision 22).
 */
export const IDENTITY_TONES = [
  { hex: '#a5b4fc', hue: 'indigo', text: 'text-indigo-300', stripe: 'border-l-indigo-300' },
  { hex: '#f9a8d4', hue: 'pink', text: 'text-pink-300', stripe: 'border-l-pink-300' },
  { hex: '#bef264', hue: 'lime', text: 'text-lime-300', stripe: 'border-l-lime-300' },
  { hex: '#5eead4', hue: 'teal', text: 'text-teal-300', stripe: 'border-l-teal-300' },
  { hex: '#fef08a', hue: 'yellow', text: 'text-yellow-200', stripe: 'border-l-yellow-200' },
] as const satisfies ReadonlyArray<{ hex: string; hue: Hue; text: string; stripe: string }>;

export type IdentityTone = (typeof IDENTITY_TONES)[number];

/** A stable identity hue for a name (a workstream, a branch): the same name, the same hue. */
export function identityTone(key: string): IdentityTone {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return IDENTITY_TONES[h % IDENTITY_TONES.length];
}

/** Agent types get fixed identity hues, so the same agent reads the same everywhere. */
export const AGENT_IDENTITY = {
  claude: IDENTITY_TONES[0],
  cursor: IDENTITY_TONES[1],
  aider: IDENTITY_TONES[2],
  codex: IDENTITY_TONES[3],
} as const;

/** A tone's colour at an alpha, for inline styles and SVG strokes. */
export function alpha(tone: ToneName | { hex: string }, a: number): string {
  const hex = typeof tone === 'string' ? TONES[tone].hex : tone.hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Border, tint and text for a chip in one tone. */
export function chipClass(tone: ToneName): string {
  const t = TONES[tone];
  return `${t.border} ${t.bg} ${t.soft}`;
}

// ---------------------------------------------------------------------------
// States. Each is a tone, a glyph, a word and, where it is drawn as a line
// or an outline, a dash. `dash` is an SVG dasharray; outlines read
// "dashed" when it is set and "dotted" when the dash is short.
// ---------------------------------------------------------------------------

export interface StateVisual {
  tone: ToneName;
  glyph: string;
  word: string;
  dash?: string;
}

const PLANNED_DASH = '8 8';

/** A task in a plan. */
export const TASK = {
  pending: { tone: 'idle', glyph: '○', word: 'Not started' },
  assigned: { tone: 'assigned', glyph: '◔', word: 'Assigned' },
  in_progress: { tone: 'active', glyph: '◐', word: 'In progress' },
  blocked: { tone: 'blocked', glyph: '■', word: 'Blocked' },
  waiting: { tone: 'attention', glyph: '↑', word: 'Waits on' },
  done: { tone: 'done', glyph: '✓', word: 'Done' },
  skipped: { tone: 'idle', glyph: '»', word: 'Skipped' },
} as const satisfies Record<string, StateVisual>;

/** A task status as the vocabulary draws it; unknown statuses read as not started. */
export function taskState(status: string | null | undefined): StateVisual {
  return (TASK as Record<string, StateVisual>)[status ?? 'pending'] ?? TASK.pending;
}

/** A plan's own status (draft → archived): the same tones as tasks, never amber or blue for "review". */
export const PLAN_STATUS = {
  draft: { tone: 'idle', glyph: '○', word: 'draft' },
  review: { tone: 'planned', glyph: '◎', word: 'in review' },
  approved: { tone: 'assigned', glyph: '◔', word: 'approved' },
  in_progress: { tone: 'active', glyph: '◐', word: 'in progress' },
  completed: { tone: 'done', glyph: '✓', word: 'completed' },
  archived: { tone: 'idle', glyph: '»', word: 'archived' },
} as const satisfies Record<string, StateVisual>;

/** Plan against code: what the plan intends and whether the code agrees. */
export const INTENT = {
  planned: { tone: 'planned', glyph: '◇', word: 'Planned', dash: PLANNED_DASH },
  in_progress: { tone: 'active', glyph: '◐', word: 'In flight' },
  landed: { tone: 'done', glyph: '✓', word: 'Landed' },
  unplanned: { tone: 'drift', glyph: '◆', word: 'Unplanned' },
  missing: { tone: 'drift', glyph: '▲', word: 'Missing', dash: PLANNED_DASH },
} as const satisfies Record<string, StateVisual>;

/** Edges on the graph. Every kind differs from every other by tone, dash or glyph. */
export const EDGE = {
  import: { tone: 'importEdge', glyph: '→', word: 'imports' },
  cross_system: { tone: 'system', glyph: '⇢', word: 'cross-system', dash: '4 3' },
  symbol_link: { tone: 'link', glyph: '·', word: 'defines', dash: '2 4' },
  active: { tone: 'active', glyph: '●', word: 'agent working' },
  planned_add: { tone: 'planned', glyph: '+', word: 'planned', dash: PLANNED_DASH },
  planned_remove: { tone: 'deleted', glyph: '−', word: 'removing', dash: '6 6' },
  added: { tone: 'added', glyph: '+', word: 'added' },
  removed: { tone: 'deleted', glyph: '−', word: 'removed', dash: '1 5' },
  unexpected: { tone: 'drift', glyph: '◆', word: 'unplanned' },
} as const satisfies Record<string, StateVisual>;

export type EdgeState = keyof typeof EDGE;

/** Git state of a file. "A" always means added: staged is a modifier (●), never a letter of its own. */
export const GIT = {
  added: { tone: 'added', glyph: 'A', word: 'added' },
  untracked: { tone: 'added', glyph: 'U', word: 'new to git', dash: '4 4' },
  modified: { tone: 'modified', glyph: 'M', word: 'modified' },
  renamed: { tone: 'modified', glyph: 'R', word: 'renamed' },
  deleted: { tone: 'deleted', glyph: 'D', word: 'deleted' },
  staged: { tone: 'index', glyph: '●', word: 'staged' },
  unstaged: { tone: 'modified', glyph: 'M', word: 'not staged' },
} as const satisfies Record<string, StateVisual>;

/** A git letter (A, M, D, R, U) in its tone: the same letter is the same colour on every panel. */
export function gitLetterText(letter: string): string {
  const state = ({ A: GIT.added, M: GIT.modified, D: GIT.deleted, R: GIT.renamed, U: GIT.untracked } as Record<string, StateVisual>)[letter];
  return state ? TONES[state.tone].text : TONES.idle.text;
}

/** Things that need a person, and things that stopped. */
export const ATTENTION = {
  warning: { tone: 'attention', glyph: '⚠', word: 'Needs you' },
  paused: { tone: 'attention', glyph: '⏸', word: 'Paused', dash: '4 4' },
  collision: { tone: 'attention', glyph: '⚠', word: 'Overlap', dash: '4 4' },
  high: { tone: 'blocked', glyph: '⚠', word: 'High' },
  failing: { tone: 'blocked', glyph: '✗', word: 'Failing' },
  breach: { tone: 'blocked', glyph: '⊘', word: 'Breach' },
  drift: { tone: 'drift', glyph: '◆', word: 'Drift' },
} as const satisfies Record<string, StateVisual>;

/** Test grounding of a file. */
export const TESTS = {
  passing: { tone: 'done', glyph: '✓', word: 'passing' },
  stale: { tone: 'attention', glyph: '⚠', word: 'tests older than the code' },
  untested: { tone: 'idle', glyph: '○', word: 'no tests' },
  failing: { tone: 'blocked', glyph: '✗', word: 'failing' },
} as const satisfies Record<string, StateVisual>;

/** Marks laid over the graph. */
export const MARKS = {
  selection: { tone: 'select', glyph: '', word: 'Selected' },
  footprint: { tone: 'planned', glyph: '◇', word: 'In plan', dash: '4 4' },
  plannedOverlap: { tone: 'planned', glyph: '◇', word: 'Planned overlap', dash: '4 4' },
  affected: { tone: 'affected', glyph: '≈', word: 'Affected', dash: '1 3' },
  agentWorking: { tone: 'active', glyph: '●', word: 'working' },
} as const satisfies Record<string, StateVisual>;

/** Marks on a Timeline lane. Commits are ◉, so ◆ means unplanned and nothing else. */
export const LANE = {
  turn: { tone: 'idle', glyph: '●', word: 'turn' },
  edit: { tone: 'active', glyph: '✎', word: 'edit' },
  commit: { tone: 'link', glyph: '◉', word: 'commit' },
  merge: { tone: 'link', glyph: '⧫', word: 'merge' },
  'check-pass': { tone: 'done', glyph: '✓', word: 'checks passed' },
  'check-fail': { tone: 'blocked', glyph: '✗', word: 'checks failed' },
  signal: { tone: 'attention', glyph: '⚠', word: 'signal' },
  pause: { tone: 'attention', glyph: '⏸', word: 'paused at a breakpoint' },
  breach: { tone: 'blocked', glyph: '⊘', word: 'breach' },
} as const satisfies Record<string, StateVisual>;

/** What one Timeline event intends. */
export const EVENT_INTENT = {
  read: { tone: 'idle', glyph: '·', word: 'read' },
  write: { tone: 'active', glyph: '✎', word: 'write' },
  ask: { tone: 'attention', glyph: '?', word: 'ask' },
  session: { tone: 'idle', glyph: '⏻', word: 'session' },
  error: { tone: 'blocked', glyph: '⚠', word: 'error' },
} as const satisfies Record<string, StateVisual>;

/** A planned file operation (add / modify / remove / move): git's tones, since it describes a file change. */
export const OPERATION = {
  add: { tone: 'added', glyph: '+', word: 'add' },
  modify: { tone: 'modified', glyph: '~', word: 'modify' },
  remove: { tone: 'deleted', glyph: '−', word: 'remove' },
  move: { tone: 'modified', glyph: '→', word: 'move' },
} as const satisfies Record<string, StateVisual>;

/** Every state family, for tests and for the legend (G2). */
export const VOCABULARY = {
  task: TASK, planStatus: PLAN_STATUS, intent: INTENT, edge: EDGE, git: GIT, attention: ATTENTION,
  tests: TESTS, marks: MARKS, lane: LANE, eventIntent: EVENT_INTENT, operation: OPERATION,
} as const;

/** Tailwind text class for a state's tone. */
export function stateText(state: StateVisual): string {
  return TONES[state.tone].text;
}

// ---------------------------------------------------------------------------
// The graph. A node's change status, as the cards, the outlines and the
// minimap draw it.
// ---------------------------------------------------------------------------

export interface NodeChange {
  state: StateVisual;
  /** The chip on the card. Git's own letters stay +, ~, − on a card. */
  symbol: string;
  /** Not happened yet: dashed. */
  planned: boolean;
  /** Border and tinted ground of the glass card. */
  card: string;
}

export const NODE_CHANGE: Record<string, NodeChange> = {
  added: {
    state: GIT.added, symbol: '+', planned: false,
    card: 'border-emerald-300/55 bg-[linear-gradient(180deg,rgba(52,211,153,0.24),rgba(10,20,14,0.58))]',
  },
  planned_add: {
    state: INTENT.planned, symbol: '+', planned: true,
    card: 'border-dashed border-violet-300/45 bg-[linear-gradient(180deg,rgba(167,139,250,0.16),rgba(14,10,26,0.52))]',
  },
  modified: {
    state: GIT.modified, symbol: '~', planned: false,
    card: 'border-orange-300/55 bg-[linear-gradient(180deg,rgba(251,146,60,0.22),rgba(24,12,6,0.56))]',
  },
  planned_modify: {
    state: INTENT.planned, symbol: '~', planned: true,
    card: 'border-dashed border-violet-300/45 bg-[linear-gradient(180deg,rgba(167,139,250,0.16),rgba(14,10,26,0.52))]',
  },
  removed: {
    state: GIT.deleted, symbol: '−', planned: false,
    card: 'border-red-300/50 bg-[linear-gradient(180deg,rgba(248,113,113,0.22),rgba(24,8,8,0.58))]',
  },
  planned_remove: {
    state: { ...GIT.deleted, word: 'planned removal', dash: PLANNED_DASH }, symbol: '−', planned: true,
    card: 'border-dashed border-red-300/45 bg-[linear-gradient(180deg,rgba(248,113,113,0.16),rgba(24,8,8,0.5))]',
  },
  in_progress_task: {
    state: TASK.in_progress, symbol: '◐', planned: false,
    card: '',
  },
  active: {
    state: MARKS.agentWorking, symbol: '●', planned: false,
    card: '',
  },
  affected: {
    state: MARKS.affected, symbol: '≈', planned: false,
    card: '',
  },
  unexpected_live: {
    state: INTENT.unplanned, symbol: '◆', planned: false,
    card: 'border-fuchsia-300/45 bg-[linear-gradient(180deg,rgba(232,121,249,0.2),rgba(24,8,24,0.52))]',
  },
};

/** A node's change status in the vocabulary, or null for none or an unknown one. */
export function nodeChange(changeStatus: unknown): NodeChange | null {
  return typeof changeStatus === 'string' ? NODE_CHANGE[changeStatus] ?? null : null;
}

/** The colour the minimap paints a node: its change status, else neutral structure. */
export function minimapColor(changeStatus: unknown): string {
  const change = nodeChange(changeStatus);
  return change ? alpha(change.state.tone, 0.85) : alpha('importEdge', 0.45);
}

export interface EdgeVisual {
  color: string;
  glow: string;
  dashArray: string | undefined;
  flow: string;
  /** Border, ground and text of the label. */
  label: string;
}

const EDGE_ALPHA: Partial<Record<EdgeState, number>> = {
  import: 0.55, symbol_link: 0.25, cross_system: 0.75, planned_remove: 0.82,
};

/** How an edge in a given state is drawn. Unknown states draw as imports. */
export function edgeVisual(state: string | undefined): EdgeVisual {
  const key: EdgeState = state && state in EDGE ? state as EdgeState : 'import';
  const s: StateVisual = EDGE[key];
  const t = TONES[s.tone];
  const label = key === 'import' || key === 'symbol_link' || key === 'active'
    ? GRAPH_CHROME.edgeLabel
    : key === 'removed' || key === 'planned_remove'
      ? `${chipClass(s.tone)} line-through`
      : chipClass(s.tone);
  return {
    color: alpha(s.tone, EDGE_ALPHA[key] ?? 0.9),
    glow: alpha(s.tone, key === 'symbol_link' ? 0.12 : 0.36),
    dashArray: s.dash,
    flow: t.hex,
    label,
  };
}

/**
 * Language is identity, not state: it colours the file icon and nothing
 * else, never a border, a fill or a glow, so a Python file is not mistaken
 * for an added one. One map for the graph and the Explorer (audit 25).
 */
export const LANGUAGE: Record<string, { hex: string; icon: string; short: string }> = {
  typescript: { hex: '#60a5fa', icon: 'text-blue-400', short: 'TS' },
  javascript: { hex: '#facc15', icon: 'text-yellow-400', short: 'JS' },
  python: { hex: '#4ade80', icon: 'text-green-400', short: 'PY' },
  rust: { hex: '#fb923c', icon: 'text-orange-400', short: 'RS' },
  go: { hex: '#22d3ee', icon: 'text-cyan-400', short: 'GO' },
  css: { hex: '#c084fc', icon: 'text-purple-400', short: 'CSS' },
  json: { hex: '#38bdf8', icon: 'text-sky-400', short: 'JSON' },
  markdown: { hex: '#f472b6', icon: 'text-pink-400', short: 'MD' },
};

export const DEFAULT_LANGUAGE = { hex: '#94a3b8', icon: 'text-slate-400', short: 'FILE' };

export function languageOf(language: string | undefined): { hex: string; icon: string; short: string } {
  return (language && LANGUAGE[language]) || DEFAULT_LANGUAGE;
}

/**
 * The graph's neutral chrome: surfaces, handles, shadows. No meaning, so no
 * hue; kept here so graph components hold no literal colour at all (the
 * guard in `components/graph/no-literal-colours.test.ts`).
 */
export const GRAPH_CHROME = {
  /** The neutral glow of a node with no status. */
  glow: 'rgba(148, 163, 184, 0.2)',
  iconGround: 'rgba(148, 163, 184, 0.1)',
  badge: 'border-white/10 bg-white/6 text-zinc-200',
  glassCard: 'bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.03))]',
  glassShadow: 'shadow-[0_22px_48px_rgba(4,8,20,0.45)]',
  perfGround: 'bg-[#0e1422]',
  perfGroundHex: '#0e1422',
  sheen: 'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,var(--node-glow),transparent_44%)]',
  handle: '!h-2.5 !w-2.5 !border-0 !bg-white/70 !shadow-[0_0_10px_rgba(255,255,255,0.4)]',
  clusterCard: 'bg-[linear-gradient(180deg,rgba(148,163,184,0.14),rgba(8,12,22,0.76))]',
  clusterSheen: 'bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_35%)]',
  directoryCard: 'bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(13,17,28,0.7))]',
  directoryShadow: 'shadow-[0_18px_40px_rgba(0,0,0,0.35)]',
  directorySheen: 'bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.16),transparent_34%)]',
  edgeLabel: 'border-white/10 bg-[#0b1120]/78 text-zinc-100',
  menu: 'bg-[#0d1117]',
  actionBar: 'bg-[#0c0e1a]/95 shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
  /** Glass-mode glow pulse on a focused or live node. */
  pulseShadow: (glow: string) => `0 0 0 1px rgba(255,255,255,0.05) inset, 0 0 28px ${glow}`,
  nodeShadow: (glow: string, related: boolean) =>
    `0 24px 60px rgba(3,7,18,0.48), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 ${related ? 52 : 36}px ${glow}`,
  clusterShadow: (glow: string, related: boolean) => `0 24px 56px rgba(0,0,0,0.46), 0 0 ${related ? 52 : 40}px ${glow}`,
  symbolGround: (perf: boolean) => perf
    ? 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(148,163,184,0.08)), #0e1422'
    : 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(148,163,184,0.08))',
  symbolShadow: '0 16px 36px rgba(0,0,0,0.32), 0 0 22px rgba(148, 163, 184, 0.14)',
  symbolBorder: 'rgba(255, 255, 255, 0.12)',
  symbolIcon: '#cbd5e1',
} as const;

/** Node badges and rings, in the vocabulary's tones. */
export const GRAPH_MARK = {
  breakpoint: `${TONES.attention.mark} shadow-[0_0_10px_rgba(245,158,11,0.35)]`,
  tests: {
    failing: TONES.blocked.mark,
    stale: TONES.attention.mark,
    passing: TONES.done.mark,
    untested: TONES.idle.mark,
  } as Record<string, string>,
  plannedOverlapRing: { quiet: 'border-violet-300/30', serious: 'border-violet-300', normal: 'border-violet-400/80' },
  plannedOverlapBadge: { quiet: 'border-violet-300/30 bg-violet-950 text-violet-300/60', normal: TONES.planned.mark },
  /** An open overlap between workstreams: needs you, so attention, never rose. */
  collisionRing: 'border-amber-400/80',
  collisionBadge: TONES.attention.mark,
  /** Other workstreams' line counts: several identities at once, so neutral. */
  workCount: 'border-white/20 bg-zinc-900 text-zinc-300',
  /** The plan's footprint: planned's dashed violet, not the accent blue selection uses. */
  footprintGlass: 'ring-1 ring-violet-400/50 shadow-[0_0_16px_rgba(167,139,250,0.3)]',
  footprintPulse: 'border border-dashed border-violet-400/50',
  footprintCluster: 'ring-2 ring-violet-400/60 shadow-[0_0_28px_rgba(167,139,250,0.4)]',
  taskNumber: 'border-white/15 bg-white/8 text-zinc-100',
  done: `${chipClass('done')} shadow-[0_0_18px_rgba(34,197,94,0.28)]`,
  direction: 'border-white/15 bg-white/8 text-zinc-100',
  modeChip: 'border-white/10 bg-white/6 text-zinc-200',
} as const;
