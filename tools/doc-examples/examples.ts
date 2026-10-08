/**
 * Phase 33 B7 — the worked examples in the docs, read out so a test can run
 * them. An example is a run of fenced blocks whose info string names it:
 *
 *     ```yaml example=api-calls file=.codetrellis/rules/payments.yaml at=main
 *     ```ts example=api-calls file=src/api/refunds.ts at=change
 *     ```json example=ledger agent=report        (what the agent reports)
 *     ```sh example=api-calls exit=3             (run on the change's branch)
 *     ```text example=api-calls                  (what it prints, exactly)
 *
 * Files `at=main` are the base's first commit; files `at=change` are
 * committed on a branch from it. Each `sh` block runs in order, and the
 * `text` block after it is what it must print. Markdown renderers show the
 * language and hide the rest, so the page reads as an ordinary page.
 *
 * Pure: the test in tests/e2e/rules-docs.test.ts runs what this reads.
 */

export interface DocFile { path: string; at: 'main' | 'change'; text: string }
export interface DocStep { commands: string; exit: number; output: string | null; line: number }
export interface DocExample { id: string; line: number; files: DocFile[]; report: unknown; steps: DocStep[] }

const FENCE = /^(`{3,})(.*)$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

function attrs(info: string): { lang: string; tags: Record<string, string> } {
  const [lang = '', ...rest] = info.trim().split(/\s+/);
  const tags: Record<string, string> = {};
  for (const t of rest) {
    const i = t.indexOf('=');
    if (i > 0) tags[t.slice(0, i)] = t.slice(i + 1);
  }
  return { lang, tags };
}

/** The examples on a page, in the order they first appear; what is malformed throws, naming the line. */
export function docExamples(markdown: string, page = 'the page'): DocExample[] {
  const lines = markdown.split('\n');
  const byId = new Map<string, DocExample>();
  const where = (n: number) => `${page}:${n}`;
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (!open) continue;
    const start = i + 1;
    const body: string[] = [];
    for (i++; i < lines.length && lines[i] !== open[1]; i++) body.push(lines[i]);
    if (i >= lines.length) throw new Error(`${where(start)}: a fence that never closes`);
    const { lang, tags } = attrs(open[2]);
    const id = tags.example;
    if (!id) continue;
    if (!ID.test(id)) throw new Error(`${where(start)}: example=${id} is not a name (lowercase letters, digits and -)`);
    let ex = byId.get(id);
    if (!ex) byId.set(id, (ex = { id, line: start, files: [], report: null, steps: [] }));
    const text = `${body.join('\n')}\n`;
    if (tags.file) {
      const at = tags.at;
      if (at !== 'main' && at !== 'change') throw new Error(`${where(start)}: file=${tags.file} needs at=main or at=change`);
      if (tags.file.startsWith('/') || tags.file.split('/').includes('..')) throw new Error(`${where(start)}: file=${tags.file} must stay inside the repository`);
      ex.files.push({ path: tags.file, at, text });
    } else if (tags.agent === 'report') {
      if (ex.report !== null) throw new Error(`${where(start)}: example ${id} has two agent reports`);
      try { ex.report = JSON.parse(text); } catch (err) { throw new Error(`${where(start)}: the agent report is not JSON (${(err as Error).message})`); }
    } else if (lang === 'sh') {
      const exit = tags.exit === undefined ? 0 : Number(tags.exit);
      if (!Number.isInteger(exit)) throw new Error(`${where(start)}: exit=${tags.exit} is not a number`);
      ex.steps.push({ commands: text, exit, output: null, line: start });
    } else if (lang === 'text') {
      const step = ex.steps[ex.steps.length - 1];
      if (!step || step.output !== null) throw new Error(`${where(start)}: a text block in example ${id} with no sh block before it`);
      step.output = body.join('\n').trimEnd();
    } else {
      throw new Error(`${where(start)}: a ${lang || 'plain'} block in example ${id} that is neither a file (file=… at=…), the agent's report (agent=report), a command (sh) nor its output (text)`);
    }
  }
  for (const ex of byId.values()) {
    if (!ex.steps.length) throw new Error(`${where(ex.line)}: example ${ex.id} runs nothing (no sh block)`);
    if (!ex.files.some((f) => f.at === 'change')) throw new Error(`${where(ex.line)}: example ${ex.id} changes nothing (no file at=change)`);
    for (const s of ex.steps) if (s.output === null) throw new Error(`${where(s.line)}: example ${ex.id} runs a command whose output the page does not show`);
  }
  return [...byId.values()];
}
