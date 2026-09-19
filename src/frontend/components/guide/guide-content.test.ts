/**
 * The guide may not name a tool that does not exist.
 *
 * The guide it replaces told people their agent could call `report_plan`.
 * No such tool has ever been registered. Nobody noticed because a guide is
 * prose, and prose does not fail a build.
 *
 * This walks the content as data and checks it against the registrations in
 * `mcp/tools/`, read from source — not against the capability matrix, which
 * is itself hand-kept. Checking one hand-kept list against another proves
 * only that someone typed the same thing twice.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GUIDE_SECTIONS, GUIDE_GROUPS } from './guide-content';

const TOOLS_DIR = path.resolve(import.meta.dirname, '../../../backend/mcp/tools');

function registeredTools(): Set<string> {
  const names = new Set<string>();
  for (const file of fs.readdirSync(TOOLS_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf-8');
    for (const re of [
      /(?:registerTool|server\.tool)\(\s*'([^']+)'/g,
      /(?:registerTool|server\.tool)\(\s*"([^"]+)"/g,
    ]) {
      for (const m of src.matchAll(re)) names.add(m[1]);
    }
  }
  return names;
}

describe('the guide describes tools that exist', () => {
  test('the probe found the registry', () => {
    assert.ok(registeredTools().size > 150, 'tool scan found nothing — the check below would be vacuous');
  });

  test('every tool named in the guide is registered', () => {
    const real = registeredTools();
    const bogus: string[] = [];
    for (const s of GUIDE_SECTIONS) {
      for (const t of s.tools ?? []) if (!real.has(t)) bogus.push(`${s.id} → ${t}`);
    }
    assert.deepEqual(bogus, [], `the guide promises tools that do not exist: ${bogus.join(', ')}`);
  });
});

describe('the guide is navigable', () => {
  test('section ids are unique', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate section id — the rail would select two at once');
  });

  test('every section belongs to a declared group', () => {
    for (const s of GUIDE_SECTIONS) {
      assert.ok(
        (GUIDE_GROUPS as readonly string[]).includes(s.group),
        `${s.id} is in group "${s.group}", which the rail does not render`,
      );
    }
  });

  test('every declared group has at least one section', () => {
    // An empty group renders as a heading with nothing under it.
    for (const g of GUIDE_GROUPS) {
      assert.ok(GUIDE_SECTIONS.some((s) => s.group === g), `group "${g}" is empty`);
    }
  });
});

describe('the guide says something worth reading', () => {
  test('every section has a real blurb', () => {
    for (const s of GUIDE_SECTIONS) {
      assert.ok(s.blurb.length > 80, `${s.id} has a stub blurb`);
      assert.ok(s.title.length > 5, `${s.id} has no title`);
    }
  });

  test('the prompts are usable sentences, not placeholders', () => {
    for (const s of GUIDE_SECTIONS) {
      for (const a of s.asks ?? []) {
        assert.ok(a.prompt.length > 25, `${s.id} has a stub prompt: "${a.prompt}"`);
        assert.doesNotMatch(a.prompt, /TODO|XYZ|<[a-z]+>/i, `${s.id} prompt has a placeholder`);
      }
    }
  });

  test('the surfaces the product is built on are all covered', () => {
    // The gap that prompted this rewrite: the old guide covered connecting
    // an agent and nothing else.
    const ids = new Set(GUIDE_SECTIONS.map((s) => s.id));
    for (const required of [
      'plans', 'channels', 'system-docs', 'review', 'budgets', 'tickets',
      'terminals', 'mobile', 'graph', 'code-view', 'agent-permissions',
    ]) {
      assert.ok(ids.has(required), `no guide section for "${required}"`);
    }
  });

  test('most sections offer something to ask the agent', () => {
    // Not all — "what this is" is orientation. But a guide of pure prose
    // is the thing being replaced.
    const withAsks = GUIDE_SECTIONS.filter((s) => (s.asks ?? []).length > 0).length;
    assert.ok(
      withAsks >= GUIDE_SECTIONS.length - 3,
      `only ${withAsks}/${GUIDE_SECTIONS.length} sections have prompts`,
    );
  });
});
