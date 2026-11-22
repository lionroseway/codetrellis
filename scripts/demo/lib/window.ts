/**
 * A person's step in the window, taken by whoever is recording it.
 *
 * Some things only the window can do: open the Rules view, type a message to
 * the agents. A demo a person watches asks them (`c.person`); a recorded one
 * has nobody there, and standing in over HTTP shows the result with no cause
 * on screen. So when a recorder is listening (`DEMO_UI_DIR`, set by
 * `video/capture/demo.sh`), the step is written there and the recorder does it
 * in the real page: `video/capture/desktop.cjs` moves a pointer, clicks, types.
 * With no recorder this answers false, and the scene falls back to `c.person`.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Target {
  testid?: string;
  label?: string;
  text?: string;
  exact?: boolean;
  role?: string;
  name?: string;
  css?: string;
  /** Only the match holding this text. */
  has?: string;
  within?: Target;
  nth?: number;
}

export type WindowStep =
  | { do: 'click'; target: Target; timeout?: number }
  | { do: 'type'; target: Target; text: string; delay?: number; timeout?: number }
  | { do: 'scroll'; target: Target; block?: 'start' | 'center' | 'end'; timeout?: number }
  | { do: 'press'; key: string };

let n = 0;

/** Is a recorder there to take steps in the window? */
export const recording = (): boolean => Boolean(process.env.DEMO_UI_DIR);

/** Take one step in the window. False when no recorder is listening, or it could not. */
export async function inWindow(step: WindowStep, flag?: (m: string) => void): Promise<boolean> {
  const dir = process.env.DEMO_UI_DIR;
  if (!dir) return false;
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.join(dir, String(++n).padStart(4, '0'));
  fs.writeFileSync(`${stem}.tmp`, JSON.stringify(step));
  fs.renameSync(`${stem}.tmp`, `${stem}.json`);
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(`${stem}.done`)) {
      const said = fs.readFileSync(`${stem}.done`, 'utf-8');
      if (said === 'ok') return true;
      flag?.(`the window step ${JSON.stringify(step).slice(0, 90)} ${said}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  flag?.(`the recorder never took the window step ${JSON.stringify(step).slice(0, 90)}`);
  return false;
}
