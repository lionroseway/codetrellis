/**
 * The guide is how an agent learns what it can offer. It had stopped
 * knowing.
 *
 * 47 of 174 tools were undocumented, and they were not scattered — they
 * were five whole feature areas: budgets, ticket intake, compare and
 * playback, plan review and PR drafts, and everything peers / audio /
 * contributions. An agent reading this guide could not offer any of them,
 * so no user found them. The features shipped; the ability to mention them
 * did not.
 *
 * This is the same list-drift that `findUnparsedLanguages` and
 * `findUnscannedExtensions` exist to catch, in a fourth place. Same
 * remedy: enumerate what actually exists, compare against what is
 * declared, and fail loudly.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSkillGuide, type SkillFlavor } from './skill-guide';

// The `summary` flavour reads real plans and sessions, so it needs a
// database — an empty one is fine and is what a fresh install has.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guide-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

before(async () => {
  const db = await import('../services/database');
  await db.initDatabase();
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const TOOLS_DIR = path.resolve(import.meta.dirname, 'tools');

/**
 * Every tool name the tool modules register, read from source.
 *
 * Deliberately NOT imported from the capability matrix: that matrix is
 * itself a hand-kept list, and checking one hand-kept list against another
 * proves only that someone typed the same thing twice.
 */
function registeredTools(): string[] {
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
  return [...names].sort();
}

/**
 * Tools deliberately left out of the guide, with the reason.
 *
 * Empty, and that is the intended state. An entry here is a decision that
 * an agent does not need to know a tool exists — which is rarely true, so
 * it should be hard to add and always explained.
 */
const INTENTIONALLY_UNDOCUMENTED: Record<string, string> = {};

const FLAVOURS: SkillFlavor[] = [
  'summary', 'quickstart', 'power-user', 'ui-nav', 'diagnostics', 'multi-agent',
];

describe('the guide covers the tools that exist', () => {
  test('every registered tool is named somewhere in the guide', () => {
    const guide = FLAVOURS.map((f) => buildSkillGuide(f)).join('\n');
    const missing = registeredTools().filter(
      (t) => !(t in INTENTIONALLY_UNDOCUMENTED) && !new RegExp(`\\b${t}\\b`).test(guide),
    );
    assert.deepEqual(
      missing,
      [],
      `these tools exist and no agent will ever hear about them: ${missing.join(', ')}`,
    );
  });

  test('the probe actually found tools', () => {
    // Guarding the guard: a broken regex would make the assertion above
    // pass by finding nothing to check.
    assert.ok(registeredTools().length > 150, `only found ${registeredTools().length}`);
  });

  test('nothing is excused without a reason', () => {
    for (const [tool, reason] of Object.entries(INTENTIONALLY_UNDOCUMENTED)) {
      assert.ok(reason.length > 20, `${tool} is excluded with no real reason`);
    }
  });
});

describe('the guide tells an agent what to offer, and what it may be refused', () => {
  const summary = () => buildSkillGuide('summary');

  test('the journeys are there, in the flavour agents fetch on connect', () => {
    // An agent with only a tool list uses the tools it was asked about and
    // never mentions the rest.
    const g = summary();
    assert.match(g, /What you can offer the user/);
    for (const journey of [
      'Understand a codebase',
      'Start from a ticket',
      'See what actually changed',
      'Review before the PR',
      'Keep time and cost in check',
    ]) {
      assert.match(g, new RegExp(journey), journey);
    }
  });

  test('refusals are explained, so an agent passes them on instead of retrying', () => {
    const g = summary();
    assert.match(g, /When a tool is refused/);
    // The three that are off on a fresh install.
    for (const cap of ['terminal', 'capture', 'settings']) {
      assert.match(g, new RegExp(`\`${cap}\``), cap);
    }
    assert.match(g, /Settings → MCP Server/);
  });

  test('every flavour builds without throwing', () => {
    for (const f of FLAVOURS) {
      assert.ok(buildSkillGuide(f).length > 200, f);
    }
  });
});
