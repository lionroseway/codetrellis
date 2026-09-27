/**
 * No handler writes a fixed author — Phase 32, carried from the 0.7 review.
 *
 * Authorship went wrong the same way four times in Stage 0: a handler that
 * forgot to ask who was calling, or wrote a literal. Bug 43 recorded every
 * agent as "agent"; bug 47 recorded an agent's system doc as the person's and
 * took the author from the request body; bug 49 wrote "mcp-agent" whoever
 * called; the grant escalation let the phone and plain HTTP act as the
 * person. Each fix was local, and the next handler written looked exactly
 * like the ones before. Workstream attribution is Track A's core, so this is
 * a structural guard, the same move as `server-confinement.test.ts`.
 *
 * The rule, by transport (§0.4d, the owner's decision):
 *
 *   REST (server.ts)     `personFrom(req)` / `actorFrom(req)` / `decisionFrom(req)`:
 *                        the app window is the person, plain HTTP `unverified`.
 *   phone (mobile-rpc)   `phonePerson()` / `phoneActor()`: the person on that device.
 *   MCP (mcp/tools)      `authorFromExtra(deps, extra)`: the agent that called.
 *
 * Only those helpers may name the person, and nothing takes an author from
 * what the caller sent.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const read = (rel: string) => fs.readFileSync(path.join(HERE, rel), 'utf8');

/** Source with comments removed and the named functions' bodies blanked. */
function outside(source: string, helpers: string[]): string {
  // Line breaks are kept throughout, so a failure names the real line.
  const blank = (m: string) => m.replace(/[^\n]/g, '');
  let s = source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const name of helpers) {
    const at = s.search(new RegExp(`function ${name}\\(`));
    assert.ok(at >= 0, `helper ${name} not found — the guard is checking nothing`);
    // The body is the block that ends the signature's line; an inline return
    // type (`(): { author: string }`) is not it.
    const open = s.indexOf('{\n', at);
    let depth = 0;
    let end = open;
    for (; end < s.length; end++) {
      if (s[end] === '{') depth++;
      else if (s[end] === '}' && --depth === 0) break;
    }
    // Signature and body both: its return type names the person too.
    s = s.slice(0, at) + blank(s.slice(at, end + 1)) + s.slice(end + 1);
  }
  return s;
}

/** Lines of `source` matching `re`, with their numbers, for a readable failure. */
function hits(source: string, re: RegExp): string[] {
  return source.split('\n').flatMap((l, i) => (re.test(l) ? [`${i + 1}: ${l.trim()}`] : []));
}

// A value, not a type: `authorType: 'human' | 'unverified'` declares, it does not write.
const NAMES_THE_PERSON = /getAuthorKey\(|\b(author|actor|by)Type:\s*['"`]human['"`](?!\s*\|)|cameFromAppWindow\([^)]*\)\s*\?\s*['"`]human/;
const AUTHOR_FROM_CALLER = /\{[^}]*\bauthor(Type)?\b[^}]*\}\s*=\s*req\.body|req\.body\??\.author|\bbody\??\.author\b|\bparams\??\.author\b|\bparams\[['"`]author/;

describe('REST handlers take their author from how the request arrived', () => {
  const server = read('server.ts');
  const HELPERS = ['personFrom', 'actorFrom', 'decisionFrom'];

  test('only personFrom, actorFrom and decisionFrom name the person', () => {
    assert.deepEqual(hits(outside(server, HELPERS), NAMES_THE_PERSON), []);
  });

  test('no handler reads an author from the request body', () => {
    assert.deepEqual(hits(outside(server, []), AUTHOR_FROM_CALLER), []);
  });

  test('the helpers themselves decide by the app window, not by default', () => {
    for (const name of ['personFrom', 'actorFrom', 'decisionFrom']) {
      const body = server.slice(server.indexOf(`function ${name}(`)).split('\n}\n')[0];
      assert.match(body, /cameFromAppWindow\(req\)/, `${name} must tell the app window from plain HTTP`);
    }
  });
});

describe('phone RPC handlers write as the person on that device', () => {
  const rpc = read('services/mobile-rpc-service.ts');

  test('only phonePerson and phoneActor name the person', () => {
    assert.deepEqual(hits(outside(rpc, ['phonePerson', 'phoneActor']), NAMES_THE_PERSON), []);
  });

  test('no phone handler takes an author from its params', () => {
    assert.deepEqual(hits(outside(rpc, []), AUTHOR_FROM_CALLER), []);
  });
});

describe('MCP tools write as the agent that called', () => {
  const dir = path.join(HERE, 'mcp', 'tools');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  test('there are tool files to check', () => {
    assert.ok(files.length >= 15, `only ${files.length} tool files found`);
  });

  for (const f of files) {
    test(`${f}: no literal author, never the person, and no author from the arguments`, () => {
      const src = outside(fs.readFileSync(path.join(dir, f), 'utf8'), []);
      assert.deepEqual(hits(src, NAMES_THE_PERSON), [], 'names the person');
      assert.deepEqual(hits(src, /\bauthor(Type)?:\s*['"`]/), [], 'a literal author');
      assert.deepEqual(hits(src, /\bauthor(_type|Type)?:\s*z\./), [], 'an author the agent can set');
    });
  }
});
