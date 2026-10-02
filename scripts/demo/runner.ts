/**
 * Which scenes a run plays, and playing them. Shared by the command line
 * (`cli.ts`, a person watching) and CI (`tests/e2e/demo-check.test.ts`).
 */
import type { DemoOptions } from './options';
import type { Ctx, Group, Scene } from './types';
import { DEFAULT_GROUP, GROUPS } from './registry';

export interface Picked {
  group: Group;
  scenes: Scene[];
}

/**
 * `--scene` looks in every group (or the named ones); `--group` plays those
 * groups in registry order; `--all` plays every group; nothing plays the
 * default group, which is what `npm run demo` always did.
 */
export function pickScenes(opts: DemoOptions, groups: Group[] = GROUPS): { picked: Picked[] } | { error: string } {
  const all = opts.argv.includes('--all');
  let chosen: Group[];
  if (opts.groups) {
    const unknown = opts.groups.filter((id) => !groups.some((g) => g.id === id));
    if (unknown.length) return { error: `No group called ${unknown.map((u) => `"${u}"`).join(', ')}.` };
    chosen = groups.filter((g) => opts.groups!.includes(g.id));
  } else if (all || opts.scene) {
    chosen = groups;
  } else {
    chosen = groups.filter((g) => g.id === DEFAULT_GROUP);
  }
  const picked = chosen
    .map((group) => ({ group, scenes: group.scenes.filter((s) => !opts.scene || s.id === opts.scene) }))
    .filter((p) => p.scenes.length > 0);
  if (picked.length === 0) return { error: opts.scene ? `No scene called "${opts.scene}".` : 'Those groups have no scenes.' };
  return { picked };
}

/** Play them in order: each group's setup, then its scenes. */
export async function runScenes(ctx: Ctx, picked: Picked[]): Promise<void> {
  let n = 0;
  for (const { group, scenes } of picked) {
    if (group.setup) {
      console.log(`${'─'.repeat(66)}\n${group.title}: setting up`);
      await group.setup(ctx);
    }
    for (const scene of scenes) {
      n += 1;
      console.log(`${'─'.repeat(66)}\n${n}. ${scene.title}\n   watch: ${scene.watch}`);
      await scene.run(ctx);
    }
  }
}
