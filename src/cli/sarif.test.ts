import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { importLine, toSarif } from './sarif';
import type { Gate } from './conformity';

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'sarif', 'sarif-schema-2.1.0.json'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const files: Record<string, string> = {
  'services/api/app/routes/users.py': 'from fastapi import APIRouter\nfrom app.config import DATABASE_URL\nfrom app.db import session\n',
  'web/report.ts': "import { x } from './util';\nimport { client } from '../db/client';\n",
};
const gate: Gate = {
  ok: false, files: 3, base: 'origin/main', notes: [],
  says: [],
  rules: [
    { path: 'services/api/app/routes/users.py', imports: 'services/api/app/config.py', rule: 'routes-not-config', words: 'routes/ may not import config.py', because: 'routes read settings through the app', strength: 'block' },
    { path: 'web/report.ts', imports: 'db/client.ts', rule: 'web-not-db', words: 'web/ may not import db/', because: '', strength: 'warn' },
  ],
  rulebook: [
    { rule: 'web-not-db', change: 'changed', effect: 'loosens', words: '✗ This change lowers the rule web-not-db from block to warn.' },
    { rule: 'old', change: 'removed', effect: 'loosens', words: '✓ This change removes the rule old. Sam approved it in the app, signed.', approval: { ok: true } },
  ],
  breakpoints: [{ path: 'web/report.ts', breakpoint: 'b1', note: 'ask me first', by: 'Dana' }],
  tests: [{ path: 'web/report.ts', state: 'failing', says: '✗ 1 of 3 tests failing' }],
  criteria: [{ item_uid: 'i1', task: 'Ship exports', criterion: 'exports pass', findings: ['test failed'] }],
  docs: [{ uid: 'd1', title: 'Exports', slug: 'exports', verified_at: 'abc1234', files: ['web/report.ts'] }],
};
const log = toSarif(gate, { version: '0.2.0', root: '/repo', read: (rel) => files[rel] ?? null, ruleFile: (id) => `.codetrellis/rules/${id === 'old' ? 'payments' : 'architecture'}.yaml` });

test('the gate as SARIF validates against the SARIF 2.1.0 schema', () => {
  assert.equal(validate(log), true, JSON.stringify(validate.errors, null, 2));
  // And the schema bites: a log with no runs, or a result with an unknown level, is not SARIF.
  assert.equal(validate({ version: '2.1.0' }), false);
  assert.equal(validate({ ...log, runs: [{ ...log.runs[0], results: [{ ...log.runs[0].results[0], level: 'fatal' }] }] }), false);
});

test('a breach is at its import line, an error at block and a warning at warn, in the words the text says', () => {
  const [a, b] = log.runs[0].results;
  assert.deepEqual(a.locations[0].physicalLocation, { artifactLocation: { uri: 'services/api/app/routes/users.py', uriBaseId: 'SRCROOT' }, region: { startLine: 2 } });
  assert.equal(a.level, 'error');
  assert.equal(a.message.text, 'services/api/app/routes/users.py now imports services/api/app/config.py, which the rule “routes/ may not import config.py” forbids: routes read settings through the app');
  assert.equal(b.level, 'warning');
  assert.equal(b.locations[0].physicalLocation.region?.startLine, 2);
});

test('a loosening is an error at its suite file; an approved one is a note; every other finding has its file', () => {
  const r = log.runs[0].results;
  const book = r.filter((x) => x.ruleId === 'rulebook/change');
  assert.deepEqual(book.map((x) => [x.level, x.locations[0].physicalLocation.artifactLocation.uri]), [['error', '.codetrellis/rules/architecture.yaml'], ['note', '.codetrellis/rules/payments.yaml']]);
  assert.deepEqual(r.map((x) => x.ruleId), ['rule/routes-not-config', 'rule/web-not-db', 'rulebook/change', 'rulebook/change', 'codetrellis/breakpoint', 'codetrellis/tests', 'codetrellis/doc', 'codetrellis/criterion']);
  assert.deepEqual(log.runs[0].tool.driver.rules.map((x) => x.id), ['rule/routes-not-config', 'rule/web-not-db', 'rulebook/change', 'codetrellis/breakpoint', 'codetrellis/tests', 'codetrellis/doc', 'codetrellis/criterion']);
});

test('a conforming change is an empty run that still validates', () => {
  const empty = toSarif({ ...gate, ok: true, rules: [], rulebook: [], breakpoints: [], tests: [], criteria: [], docs: [] }, { version: '0.2.0', root: '/repo', read: () => null, ruleFile: () => 'x' });
  assert.deepEqual(empty.runs[0].results, []);
  assert.equal(validate(empty), true);
});

test('the import line is found across languages, and not in a comment or a string', () => {
  assert.equal(importLine("// db/client is not used\nimport { c } from '../db/client';\n", 'db/client.ts'), 2);
  assert.equal(importLine('package main\n\nimport (\n  "fmt"\n)\nimport "example.com/ledger"\n', 'internal/ledger/ledger.go'), 6);
  assert.equal(importLine('const s = "client";\n', 'db/client.ts'), null);
  assert.equal(importLine("const c = require('./db/client');\n", 'db/client.js'), 1);
});
