/**
 * Changing the plan, committing it, and where things stand (Phase 32 D1.3),
 * each over the MCP tools as the agent running the CLI, as D1.2's verbs are.
 *
 *   plan show [--plan]                                    get_plan
 *   plan add <title…> [--plan] [--under <task>] [--page] [--body <text>]   add_item
 *   plan edit <task> [--title <text>] [--body <text>]     update_item
 *   plan move <task> (--under <task> | --top) [--position N]   move_item
 *   commit [-m <subject>]                                 commit_manifest_changes
 *   status [--plan]                                       list_plans, get_plan, list_channel_events
 *
 * `commit` commits CodeTrellis's own files and nothing else: what changed
 * under `.codetrellis/` (the plan's folder, task records, material reads,
 * key introductions, channel events). It never stages the agent's code. The
 * message names the tasks it touches, and the commit carries the agent as
 * co-author, the person's git identity as author.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { flag, type Parsed } from './args';
import type { Agent, ToolAnswer } from './agent';
import { changedFiles, gate, gateWords } from './conformity';
import { projectRoot, UsageError, type Outcome } from './verbs';

export const PLAN_VERBS = new Set(['plan', 'commit', 'status']);

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx { agent: Agent; p: Parsed; cwd: string; json: boolean; root: string }

function answer(a: ToolAnswer, ctx: Ctx, words: (j: Record<string, unknown>) => string): Outcome {
  if (a.isError) return { out: a.text, code: 1 };
  if (ctx.json) return { out: a.json !== null ? JSON.stringify(a.json) : JSON.stringify({ text: a.text }), code: 0 };
  return { out: a.json !== null ? words(asObj(a.json)) : a.text, code: 0 };
}

async function plans(ctx: Ctx): Promise<Array<{ uid: string; title: string; status: string }>> {
  const a = await ctx.agent.call('list_plans', { project_path: ctx.root, limit: 100 });
  return (asObj(a.json).plans as Array<{ uid: string; title: string; status: string }> | undefined) ?? [];
}

async function planOf(ctx: Ctx): Promise<string> {
  const named = flag(ctx.p, 'plan');
  if (named) return named;
  const open = (await plans(ctx)).filter((pl) => pl.status !== 'archived' && pl.status !== 'done');
  if (open.length === 1) return open[0].uid;
  if (open.length === 0) throw new UsageError(`No plan in ${ctx.root}. Name one with --plan <uid>.`);
  throw new UsageError(`Several plans in this project; name one with --plan:\n${open.map((pl) => `  ${pl.uid}  ${pl.title}`).join('\n')}`);
}

async function taskOf(ctx: Ctx, ref: string | undefined, what = 'task'): Promise<string> {
  if (!ref) throw new UsageError(`Which ${what}? Give its uid, or the first characters of it.`);
  const want = ref.replace(/^task\s+/i, '').trim().toLowerCase();
  if (UUID.test(want)) return want;
  if (!/^[0-9a-f-]{6,}$/.test(want)) throw new UsageError(`"${ref}" is not a uid or the start of one.`);
  const found: Array<{ uid: string; title: string }> = [];
  for (const pl of await plans(ctx)) {
    const a = await ctx.agent.call('list_items', { plan_uid: pl.uid, limit: 500 });
    for (const it of (asObj(a.json).items as Array<{ uid: string; title: string }> | undefined) ?? []) {
      if (it.uid.toLowerCase().startsWith(want)) found.push(it);
    }
  }
  if (found.length === 1) return found[0].uid;
  if (found.length === 0) throw new UsageError(`No ${what} starting "${want}" in this project's plans.`);
  throw new UsageError(`"${want}" names ${found.length} items; give more of the uid:\n${found.map((t) => `  ${t.uid}  ${t.title}`).join('\n')}`);
}

type StateItem = { item_uid: string; title: string; kind: string; state: string; says: string; recorded_by?: string; recorded_in?: string; set_at_once?: string };
type State = { progress?: string; waiting?: Array<{ item_uid: string; title: string; says: string }>; in_progress?: Array<{ item_uid: string; title: string; says: string }>; items?: StateItem[] };

async function planShow(ctx: Ctx): Promise<Outcome> {
  const a = await ctx.agent.call('get_plan', { plan_uid: await planOf(ctx) });
  return answer(a, ctx, (j) => {
    const plan = asObj(j.plan ?? j);
    const state = asObj(j.state) as State;
    const lines = [`${String(plan.title ?? 'Plan')} (${String(plan.uid ?? '')})${state.progress ? ` — ${state.progress}` : ''}`];
    for (const it of state.items ?? []) {
      if (it.kind !== 'action') continue;
      const by = it.recorded_in ? `, recorded by ${it.recorded_by} in ${it.recorded_in}` : '';
      lines.push(`  ${it.item_uid.slice(0, 8)}  ${it.title} — ${it.says}${by}${it.set_at_once ? ` ⚠ ${it.set_at_once}` : ''}`);
    }
    return lines.join('\n');
  });
}

async function planAdd(ctx: Ctx, title: string): Promise<Outcome> {
  if (!title) throw new UsageError('Give the new task a title: codetrellis plan add <title…>');
  const under = flag(ctx.p, 'under');
  const body = flag(ctx.p, 'body');
  const a = await ctx.agent.call('add_item', {
    plan_uid: await planOf(ctx),
    kind: ctx.p.flags.page ? 'object' : 'action',
    title,
    ...(under ? { parent_uid: await taskOf(ctx, under, 'parent') } : {}),
    ...(body ? { body } : {}),
  });
  return answer(a, ctx, (j) => {
    const it = asObj(j.item ?? j);
    return `Added ${ctx.p.flags.page ? 'page' : 'task'} "${String(it.title ?? title)}" (${String(it.uid ?? '?')}).`;
  });
}

async function planEdit(ctx: Ctx, ref: string | undefined): Promise<Outcome> {
  const uid = await taskOf(ctx, ref);
  const title = flag(ctx.p, 'title');
  const body = flag(ctx.p, 'body');
  if (title === undefined && body === undefined) throw new UsageError('Say what to change: --title <text>, --body <text>, or both.');
  const a = await ctx.agent.call('update_item', { uid, ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) });
  return answer(a, ctx, (j) => `Changed "${String(asObj(j.item ?? j).title ?? title ?? uid)}".`);
}

async function planMove(ctx: Ctx, ref: string | undefined): Promise<Outcome> {
  const uid = await taskOf(ctx, ref);
  const under = flag(ctx.p, 'under');
  if (!under && !ctx.p.flags.top) throw new UsageError('Say where: --under <task>, or --top.');
  const pos = flag(ctx.p, 'position');
  if (pos !== undefined && !/^\d+$/.test(pos)) throw new UsageError('--position takes a whole number.');
  const a = await ctx.agent.call('move_item', {
    uid,
    new_parent_uid: under ? await taskOf(ctx, under, 'parent') : '',
    ...(pos !== undefined ? { new_sort_order: Number(pos) } : {}),
  });
  return answer(a, ctx, () => `Moved ${uid.slice(0, 8)} ${under ? `under ${under}` : 'to the top level'}.`);
}

/** CodeTrellis's own changed files in the repository: under `.codetrellis/`, nothing else. */
export function ownChanges(root: string): string[] {
  const out = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.codetrellis'], { encoding: 'utf8' });
  const paths: string[] = [];
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    // A rename names its source next; both are ours, under .codetrellis.
    if (status.startsWith('R') || status.startsWith('C')) { paths.push(file); paths.push(parts[++i]); continue; }
    paths.push(file);
  }
  return [...new Set(paths)].filter((p) => p === '.codetrellis' || p.startsWith('.codetrellis/'));
}

/** The tasks a set of CodeTrellis files is about: item files by their title, records by their item's folder. */
async function tasksTouched(ctx: Ctx, files: string[]): Promise<string[]> {
  const titles = new Set<string>();
  const uids = new Set<string>();
  for (const f of files) {
    const rec = /^\.codetrellis\/(?:records|reads)\/[^/]+\/([0-9a-f-]{36})\//i.exec(f);
    if (rec) { uids.add(rec[1]); continue; }
    if (/\/items\/.+\.ya?ml$/.test(f)) {
      try {
        const text = fs.readFileSync(path.join(ctx.root, f), 'utf8');
        const m = /^title:\s*(.+)$/m.exec(text);
        if (m) titles.add(m[1].replace(/^['"]|['"]$/g, '').trim());
      } catch { /* deleted */ }
    }
  }
  for (const uid of uids) {
    const a = await ctx.agent.call('get_item', { uid });
    const t = asObj(asObj(a.json).item ?? a.json).title;
    if (typeof t === 'string') titles.add(t);
  }
  return [...titles].sort();
}

async function commit(ctx: Ctx): Promise<Outcome> {
  const files = ownChanges(ctx.root);
  if (files.length === 0) return { out: ctx.json ? JSON.stringify({ committed: false, files: [] }) : 'Nothing of CodeTrellis\'s to commit.', code: 0 };
  const tasks = await tasksTouched(ctx, files);
  const listed = tasks.length <= 3 ? tasks.join(', ') : `${tasks.slice(0, 3).join(', ')} and ${tasks.length - 3} more`;
  const subject = flag(ctx.p, 'm') ?? flag(ctx.p, 'message') ?? (tasks.length ? `Update the plan: ${listed}` : 'Update the plan');
  const body = tasks.length ? [`Tasks: ${tasks.join('; ')}.`, `CodeTrellis's own files only (${files.length}).`] : [`CodeTrellis's own files only (${files.length}).`];
  const a = await ctx.agent.call('commit_manifest_changes', {
    project_root: ctx.root, subject: subject.slice(0, 72), paths: files, body,
    agent: { agent_type: ctx.agent.name },
  });
  if (a.isError) return { out: a.text, code: 1 };
  const sha = String(asObj(a.json).sha ?? '').slice(0, 7) || /([0-9a-f]{7,40})/.exec(a.text)?.[1]?.slice(0, 7) || '';
  if (ctx.json) return { out: JSON.stringify({ committed: true, sha, subject, files, tasks }), code: 0 };
  return { out: `Committed ${files.length} CodeTrellis file${files.length === 1 ? '' : 's'}${sha ? ` as ${sha}` : ''}: ${subject}`, code: 0 };
}

interface PlanStatus {
  uid: string; title: string; progress: string | null;
  inProgress: Array<{ uid: string; title: string; says: string }>;
  blocked: Array<{ uid: string; title: string; says: string }>;
  waitingOnPerson: Array<{ uid: string; question: string; item: string | null }>;
}

async function status(ctx: Ctx): Promise<Outcome> {
  const named = flag(ctx.p, 'plan');
  const list = named ? [{ uid: named, title: '', status: '' }] : (await plans(ctx)).filter((pl) => pl.status !== 'archived');
  const out: PlanStatus[] = [];
  for (const pl of list) {
    const g = await ctx.agent.call('get_plan', { plan_uid: pl.uid });
    if (g.isError) continue;
    const j = asObj(g.json);
    const state = asObj(j.state) as State;
    const items = state.items ?? [];
    const asks = await ctx.agent.call('list_channel_events', { plan_uid: pl.uid, event_types: ['need-decision', 'need-context', 'stuck'], status: ['open'] });
    const events = (Array.isArray(asks.json) ? asks.json : (asObj(asks.json).events as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>;
    out.push({
      uid: pl.uid,
      title: String(asObj(j.plan ?? j).title ?? pl.title),
      progress: state.progress ?? null,
      inProgress: (state.in_progress ?? []).map((w) => ({ uid: w.item_uid, title: w.title, says: w.says })),
      blocked: items.filter((i) => i.state === 'blocked').map((i) => ({ uid: i.item_uid, title: i.title, says: i.says })),
      waitingOnPerson: events.map((e) => ({
        uid: String(e.uid), question: String(asObj(e.payload).message ?? e.message ?? ''), item: (e.itemUid ?? e.item_uid ?? null) as string | null,
      })),
    });
  }
  // D1.4: and whether this work conforms, so a job can gate on `status` too.
  let changed;
  try { changed = changedFiles(ctx.root, flag(ctx.p, 'base'), process.env); } catch (err) { throw new UsageError((err as Error).message); }
  const g = await gate(ctx.agent, ctx.root, changed, ctx.p.flags.strict === true);
  const code = 'error' in g ? 1 : g.ok ? 0 : 3;
  if (ctx.json) return { out: JSON.stringify({ project: ctx.root, plans: out, conformity: g }), code };
  const lines: string[] = [];
  if (out.length === 0) lines.push(`No plan in ${ctx.root}.`);
  for (const s of out) {
    lines.push(`${s.title}${s.progress ? ` — ${s.progress}` : ''}`);
    for (const w of s.inProgress) lines.push(`  ▶ ${w.title}: ${w.says}`);
    for (const b of s.blocked) lines.push(`  ■ ${b.title}: ${b.says}`);
    for (const q of s.waitingOnPerson) lines.push(`  ? ${q.question}`);
  }
  lines.push('', 'error' in g ? `Could not check conformity: ${g.error}` : gateWords(g));
  return { out: lines.join('\n'), code };
}

export async function runPlanVerb(verb: string, agent: Agent, p: Parsed, cwd: string): Promise<Outcome> {
  const ctx: Ctx = { agent, p, cwd, json: p.flags.json === true, root: projectRoot(cwd) };
  if (verb === 'commit') return commit(ctx);
  if (verb === 'status') return status(ctx);
  const [sub, ...rest] = p.rest;
  switch (sub) {
    case 'show': return planShow(ctx);
    case 'add': return planAdd(ctx, rest.join(' ').trim());
    case 'edit': return planEdit(ctx, rest[0]);
    case 'move': return planMove(ctx, rest[0]);
    default: throw new UsageError('codetrellis plan show | add <title…> | edit <task> | move <task>');
  }
}
