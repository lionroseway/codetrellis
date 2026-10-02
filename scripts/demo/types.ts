/**
 * The demo's shapes: what a scene is given (`Ctx`) and what it is (`Scene`),
 * and a group of scenes, the unit `--group` runs and the catalogue lists.
 */
import type { ScriptedMcp } from '../../tests/harness/mcp-client';
import type { DemoOptions } from './options';

/** What a shot must see on screen before it is taken. */
export interface ShotExpect {
  /** The reader must be RENDERING this file (not merely have it selected). */
  file?: string;
  /** At least one VISIBLE line on the file carries this verdict. */
  verdict?: 'aligned' | 'drifted' | 'outstanding';
  /** A criterion row a person can see, whose text includes `text`, in this state. */
  criterion?: { text: string; state: 'open' | 'submitted' | 'met' | 'sent_back' | 'stale' };
  /** The recorded-file viewer is showing a file whose name ends with this. */
  artefact?: string;
}

/** An agent connected the way Claude Desktop is: through the stdio connector. */
export interface Bridge {
  call(tool: string, args?: Record<string, unknown>): Promise<CallResult>;
  json(tool: string, args?: Record<string, unknown>): Promise<any>;
}

export interface Ctx {
  call(tool: string, args?: Record<string, unknown>): Promise<CallResult>;
  json(tool: string, args?: Record<string, unknown>): Promise<any>;
  /** Narrate in the app itself, and pause long enough to read it. */
  say(title: string, text: string, tone?: 'neutral' | 'success' | 'warning' | 'question'): Promise<void>;
  beat(multiplier?: number): Promise<void>;
  /**
   * Capture the window — but only once it shows what the shot claims to.
   *
   * A screenshot that cannot say what it is a picture of is not evidence:
   * this scene once captured `app.rb` under a caption claiming it showed
   * `money.go`, and nothing anywhere disagreed. So a shot names its
   * subject (`ShotExpect`), waits for `ui_ready` to report it on screen,
   * and is flagged and not saved when it never is — an image of the wrong
   * thing is worse than no image.
   */
  shot(label: string, expect?: ShotExpect): Promise<void>;
  /** Edit a file; it is restored when the demo ends, however it ends. */
  edit(relative: string, mutate: (src: string) => string): void;
  /**
   * A second (third…) connected agent, for contention journeys. With a
   * binding it is placed in a folder the way a person's agent is: by the
   * MCP roots it offers or the folder it says it runs in.
   */
  agent(name: string, binding?: AgentBinding): Promise<ScriptedMcp>;
  /**
   * Read an HTTP endpoint the way the UI does — same token, same route.
   * Some journeys are about what a panel is shown, and the panel does not
   * go through MCP.
   */
  api(pathAndQuery: string, body?: unknown, method?: 'GET' | 'POST' | 'PUT' | 'DELETE'): Promise<any>;
  /** Connect an agent through the stdio connector, as a person's own agent would. */
  bridge(clientName: string, cwd?: string): Promise<Bridge>;
  /**
   * A call that SHOULD be refused. Same as `call`, but a refusal is the
   * pass and is not flagged — otherwise the refusal journey reports the
   * product working correctly as a defect.
   */
  refuse(tool: string, args?: Record<string, unknown>): Promise<CallResult>;
  flag(message: string): void;
  state: Record<string, string>;
  /** The run's options: the project, the pace, whether to decide for the person. */
  opts: DemoOptions;
  /** Every file this run has edited, with its original text (restored at the end). */
  edits(): ReadonlyMap<string, string>;
  /** `watch`: a person is looking. `check`: no window (CI); narration and shots do nothing. */
  mode: 'watch' | 'check';
  /**
   * Undo, registered where the thing is made: a breakpoint, a worktree, a
   * plan. Run last first when the run ends, however it ends.
   */
  defer(label: string, run: () => unknown): void;
  /** Ask until it answers something truthy, or the time is up (flagged when `what` is given). */
  until<T>(probe: () => Promise<T> | T, seconds: number, what?: string): Promise<T | null>;
  /**
   * A step only a person can take in the window. Asks, then waits for
   * `done`; with --decide (or in check mode) `decide` stands in for them.
   */
  person(step: PersonStep): Promise<boolean>;
}

/** A tool's reply: `answer` is its own first text; a notice an agent is told rides after it in `text`. */
export interface CallResult {
  ok: boolean;
  text: string;
  answer: string;
}

export interface AgentBinding {
  /** MCP roots the agent offers: the folders it works in. */
  roots?: string[];
  /** The folder it says it runs in (the connector's header). */
  cwd?: string;
}

export interface PersonStep {
  /** What to do, in the window's own words. */
  ask: string;
  /** Has it happened? Polled until it has. */
  done: () => Promise<unknown> | unknown;
  /** Stand in for the person (through the desktop's HTTP route). */
  decide?: () => Promise<unknown>;
}

export interface Scene {
  id: string;
  title: string;
  /** Printed before the scene runs: what to look at on screen. */
  watch: string;
  run(ctx: Ctx): Promise<void>;
}

/** Scenes that belong together, in the order they run. One module per group under `groups/`. */
export interface Group {
  id: string;
  title: string;
  /**
   * Run once before the group's first picked scene: make its fixture, open
   * it, register its undo with `c.defer`. So `--scene` works for any scene.
   */
  setup?(c: Ctx): Promise<void>;
  scenes: Scene[];
}
