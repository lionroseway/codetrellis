/**
 * Phase 33 B6 — pipelines: order, parallel, grounding, and change control.
 *
 * Done when a three-stage pipeline runs with one stage in parallel, its agent
 * stage's bundle carries the earlier stages' findings, and removing a stage
 * is refused as a loosening (end to end in tests/e2e/pipelines.test.ts; the
 * parts here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPipeline, parsePipeline, stageScope, stageWords, waves } from './pipeline';
import { parseArchitectureRule } from './architecture-rule';
import { parseScope, scopeRules, scopeWords } from './rule-scope';
import { runPipeline, pipelineWords, type StageFinding } from '../../cli/pipeline';
import type { Gate } from '../../cli/conformity';
import type { Pipeline } from '../../shared/types/pipeline';

const THREE = [
  'stages:',
  '  - id: fast',
  '    rules: { engine: deterministic }',
  '  - id: fuzzy',
  '    rules: { engine: fuzzy }',
  '    parallel: true',
  '  - id: review',
  '    needs: [fast, fuzzy]',
  '    rules: { engine: agent }',
  '    when: { fast: passed }',
  '    grounding: [fast, fuzzy]',
].join('\n');

const three = () => parsePipeline(THREE).pipeline!;

test('a pipeline reads as a person writes it: stages, in waves, in words', () => {
  const { pipeline, problems } = parsePipeline(THREE);
  assert.deepEqual(problems, []);
  assert.deepEqual(waves(pipeline!).map((w) => w.map((s) => s.id)), [['fast', 'fuzzy'], ['review']]);
  assert.deepEqual(pipeline!.stages.map(stageWords), [
    'fast: deterministic rules',
    'fuzzy: fuzzy rules, beside the stage before',
    'review: agent rules, after fast and fuzzy, when fast passed, grounded by fast and fuzzy',
  ]);
  assert.deepEqual(stageScope(pipeline!.stages[2]), { engine: 'agent' });
  assert.deepEqual(stageScope(parsePipeline('stages:\n  - id: pay\n    rules: { suite: [payments, money], strength: block }\n').pipeline!.stages[0]), { suite: 'payments,money', strength: 'block' });
  assert.equal(stageWords(parsePipeline('stages:\n  - id: all\n    advisory: true\n').pipeline!.stages[0]), 'all: every rule (advisory)');
});

test('a pipeline written wrongly is not run, and says why', () => {
  const why = (text: string) => parsePipeline(text).problems.join(' ');
  assert.match(why('stages: []'), /at least one/);
  assert.match(why('stages:\n  - id: a\n    parallel: true\n'), /the first stage has no stage to run beside/);
  assert.match(why('stages:\n  - id: a\n  - id: b\n    parallel: true\n    needs: [a]\n'), /needs names a, which is not a stage that finishes before this one/);
  assert.match(why('stages:\n  - id: a\n    needs: [b]\n  - id: b\n'), /needs names b/);
  assert.match(why('stages:\n  - id: a\n  - id: b\n    when: { a: green }\n'), /when.a is passed or failed/);
  assert.match(why('stages:\n  - id: a\n    rules: { kind: grep }\n'), /not kind/);
  assert.match(why('stages:\n  - id: a\n    rules: { engine: model }\n'), /rules.engine is deterministic, fuzzy or agent/);
  assert.match(why('stages:\n  - id: a\n  - id: a\n'), /a is already a stage/);
  assert.match(why('a: &x 1\nstages:\n  - id: s\n    rules: { suite: *x }\n'), /aliases/);
  assert.equal(parsePipeline('stages:\n  - id: a\n  - id: B\n').pipeline, null, 'one bad stage and the pipeline is not run');
});

test('a stage selects rules by engine and strength, as a scope', () => {
  const rules = [
    parseArchitectureRule({ id: 'det', kind: 'package', package: 'npm:stripe', only: ['a/'], strength: 'block' }).rule!,
    parseArchitectureRule({ id: 'fz', kind: 'package', package: { match: 'fuzzy', value: 'npm:stripe' }, strength: 'warn' }).rule!,
    parseArchitectureRule({ id: 'ag', engine: 'agent', rule: 'Be kind.', in: ['src/'], strength: 'warn' }).rule!,
  ];
  const ids = (raw: Record<string, unknown>) => scopeRules(rules, parseScope(raw)).map((r) => r.id);
  assert.deepEqual(ids({ engine: 'deterministic' }), ['det']);
  assert.deepEqual(ids({ engine: 'fuzzy,agent' }), ['fz', 'ag']);
  assert.deepEqual(ids({ strength: 'warn' }), ['fz', 'ag']);
  assert.deepEqual(ids({ engine: 'agent', strength: 'block' }), []);
  assert.equal(scopeWords(parseScope({ engine: 'agent' })), 'engine agent');
});

test('removing a stage, making it advisory, or changing what it runs loosens; adding one tightens; where it runs beside does not count', () => {
  const p = three();
  const without = { stages: p.stages.filter((s) => s.id !== 'fuzzy').map((s) => (s.id === 'review' ? { ...s, needs: ['fast'], grounding: ['fast'] } : s)) };
  const removed = diffPipeline(p, without);
  assert.deepEqual(removed.map((c) => [c.rule, c.change, c.effect]), [['pipeline.fuzzy', 'removed', 'loosens'], ['pipeline.review', 'changed', 'loosens']]);
  assert.equal(removed[0].words, '✗ This change removes the stage fuzzy from the pipeline (“fuzzy: fuzzy rules, beside the stage before”). Loosening a rule needs a person\'s approval in the app.');
  const advisory = diffPipeline(p, { stages: p.stages.map((s) => (s.id === 'fast' ? { ...s, advisory: true } : s)) });
  assert.deepEqual(advisory.map((c) => [c.rule, c.effect]), [['pipeline.fast', 'loosens']]);
  const narrower = diffPipeline(p, { stages: p.stages.map((s) => (s.id === 'fast' ? { ...s, rules: { engine: ['deterministic'], strength: ['block'] } } : s)) });
  assert.deepEqual(narrower.map((c) => c.effect), ['loosens']);
  const added = diffPipeline(p, { stages: [...p.stages, { id: 'security', rules: { suite: ['security'] } }] });
  assert.deepEqual(added.map((c) => [c.rule, c.change, c.effect]), [['pipeline.security', 'added', 'tightens']]);
  assert.deepEqual(diffPipeline(p, { stages: p.stages.map((s) => ({ ...s, parallel: undefined })) }), [], 'running beside is not a term');
  assert.deepEqual(diffPipeline(null, null), []);
  assert.deepEqual(diffPipeline(p, null).map((c) => c.effect), ['loosens', 'loosens', 'loosens'], 'deleting the file removes every stage');
});

const gateOf = (ok: boolean, rules: Array<{ path: string; imports: string; rule: string }> = []): Gate => ({
  ok, says: ok ? [] : ['✗ something'], files: 1, base: 'main', breakpoints: [], tests: [], criteria: [], docs: [],
  rules: rules.map((r) => ({ ...r, words: `the rule ${r.rule}`, because: '', strength: ok ? 'warn' : 'block' })), rulebook: [], notes: [],
});

test('stages in a wave run together, later waves after; the first judges the pipeline; the agent stage is grounded by what it names', async () => {
  const log: string[] = [];
  let given: StageFinding[] = [];
  const res = await runPipeline(three(), {
    gate: async (scope) => {
      log.push(`start ${scope.stage}${scope.pipeline ? ' +pipeline' : ''}`);
      await new Promise((r) => setTimeout(r, scope.stage === 'fast' ? 30 : 5));
      log.push(`end ${scope.stage}`);
      return scope.stage === 'fast'
        ? gateOf(true, [{ path: 'web/a.ts', imports: 'http:api.stripe.com/v1', rule: 'stripe' }])
        : gateOf(true, [{ path: 'api/u.py', imports: 'pypi:reqeusts', rule: 'lookalike' }]);
    },
    review: async (stage, scope, grounding) => {
      log.push(`review ${stage.id} ${scope.engine}`);
      given = grounding;
      return { ok: true, out: 'review: ✓ nothing found', findings: [] };
    },
  });
  assert.deepEqual(log, ['start fast +pipeline', 'start fuzzy', 'end fuzzy', 'end fast', 'review review agent'], 'fuzzy started before fast ended');
  assert.deepEqual(given.map((g) => `${g.stage} ${g.says}`), [
    'fast web/a.ts calls api.stripe.com/v1, which the rule stripe forbids',
    'fuzzy api/u.py imports pypi:reqeusts, which the rule lookalike forbids',
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.stages.map((s) => [s.id, s.ran, s.ok]), [['fast', true, true], ['fuzzy', true, true], ['review', true, true]]);
});

test('when decides whether a stage runs; an advisory stage never fails it; without a reviewer an agent stage is skipped as guides', async () => {
  const p: Pipeline = parsePipeline(THREE.replace('    rules: { engine: fuzzy }\n    parallel: true', '    rules: { engine: fuzzy }\n    parallel: true\n    advisory: true')).pipeline!;
  const failing = await runPipeline(p, { gate: async (s) => gateOf(s.stage !== 'fast' && s.stage !== 'fuzzy'), review: async () => ({ ok: true, out: '', findings: [] }) });
  assert.deepEqual(failing.stages.map((s) => [s.id, s.ran, s.ok, s.skipped ?? '']), [
    ['fast', true, false, ''], ['fuzzy', true, false, ''], ['review', false, true, 'it runs when fast passed, and that did not happen'],
  ]);
  assert.equal(failing.ok, false, 'fast fails it; fuzzy is advisory');
  const words = pipelineWords(failing, () => '✗ something');
  assert.match(words, /^✗ stage fast: deterministic rules\n {2}✗ something\n⚠ stage fuzzy/);
  assert.match(words, /· stage review: .* — skipped: it runs when fast passed, and that did not happen/);
  assert.match(words, /✗ The pipeline fails: fast\.$/);

  const noReviewer = await runPipeline(three(), { gate: async () => gateOf(true), review: null });
  assert.equal(noReviewer.stages[2].skipped, 'no reviewer was given (--agent), so its agent rules are guides');
  assert.equal(noReviewer.ok, true);
});

test('--stage runs one stage, ungrounded; a stage the pipeline lacks is said', async () => {
  const seen: string[] = [];
  const one = await runPipeline(three(), { gate: async (s) => { seen.push(`${s.stage}${s.pipeline ? ' +pipeline' : ''}`); return gateOf(true); }, review: null }, 'fuzzy');
  assert.deepEqual(seen, ['fuzzy +pipeline']);
  assert.deepEqual(one.stages.map((s) => s.id), ['fuzzy']);
  const none = await runPipeline(three(), { gate: async () => gateOf(true), review: null }, 'lint');
  assert.equal(none.ok, false);
  assert.deepEqual(none.notes, ['The pipeline has no stage lint: its stages are fast, fuzzy, review.']);
});
