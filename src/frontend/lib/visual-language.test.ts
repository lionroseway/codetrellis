/**
 * Phase 33 G1 — the visual vocabulary holds its own rules: colour is never
 * the only carrier, one hue family means one thing (with the two shared
 * families the 0.3 audit accepted, named here so a third cannot creep in),
 * and the glyphs the audit found doing double duty mean one thing each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alpha, edgeVisual, EDGE, IDENTITY_TONES, identityTone, minimapColor, nodeChange, NODE_CHANGE,
  taskState, TASK, TONES, VOCABULARY, type StateVisual, type ToneName,
} from './visual-language';

/**
 * The only hue families two tones may share (audit §d, "Residual shared
 * hues"). Green: done and git-added, both "good / new"; done is green-500
 * with ✓ on task surfaces, added emerald-400 with A/＋ on files. Red:
 * blocked and git-deleted; deleted always carries D/− and a strikethrough.
 */
const ACCEPTED_SHARED_HUES: Record<string, ToneName[]> = {
  green: ['added', 'done'],
  red: ['blocked', 'deleted'],
};

/**
 * States in one family that share tone, glyph and dash, told apart by their
 * word alone. Each is the same meaning drawn twice, not two meanings.
 */
const SAME_LOOK_ON_PURPOSE = new Set([
  'git.modified|git.unstaged', // both "changed in the working tree": M
  'marks.footprint|marks.plannedOverlap', // both planned work on this file: ◇, dashed
]);

const allStates = (): Array<[string, StateVisual]> =>
  Object.entries(VOCABULARY).flatMap(([family, states]) =>
    Object.entries(states as Record<string, StateVisual>).map(([name, s]) => [`${family}.${name}`, s] as [string, StateVisual]));

test('every state names a tone that exists, and has words; colour is never the only carrier', () => {
  const states = allStates();
  assert.ok(states.length > 50, `expected the whole vocabulary, found ${states.length}`);
  for (const [name, s] of states) {
    assert.ok(s.tone in TONES, `${name}: unknown tone ${s.tone}`);
    assert.ok(s.word.trim().length > 0 || s.glyph.trim().length > 0, `${name}: colour alone`);
    assert.ok(s.word.trim().length > 0, `${name}: no word`);
  }
  for (const [status, change] of Object.entries(NODE_CHANGE)) {
    assert.ok(change.symbol.trim() && change.state.word.trim(), `node change ${status}: colour alone`);
  }
});

test('one hue family per meaning, except the two shared families the audit accepted', () => {
  const byHue = new Map<string, ToneName[]>();
  for (const [name, tone] of Object.entries(TONES) as Array<[ToneName, (typeof TONES)[ToneName]]>) {
    if (tone.hue === 'neutral') continue; // greys carry no meaning by hue; glyph and dash do
    byHue.set(tone.hue, [...(byHue.get(tone.hue) ?? []), name]);
  }
  for (const [hue, tones] of byHue) {
    if (tones.length < 2) continue;
    assert.deepEqual([...tones].sort(), ACCEPTED_SHARED_HUES[hue] ?? [],
      `${hue} is shared by ${tones.join(', ')}: one hue family means one thing`);
  }
  // And the allowance is not stale: both accepted pairs still exist.
  for (const [hue, tones] of Object.entries(ACCEPTED_SHARED_HUES)) {
    assert.deepEqual([...(byHue.get(hue) ?? [])].sort(), tones, `accepted pair ${hue} no longer matches`);
  }
});

test('every tone is its own colour, and identity hues are never state hues', () => {
  const hexes = [...Object.values(TONES).map((t) => t.hex), ...IDENTITY_TONES.map((t) => t.hex)];
  assert.equal(new Set(hexes.map((h) => h.toLowerCase())).size, hexes.length, 'two tokens share a colour');
  const stateHues = new Set<string>(Object.values(TONES).map((t) => t.hue));
  for (const id of IDENTITY_TONES) assert.ok(!stateHues.has(id.hue), `identity hue ${id.hue} is also a state hue`);
});

test('states that share a tone in one family differ by glyph or dash', () => {
  for (const [family, states] of Object.entries(VOCABULARY)) {
    const entries = Object.entries(states as Record<string, StateVisual>);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, sa] = entries[i];
        const [b, sb] = entries[j];
        if (sa.tone !== sb.tone || sa.glyph !== sb.glyph || sa.dash !== sb.dash) continue;
        assert.ok(SAME_LOOK_ON_PURPOSE.has(`${family}.${a}|${family}.${b}`),
          `${family}.${a} and ${family}.${b} look identical (${sa.tone} ${sa.glyph})`);
      }
    }
  }
});

test('reserved glyphs mean one thing: ◆ unplanned, ⊘ breach, ⏸ paused, ■ blocked', () => {
  for (const [name, s] of allStates()) {
    if (s.glyph === '◆') assert.equal(s.tone, 'drift', `${name}: ◆ is unplanned / drift only (not a commit)`);
    if (s.glyph === '⊘') assert.match(s.word, /breach/i, `${name}: ⊘ is a breach only`);
    if (s.glyph === '⏸') assert.equal(s.tone, 'attention', `${name}: ⏸ is a breakpoint pause only`);
    if (s.glyph === '■') assert.equal(s.tone, 'blocked', `${name}: ■ is blocked only`);
  }
});

test('edges: every kind differs from every other, and cross-system is cyan and dashed', () => {
  const looks = (Object.entries(EDGE) as Array<[string, StateVisual]>).map(([k, s]) => [k, `${s.tone}|${s.dash ?? ''}`]);
  assert.equal(new Set(looks.map(([, l]) => l)).size, looks.length, `two edge kinds look alike: ${JSON.stringify(looks)}`);
  const xs = edgeVisual('cross_system');
  assert.equal(xs.dashArray, '4 3');
  assert.equal(xs.color, alpha('system', 0.75));
  // Imports are slate, freeing blue for "an agent is working now".
  assert.equal(edgeVisual('import').color, alpha('importEdge', 0.55));
  assert.equal(edgeVisual(undefined).color, edgeVisual('import').color, 'an unknown state draws as an import');
  assert.notEqual(edgeVisual('active').color, edgeVisual('import').color);
  assert.match(edgeVisual('removed').label, /line-through/);
});

test('task states: in progress is blue and assigned is not; unknown reads as not started', () => {
  assert.equal(TASK.in_progress.tone, 'active');
  assert.notEqual(TASK.assigned.tone, TASK.in_progress.tone);
  assert.equal(TONES[TASK.assigned.tone].hue, 'neutral');
  assert.equal(taskState('nope'), TASK.pending);
  assert.equal(taskState(undefined), TASK.pending);
});

test('graph change statuses: planned is dashed violet, drift fuchsia, and the minimap shows status', () => {
  for (const s of ['planned_add', 'planned_modify']) {
    assert.equal(nodeChange(s)?.state.tone, 'planned');
    assert.equal(nodeChange(s)?.planned, true);
  }
  assert.equal(nodeChange('planned_remove')?.planned, true);
  assert.equal(nodeChange('unexpected_live')?.state.tone, 'drift');
  assert.equal(nodeChange('modified')?.state.tone, 'modified', 'modified is orange; amber means needs you');
  assert.equal(nodeChange('nope'), null);
  assert.equal(nodeChange(undefined), null);
  const colours = new Set(['added', 'modified', 'removed', undefined].map((s) => minimapColor(s)));
  assert.equal(colours.size, 4, 'the minimap tells added, modified, removed and unchanged apart');
});

test('identity hues are stable for a name', () => {
  assert.equal(identityTone('billing-v2'), identityTone('billing-v2'));
  assert.ok(IDENTITY_TONES.includes(identityTone('')));
});
