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
  call(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  json(tool: string, args?: Record<string, unknown>): Promise<any>;
}

export interface Ctx {
  call(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
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
  /** A second (third…) connected agent, for contention journeys. */
  agent(name: string): Promise<ScriptedMcp>;
  /**
   * Read an HTTP endpoint the way the UI does — same token, same route.
   * Some journeys are about what a panel is shown, and the panel does not
   * go through MCP.
   */
  api(pathAndQuery: string, body?: unknown): Promise<any>;
  /** Connect an agent through the stdio connector, as a person's own agent would. */
  bridge(clientName: string): Promise<Bridge>;
  /**
   * A call that SHOULD be refused. Same as `call`, but a refusal is the
   * pass and is not flagged — otherwise the refusal journey reports the
   * product working correctly as a defect.
   */
  refuse(tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  flag(message: string): void;
  state: Record<string, string>;
  /** The run's options: the project, the pace, whether to decide for the person. */
  opts: DemoOptions;
  /** Every file this run has edited, with its original text (restored at the end). */
  edits(): ReadonlyMap<string, string>;
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
  scenes: Scene[];
}
