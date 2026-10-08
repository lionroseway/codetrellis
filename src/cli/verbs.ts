/**
 * The verbs an agent uses to keep itself on track (Phase 32 D1.2), each a
 * thin client over one or two MCP tools, so nothing here decides anything
 * the server does not already decide for any agent.
 *
 *   next [--plan <uid>]                     get_next_item
 *   claim <task>                            claim_item
 *   update <task> --progress N [--note …]   update_item_progress
 *   stuck <task> <why…>                     set_item_blocked
 *   done <task>                             check_criterion on each, then update_item(done)
 *   request <question…> [--options a,b]     post_channel_event, then wait for a steer
 *   brief <task>                            get_brief
 *   awareness                               get_awareness
 *   check <path>                            check_footprint + check_breakpoint
 *   report-tests <junit.xml>                report_tests
 *
 * A task is its uid, or the first characters of one ("6cb8cf43", or
 * "task 6cb8cf43" as the app quotes it) when they name one task in this
 * project's plans. Words by default; `--json` prints what the tool said.
 *
 * Exit codes: 0 done, 1 refused (the tool said no, or `done` with a failing
 * check), 2 a usage error, 3 held (`check`: a breakpoint holds the path) or
 * timed out (`request` with nobody answering yet).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { flag, type Parsed } from './args';
import { toSarif, ruleFileIn } from './sarif';
import { findingWords, type ReviewFinding } from './review-output';
import { BASELINE_FILE, baselineYaml, readBaseline, type Baseline } from '../backend/services/rule-baseline';
import { writeFileWithin } from '../backend/services/confined-fs';
import { version as CLI_VERSION } from '../../package.json';
import { changedFiles, gate, gateMarkdown, gateWords, wantsColor, withPlaces } from './conformity';
import { pipelineAt, readPipeline } from '../backend/services/pipeline';
import { pipelineWords, runPipeline, type PipelineRunners, type StageFinding } from './pipeline';
import type { Agent, ToolAnswer } from './agent';

export const VERBS = new Set(['next', 'claim', 'update', 'stuck', 'done', 'request', 'brief', 'awareness', 'check', 'report-tests', 'rules']);

export class UsageError extends Error {}
/** A verb's outcome: what to print, and how the process exits. */
export interface Outcome { out: string; code: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** The project the agent works in: the repository root of where it stands. */
export function projectRoot(cwd: string): string {
  try {
    const top = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (top) return fs.realpathSync(top);
  } catch { /* not a repository */ }
  return fs.realpathSync(cwd);
}

interface Ctx { agent: Agent; p: Parsed; cwd: string; json: boolean }

function said(a: ToolAnswer, words: (j: Record<string, unknown>) => string, ctx: Ctx): Outcome {
  if (a.isError) return { out: a.text, code: 1 };
  if (ctx.json) return { out: a.json !== null ? JSON.stringify(a.json) : JSON.stringify({ text: a.text }), code: 0 };
  return { out: a.json !== null ? words(asObj(a.json)) : a.text, code: 0 };
}

async function plansHere(ctx: Ctx): Promise<Array<{ uid: string; title: string; status: string }>> {
  const a = await ctx.agent.call('list_plans', { project_path: projectRoot(ctx.cwd), limit: 100 });
  if (a.isError) return [];
  return (asObj(a.json).plans as Array<{ uid: string; title: string; status: string }> | undefined) ?? [];
}

/** The plan to work from: the one named, else the only active one in this project. */
async function planOf(ctx: Ctx): Promise<string> {
  const named = flag(ctx.p, 'plan');
  if (named) return named;
  const plans = (await plansHere(ctx)).filter((pl) => pl.status !== 'archived' && pl.status !== 'done');
  if (plans.length === 1) return plans[0].uid;
  if (plans.length === 0) throw new UsageError(`No plan in ${projectRoot(ctx.cwd)}. Name one with --plan <uid>.`);
  throw new UsageError(`Several plans in this project; name one with --plan:\n${plans.map((pl) => `  ${pl.uid}  ${pl.title}`).join('\n')}`);
}

/** A task by its uid or the start of one, within this project's plans. */
async function taskOf(ctx: Ctx, ref: string | undefined): Promise<string> {
  if (!ref) throw new UsageError('Which task? Give its uid, or the first characters of it.');
  const want = ref.replace(/^task\s+/i, '').trim().toLowerCase();
  if (UUID.test(want)) return want;
  if (!/^[0-9a-f-]{6,}$/.test(want)) throw new UsageError(`"${ref}" is not a task uid or the start of one.`);
  const found: Array<{ uid: string; title: string }> = [];
  for (const pl of await plansHere(ctx)) {
    const a = await ctx.agent.call('list_items', { plan_uid: pl.uid, limit: 500 });
    for (const it of (asObj(a.json).items as Array<{ uid: string; title: string }> | undefined) ?? []) {
      if (it.uid.toLowerCase().startsWith(want)) found.push(it);
    }
  }
  if (found.length === 1) return found[0].uid;
  if (found.length === 0) throw new UsageError(`No task starting "${want}" in this project's plans.`);
  throw new UsageError(`"${want}" names ${found.length} tasks; give more of the uid:\n${found.map((t) => `  ${t.uid}  ${t.title}`).join('\n')}`);
}

const taskWords = (t: Record<string, unknown>) => `${t.title ?? 'a task'} (${t.uid ?? '?'})${t.status ? `, ${String(t.status).replace('_', ' ')}` : ''}`;

export async function runVerb(verb: string, agent: Agent, p: Parsed, cwd: string): Promise<Outcome> {
  const ctx: Ctx = { agent, p, cwd, json: p.flags.json === true };
  const [first, ...more] = p.rest;
  switch (verb) {
    case 'next': {
      const a = await agent.call('get_next_item', { plan_uid: await planOf(ctx) });
      return said(a, (j) => {
        const item = asObj(j.item ?? j.next ?? j);
        return item.uid ? `Next: ${taskWords(item)}${j.reason ? `\n${String(j.reason)}` : ''}` : (typeof j.message === 'string' ? j.message : 'Nothing to pick up: every task is done, claimed or waiting.');
      }, ctx);
    }
    case 'claim': {
      const a = await agent.call('claim_item', { uid: await taskOf(ctx, first) });
      return said(a, (j) => `Claimed ${taskWords(asObj(j.item ?? j))}.`, ctx);
    }
    case 'update': {
      const uid = await taskOf(ctx, first);
      const raw = flag(p, 'progress');
      const percent = raw === undefined ? NaN : Number(raw);
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new UsageError('--progress takes a whole number from 0 to 100.');
      const note = flag(p, 'note');
      const a = await agent.call('update_item_progress', { uid, percent, ...(note ? { message: note } : {}) });
      return said(a, () => `${percent}%${note ? `: ${note}` : ''}`, ctx);
    }
    case 'stuck': {
      const uid = await taskOf(ctx, first);
      const reason = more.join(' ').trim();
      if (!reason) throw new UsageError('Say why: codetrellis stuck <task> <why…>');
      const a = await agent.call('set_item_blocked', { uid, reason });
      return said(a, () => `Blocked: ${reason}`, ctx);
    }
    case 'done': {
      const uid = await taskOf(ctx, first);
      // As submit_criterion refuses a submission whose check fails, a task is
      // not marked done while one of its criteria's checks fails.
      const list = await agent.call('list_criteria', { item_uid: uid });
      const criteria = (Array.isArray(list.json) ? list.json : (asObj(list.json).criteria as unknown[] | undefined) ?? []) as Array<{ uid: string; text: string }>;
      const failing: Array<{ text: string; findings: string[] }> = [];
      for (const c of criteria) {
        const chk = await agent.call('check_criterion', { criterion_uid: c.uid });
        const j = asObj(chk.json);
        if (!chk.isError && j.ok === false) {
          const findings = ((j.findings as Array<{ status: string; message: string }> | undefined) ?? []).filter((f) => f.status === 'fail').map((f) => f.message);
          failing.push({ text: c.text, findings });
        }
      }
      if (failing.length) {
        if (ctx.json) return { out: JSON.stringify({ done: false, failing }), code: 1 };
        return { out: `Not marked done: ${failing.length === 1 ? 'a criterion\'s check fails' : `${failing.length} criteria's checks fail`}.\n${failing.map((f) => `  ✗ ${f.text}${f.findings.length ? `\n    ${f.findings.join('\n    ')}` : ''}`).join('\n')}`, code: 1 };
      }
      const a = await agent.call('update_item', { uid, status: 'done' });
      return said(a, (j) => `Done: ${taskWords(asObj(j.item ?? j))}`, ctx);
    }
    case 'request': return request(ctx, [first, ...more].filter(Boolean).join(' ').trim());
    case 'brief': {
      const a = await agent.call('get_brief', { item_uid: await taskOf(ctx, first) });
      if (a.isError) return { out: a.text, code: 1 };
      return { out: ctx.json || a.json === null ? (a.json !== null ? JSON.stringify(a.json) : a.text) : JSON.stringify(a.json, null, 2), code: 0 };
    }
    case 'awareness': {
      const a = await agent.call('get_awareness', { project_path: projectRoot(cwd) });
      return said(a, (j) => {
        const signals = (j.signals as Array<{ summary: string; severity: string }> | undefined) ?? [];
        return signals.length ? signals.map((s) => `${s.severity === 'high' ? '⚠' : '·'} ${s.summary}`).join('\n') : 'Nothing overlaps your work.';
      }, ctx);
    }
    case 'check': return check(ctx, first);
    case 'rules': {
      if (first !== 'baseline') throw new UsageError('codetrellis rules baseline — record each rule\'s breaches now, so the check fails on new ones');
      return writeBaseline(ctx, projectRoot(cwd));
    }
    case 'report-tests': {
      if (!first) throw new UsageError('Which report? codetrellis report-tests <junit.xml>');
      const a = await agent.call('report_tests', { path: first, project_path: projectRoot(cwd) });
      return said(a, (j) => {
        const failing = (j.failing as Array<{ test: string; why?: string }> | undefined) ?? [];
        return [typeof j.says === 'string' ? j.says : JSON.stringify(j), ...failing.map((f) => `  ✗ ${f.test}${f.why ? ` — ${f.why}` : ''}`)].join('\n');
      }, ctx);
    }
    default: throw new UsageError(`unknown verb ${verb}`);
  }
}

/**
 * Ask the person. The question is a channel event on the plan (it travels
 * with the plan's files, so a person who pulls later still sees it); unless
 * `--no-wait`, this waits for their steer in reply, up to `--timeout`
 * seconds (default 300), and exits 3 if none came yet.
 */
async function request(ctx: Ctx, question: string): Promise<Outcome> {
  if (!question) throw new UsageError('Ask something: codetrellis request <question…>');
  const plan = await planOf(ctx);
  const item = flag(ctx.p, 'item') ? await taskOf(ctx, flag(ctx.p, 'item')) : null;
  const options = (flag(ctx.p, 'options') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const since = Date.now() - 1_000;
  const posted = await ctx.agent.call('post_channel_event', {
    plan_uid: plan, item_uid: item, message: question,
    event_type: options.length ? 'need-decision' : 'need-context',
    ...(options.length ? { options } : {}),
  });
  if (posted.isError) return { out: posted.text, code: 1 };
  const uid = String(asObj(posted.json).uid ?? '');
  if (ctx.p.flags['no-wait']) {
    return { out: ctx.json ? JSON.stringify({ asked: uid, answered: false }) : `Asked (${uid}). Not waiting for the answer.`, code: 0 };
  }
  const timeout = Number(flag(ctx.p, 'timeout') ?? 300);
  if (!Number.isFinite(timeout) || timeout < 0) throw new UsageError('--timeout takes seconds.');
  const until = Date.now() + timeout * 1000;
  for (;;) {
    const a = await ctx.agent.call('list_channel_events', { plan_uid: plan, event_types: ['steer'], since_ms: since });
    const events = (Array.isArray(a.json) ? a.json : (asObj(a.json).events as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>;
    const reply = events.find((e) => {
      const payload = asObj(e.payload);
      return e.respondsTo === uid || e.responds_to === uid || payload.respondsTo === uid || payload.responds_to === uid;
    });
    if (reply) {
      const text = String(reply.message ?? asObj(reply.payload).message ?? '');
      const by = String(reply.author ?? reply.authorName ?? 'the person');
      return { out: ctx.json ? JSON.stringify({ asked: uid, answered: true, answer: text, by }) : `${by}: ${text}`, code: 0 };
    }
    if (Date.now() >= until) {
      return { out: ctx.json ? JSON.stringify({ asked: uid, answered: false, timedOut: true }) : `No answer yet to ${uid}; it stays open on the plan.`, code: 3 };
    }
    await new Promise((r) => setTimeout(r, Math.min(2_000, Math.max(100, until - Date.now()))));
  }
}

/** Before an edit: who else touches this file, and whether a breakpoint holds it. */
async function check(ctx: Ctx, file: string | undefined): Promise<Outcome> {
  const root = projectRoot(ctx.cwd);
  if (!file) return conforms(ctx, root);
  const rel = path.isAbsolute(file) ? path.relative(root, file) : path.relative(root, path.resolve(ctx.cwd, file));
  const footprint = await ctx.agent.call('check_footprint', { paths: [rel], project_path: root });
  const breakpoint = await ctx.agent.call('check_breakpoint', { path: rel });
  // pass | continue (a person let it through, maybe with a steer) | paused | stop.
  const bp = asObj(breakpoint.json);
  const held = bp.status === 'paused' || bp.status === 'stop';
  if (ctx.json) return { out: JSON.stringify({ path: rel, held, footprint: footprint.json ?? footprint.text, breakpoint: breakpoint.json ?? breakpoint.text }), code: held ? 3 : 0 };
  const lines: string[] = [];
  if (held) lines.push(`✋ ${String(bp.message ?? breakpoint.text)}`);
  else if (bp.status === 'continue') lines.push(`${rel}: go ahead${bp.steer ? `, with this steer: ${String(bp.steer)}` : ''}.`);
  else lines.push(`${rel}: no breakpoint holds it.`);
  const entry = asObj(((asObj(footprint.json).paths as unknown[] | undefined) ?? [])[0]);
  const changedIn = (entry.changed_in as Array<{ branch?: string | null; workstream: string }> | undefined) ?? [];
  const importedBy = (entry.imported_by as string[] | undefined) ?? [];
  if (changedIn.length) lines.push(`  also changed in ${changedIn.map((c) => c.branch ?? c.workstream).join(', ')}`);
  if (importedBy.length) lines.push(`  imported by ${importedBy.length} file${importedBy.length === 1 ? '' : 's'}: ${importedBy.slice(0, 5).join(', ')}${importedBy.length > 5 ? ', …' : ''}`);
  if (footprint.isError) lines.push(footprint.text);
  return { out: lines.join('\n'), code: held ? 3 : 0 };
}

/** No path: does this work's change conform (D1.4)? Exit 3 when it does not. */
async function conforms(ctx: Ctx, root: string): Promise<Outcome> {
  let changed;
  try { changed = changedFiles(root, flag(ctx.p, 'base'), process.env); } catch (err) { throw new UsageError((err as Error).message); }
  // B6: the base's pipeline, stage by stage.
  if (ctx.p.flags.pipeline === true || flag(ctx.p, 'stage') !== undefined) {
    const piped = await pipelined(ctx, root, changed);
    if (piped) return piped;
  }
  const g = await gate(ctx.agent, root, changed, ctx.p.flags.strict === true, { suite: flag(ctx.p, 'suite'), rule: flag(ctx.p, 'rule'), path: flag(ctx.p, 'path') });
  if ('error' in g) return { out: g.error, code: 1 };
  const format = flag(ctx.p, 'format') ?? (ctx.json ? 'json' : 'text');
  if (format === 'sarif') {
    // C2: for any host that reads SARIF; the exit code still says whether it conforms.
    const read = (rel: string): string | null => {
      try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
    };
    return { out: JSON.stringify(toSarif(g, { version: CLI_VERSION, root, read, ruleFile: ruleFileIn(root) }), null, 2), code: g.ok ? 0 : 3 };
  }
  const read = (rel: string): string | null => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  };
  // C8: JSON carries what the text says, each finding's line and import text included.
  if (format === 'json') return { out: JSON.stringify({ ...g, rules: withPlaces(g, read).rules }), code: g.ok ? 0 : 3 };
  // C8: the same words in every format; colour only for a terminal that wants it.
  if (format === 'markdown') return { out: gateMarkdown(g, read), code: g.ok ? 0 : 3 };
  if (format !== 'text') throw new UsageError(`--format is text, json, markdown or sarif, not ${format}`);
  return { out: gateWords(g, { read, color: wantsColor(process.stdout, process.env, ctx.p.flags['no-color'] === true) }), code: g.ok ? 0 : 3 };
}

/**
 * B6: `check --pipeline` (or `--stage <id>`): the base's pipeline, stage by
 * stage; null when there is none, and the check runs every rule in one stage
 * as before. Agent stages run only with a reviewer (`--agent`, and the rest of
 * `codetrellis review`'s flags).
 */
async function pipelined(ctx: Ctx, root: string, changed: ReturnType<typeof changedFiles>): Promise<Outcome | null> {
  const got = changed.since ? await pipelineAt(root, changed.since) : readPipeline(root);
  if (!got) return null;
  if (!got.pipeline) return { out: `The pipeline${changed.since ? ` at ${changed.since.slice(0, 7)}` : ''} could not be read: ${got.problems.join('; ')}`, code: 1 };
  const strict = ctx.p.flags.strict === true;
  let review: PipelineRunners['review'] = null;
  if (flag(ctx.p, 'agent') !== undefined) {
    const { review: runReview, reviewOptions, ReviewUsageError } = await import('./review');
    let o: ReturnType<typeof reviewOptions>;
    try { o = reviewOptions(ctx.p, ctx.cwd, process.env); } catch (err) {
      if (err instanceof ReviewUsageError) throw new UsageError(err.message);
      throw err;
    }
    const sinkFor = (dir: string) => ({ command: process.execPath, args: [path.resolve(__dirname, '..', '..', 'bin', 'codetrellis.mjs'), 'review-sink', '--pass', dir] });
    review = async (stage, scope, grounding) => {
      // An agent stage fails on what a block-strength agent rule's finding holds (B5), and its output is read, not shown raw.
      const r = await runReview(ctx.agent, { ...o, scope: { suite: scope.suite, rule: scope.rule, path: scope.path, engine: scope.engine, strength: scope.strength }, stage: stage.id, grounding, format: 'json', failOn: new Set(['block']), post: null }, ctx.cwd, process.env, sinkFor, { version: CLI_VERSION });
      let j: { passes?: Array<{ says: string; failing: boolean; kept: ReviewFinding[] }>; says?: string; error?: string };
      try { j = JSON.parse(r.out); } catch { return { error: r.out }; }
      if (j.error) return { error: j.error };
      const findings: StageFinding[] = (j.passes ?? []).flatMap((pass) => pass.kept.filter((k) => k.path).map((k) => ({ stage: stage.id, path: k.path!, says: k.says, rule: k.rule })));
      return { ok: r.code === 0, out: j.says ?? (j.passes ?? []).flatMap((pass) => [`review: ${pass.says}`, ...pass.kept.map((k) => `  ${findingWords(k)}`)]).join('\n'), findings };
    };
  }
  const result = await runPipeline(got.pipeline, { gate: (scope) => gate(ctx.agent, root, changed, strict, scope), review }, flag(ctx.p, 'stage'));
  const code = result.stages.some((s) => !s.ok && !s.advisory && (s.gate && 'error' in s.gate)) ? 1 : result.ok ? 0 : 3;
  if (ctx.json || flag(ctx.p, 'format') === 'json') return { out: JSON.stringify(result), code };
  const read = (rel: string): string | null => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  };
  const color = wantsColor(process.stdout, process.env, ctx.p.flags['no-color'] === true);
  return { out: pipelineWords(result, (g) => gateWords(g, { read, color })), code };
}

/**
 * C3: record each rule's breaches now in `.codetrellis/rules/baseline.yaml`.
 * A rule new to the baseline starts with what breaks it; one already in it
 * only loses the entries fixed since, because a baseline only shrinks (the
 * check holds a branch to that too). Commit the file with the code.
 */
async function writeBaseline(ctx: Ctx, root: string): Promise<Outcome> {
  const a = await ctx.agent.call('list_rules', { project_path: root });
  if (a.isError) return { out: a.text, code: 1 };
  const views = (asObj(a.json).rules as Array<{ rule: { id: string; strength?: string }; breaches: Array<{ from: string; to: string }> | null }> | undefined) ?? [];
  if (views.some((v) => v.rule.strength !== 'guide' && v.breaches === null)) {
    return { out: 'The rules\' breaches could not be read: this project\'s imports are not loaded. Run `codetrellis start` in it first.', code: 1 };
  }
  const now: Baseline = new Map(views.filter((v) => v.rule.strength !== 'guide').map((v) => [v.rule.id, new Set((v.breaches ?? []).map((b) => `${b.from} > ${b.to}`))]));
  const before = readBaseline(root);
  const next: Baseline = new Map();
  const lines: string[] = [];
  let held = 0;
  for (const [id, entries] of now) {
    const was = before?.get(id);
    if (!was) {
      next.set(id, entries);
      lines.push(`  ${id}: ${entries.size} ${entries.size === 1 ? 'breach' : 'breaches'} recorded`);
      continue;
    }
    const kept = new Set([...entries].filter((e) => was.has(e)));
    held += entries.size - kept.size;
    next.set(id, kept);
    lines.push(`  ${id}: ${kept.size}${kept.size < was.size ? `, down from ${was.size}` : ''}`);
  }
  // Through the confined-file helper, like every write into a project: a link at .codetrellis/ is refused.
  writeFileWithin(root, BASELINE_FILE, baselineYaml(next), 'rule baseline');
  if (ctx.json) return { out: JSON.stringify({ file: BASELINE_FILE, rules: Object.fromEntries([...next].map(([k, v]) => [k, [...v]])), notAdded: held }), code: 0 };
  return {
    out: [`Wrote ${BASELINE_FILE}:`, ...lines, ...(held ? [`${held} new ${held === 1 ? 'breach is' : 'breaches are'} not added: a baseline only shrinks. Fix ${held === 1 ? 'it' : 'them'}, or change the rule in the app.`] : []), 'Commit it with the code.'].join('\n'),
    code: 0,
  };
}
