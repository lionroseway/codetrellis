/**
 * A rule sees a Python import wherever in the file it is, and on an upgrade,
 * in files that have not changed.
 *
 * A `kind: package` rule recorded 30 breaches where 57 files imported the
 * package: the parser read only the top level, and the other 27 imported inside
 * a function or a `try:`. Reading deeper was not enough on its own. The AST rows
 * outlive a restart and an incremental scan skips an unchanged file, so a machine
 * that had already scanned kept the old answer while a fresh CI scan gave the new
 * one. Both halves are here: every kind of rule that reads imports, and a database
 * written by an older version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, createClient, type Harness, type RunningBackend } from '../harness';

const TOP = 'pyapp/web/top.py';
const IN_FUNCTION = 'pyapp/web/in_function.py';
const IN_TRY = 'pyapp/web/in_try.py';
const IN_TYPE_CHECKING = 'pyapp/web/in_type_checking.py';
const WRAPPER = 'pyapp/llm/wrapper.py';
const DB = 'pyapp/db/conn.py';
const VIEW = 'pyapp/web/view.py';

const SUITE = `suite: python
rules:
  - id: ollama-via-wrapper
    kind: package
    package: pypi:langchain-ollama
    only: [pyapp/llm/]
    strength: block
  - id: web-not-db
    from: pyapp/web/
    mayNotImport: pyapp/db/
    strength: block
  - id: raw-only-in-db
    kind: symbol
    symbol: ${DB}#raw
    only: [pyapp/db/]
    strength: block
`;

interface RuleView { rule: { id: string }; breaches: Array<{ from: string; to: string }> | null }

test.describe.serial('Python imports at any depth', () => {
  test.setTimeout(240_000);
  let h: Harness;
  let root: string;
  let client: ReturnType<typeof createClient>;
  let backend: RunningBackend | null = null;

  const breachesOf = async (id: string) => {
    const res = await client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`);
    const rules = ((await res.json()) as { rules: RuleView[] }).rules;
    return (rules.find((r) => r.rule.id === id)?.breaches ?? []).map((b) => `${b.from} > ${b.to}`).sort();
  };
  /** Close the backend, do something to its database as an older version would have left it, and start again. */
  const restartAfter = async (change: (db: DatabaseSync) => void) => {
    await (backend ?? h.backend).stop();
    const db = new DatabaseSync(path.join(h.fixture.dataDir, 'data.db'));
    change(db);
    db.close();
    backend = await startBackend({ dataDir: h.fixture.dataDir });
    client = createClient(backend.baseUrl, backend.capabilityToken);
    await client.scanProject(root);
  };
  const forgetInFunction = (db: DatabaseSync) => {
    const gone = db.prepare(`DELETE FROM imports WHERE source_path = 'langchain_ollama' AND file_id = (SELECT id FROM files WHERE relative_path = ?)`).run(IN_FUNCTION);
    expect(gone.changes, 'the row an older parser would not have written').toBe(1);
  };

  test.beforeAll(async () => {
    h = await setupHarness('python-nested-imports');
    root = h.fixture.projectPath;
    client = h.client;
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    write(TOP, 'import langchain_ollama\n');
    write(IN_FUNCTION, 'def f():\n    from langchain_ollama import OllamaLLM\n    return OllamaLLM\n');
    write(IN_TRY, 'try:\n    import langchain_ollama\nexcept ImportError:\n    langchain_ollama = None\n');
    write(IN_TYPE_CHECKING, 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from langchain_ollama import OllamaLLM\n');
    write(WRAPPER, 'def llm():\n    from langchain_ollama import OllamaLLM\n    return OllamaLLM()\n');
    write(DB, 'def raw(sql):\n    return sql\n');
    write(VIEW, 'def view():\n    from pyapp.db.conn import raw\n    return raw("select 1")\n');
    write('.codetrellis/rules/python.yaml', SUITE);
    await client.scanProject(root);
  });

  test.afterAll(async () => {
    await backend?.stop();
    await h?.teardown();
  });

  const NESTED_AND_TOP = [IN_FUNCTION, IN_TRY, IN_TYPE_CHECKING, TOP].map((f) => `${f} > pypi:langchain_ollama`).sort();

  test('a package rule finds every import of it, spelled as pip spells it; its own files may', async () => {
    expect(await breachesOf('ollama-via-wrapper')).toEqual(NESTED_AND_TOP);
  });

  test('an imports rule and a symbol rule see a nested import too', async () => {
    expect(await breachesOf('web-not-db')).toEqual([`${VIEW} > ${DB}`]);
    expect(await breachesOf('raw-only-in-db')).toEqual([`${VIEW} > ${DB}#raw`]);
  });

  test('the same version keeps what it stored: a scan after a restart is still incremental', async () => {
    await restartAfter(forgetInFunction);
    expect(await breachesOf('ollama-via-wrapper')).toEqual(NESTED_AND_TOP.filter((b) => !b.startsWith(IN_FUNCTION)));
  });

  test('a database an older version wrote is parsed again, though no file changed', async () => {
    await restartAfter((db) => {
      db.exec('PRAGMA user_version = 2000'); // 0.2.0's
    });
    expect(await breachesOf('ollama-via-wrapper')).toEqual(NESTED_AND_TOP);
  });

  test('and once only: the next restart is incremental again', async () => {
    await restartAfter(forgetInFunction);
    expect(await breachesOf('ollama-via-wrapper')).toEqual(NESTED_AND_TOP.filter((b) => !b.startsWith(IN_FUNCTION)));
  });
});
