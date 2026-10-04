/**
 * How the code got here, with no plan (Phase 32 Track E). A repository
 * nobody planned in; a teammate's agent (codex) works on `billing-v2` in a
 * worktree of it: one commit whose message names it, one made while its
 * session was open there, and an edit not yet committed. The person asks
 * whose a surprising line is and is told the commit, the git author and the
 * agent, with how CodeTrellis knows; then puts the branch beside main and
 * sees only the file it changed, in words. Mirrors the harness tests
 * `history-e` (the done-when), `line-history` (E4), `compare-hash-space` and
 * `line-changes`, against the running app. Catalogued in
 * `docs/DEMO-JOURNEYS.md`, section `code-history`.
 *
 * Window-only, and not scripted here: scrubbing a file's history, Fetch
 * now, and the pull-request list (`/api/git/file-history`, `/api/git/fetch`,
 * `/api/git/branches`) have no MCP tool, and a packaged build has no HTTP.
 */
import path from 'node:path';
import { repoWithAgentBranch, type AgentBranchFixture } from '../../demo-fixtures';
import type { Group } from '../types';

const ROUND = 'export const refund = (x: number) => Math.round(x * 100) / 100;\n';
const HALF_EVEN = "export const halfEven = (x: number) => x; // banker's rounding\n";
const TODO = '// TODO: currencies\n';

interface Compared {
  before: { label: string }; after: { label: string };
  diff: { addedFiles: string[]; removedFiles: string[]; modifiedFiles: string[]; summary: { added: number; removed: number; modified: number } };
}
interface LineChanges { says: string[]; changes: Array<{ branch: string | null; status: string }> }

let fx: AgentBranchFixture;

export const codeHistoryGroup: Group = {
  id: 'code-history',
  title: 'How the code got here',
  async setup(c) {
    fx = repoWithAgentBranch();
    await c.say('A repository nobody planned in', 'A payments service on main, and a teammate\'s worktree on billing-v2. There is no plan anywhere.');
    await c.call('open_project', { path: fx.path });
    // Listing them is what starts their watchers, as the window's strip does.
    await c.call('list_workstreams', { project_path: fx.path, include_idle: true });
  },
  scenes: [
    {
      id: 'whose-line',
      title: 'Whose is this line?',
      watch: 'line history on the teammate\'s file names codex: line 1 from its commit message, line 2 "probably codex" by timing, line 3 not committed',
      async run(c) {
        await c.say('The teammate\'s agent works', 'Codex commits "Round to the cent" on billing-v2 and says so in the message.');
        fx.commit(ROUND, 'Round to the cent\n\nagent: codex · model: o5');
        // Commit times are whole seconds: its session opens clearly after.
        const committed = Date.now();
        await c.until(() => Date.now() - committed >= 1500, 3);
        const codex = await c.agent('codex', { roots: [fx.worktree] });
        await codex.callTool('list_plans', {});
        await c.say('Then commits without saying so', 'With its session open in that worktree, a second commit: "Half-even". The message names nobody. And one line it has not committed.');
        fx.commit(ROUND + HALF_EVEN, 'Half-even');
        fx.write(ROUND + HALF_EVEN + TODO);

        const at = `workstream:${fx.worktree}`;
        const said = async (line: number, side = at, project = fx.path) => {
          const r = await c.call('line_history', { path: fx.file, line, at: side, project_path: project });
          console.log(`    ${r.answer.split('\n')[0]}`);
          return r.answer;
        };
        const first = await said(1, 'commit:refs/heads/billing-v2');
        if (!first.includes('“Round to the cent”') || !first.includes('codex, from the commit message')) c.flag(`line 1 on billing-v2 should be "Round to the cent", codex from the commit message; it says "${first.split('\n')[0]}"`);
        if (!first.includes('Sam Lee')) c.flag(`line 1 should name its git author, Sam Lee; it says "${first.split('\n')[0]}"`);
        const second = await said(2);
        if (!second.includes('“Half-even”') || !second.includes("probably codex: committed while codex's session was open in this checkout")) {
          c.flag(`line 2 should be "Half-even", probably codex by timing; it says "${second.split('\n')[0]}"`);
        } else if (!/session \S+/.test(second)) c.flag('the timing attribution should name the session it came from');
        const third = await said(3);
        if (!third.includes('not yet committed')) c.flag(`line 3 should say it is not committed; it says "${third.split('\n')[0]}"`);

        // In the window: the teammate's checkout, its line history on.
        await c.call('open_project', { path: fx.worktree });
        const live = await said(2, 'live', fx.worktree);
        if (!live.includes('probably codex')) c.flag(`opened as a project, the worktree's line 2 should still say probably codex; it says "${live.split('\n')[0]}"`);
        await c.call('navigate_to', { target: 'changes' });
        await c.say('What is not committed yet', 'The sidebar\'s Changes shows the checkout\'s uncommitted edit, with no plan needed: line 3 is the one with no commit to name.');
        await c.shot('h1-changes', { sidebar: 'changes' });
        await c.call('navigate_to', { target: 'code', file_path: path.join(fx.worktree, fx.file), line: 2, line_history: true });
        await c.say('Whose line is it?', 'The commit, its git author, and the agent, with how CodeTrellis knows: from the message, or "probably", from when its session was open here.');
        await c.shot('h1-whose-line', { file: fx.file });
      },
    },
    {
      id: 'branch-compare',
      title: 'The branch beside main',
      watch: 'billing-v2 against main changes one file, refund.ts; the reader on main says which lines billing-v2 changed, in words',
      async run(c) {
        await c.call('open_project', { path: fx.path });
        await c.say('Put the branch beside main', 'Each line of work is one pick, by its branch. No sha to look up.');
        const offered = await c.json('list_comparands', { project_path: fx.path }) as Array<{ spec: string; label: string; kind: string }> | null;
        const branch = (offered ?? []).find((x) => x.kind === 'branch' && x.spec === `commit:${fx.branch}`);
        if (!branch) { c.flag(`list_comparands should offer billing-v2 as a line of work; it offers ${(offered ?? []).map((x) => x.label).join(', ') || 'nothing'}`); return; }
        console.log(`    offered: ${branch.label}`);

        const cmp = await c.json('compare_snapshots', { project_path: fx.path, before: 'commit:main', after: branch.spec }) as Compared | null;
        if (!cmp) return;
        const { diff } = cmp;
        console.log(`    ${cmp.before.label} → ${cmp.after.label}: ${diff.summary.modified} modified, ${diff.summary.added} added, ${diff.summary.removed} removed`);
        if (diff.modifiedFiles.join() !== fx.file || diff.addedFiles.length || diff.removedFiles.length) {
          c.flag(`main → billing-v2 should change only ${fx.file}; it reports modified [${diff.modifiedFiles.join(', ')}], added [${diff.addedFiles.join(', ')}], removed [${diff.removedFiles.join(', ')}]`);
        }

        const lines = await c.json('get_line_changes', { path: fx.file, workstream: fx.branch, project_path: fx.path }) as LineChanges | null;
        if (!lines) return;
        for (const s of lines.says) console.log(`    ${s}`);
        const mine = lines.changes.find((x) => x.branch === fx.branch);
        if (mine?.status !== 'changed') c.flag(`get_line_changes should say billing-v2 changed ${fx.file}; it says ${mine?.status ?? 'nothing about billing-v2'}`);
        if (!lines.says.length || !lines.says.every((s) => s.startsWith(`${fx.branch} `))) c.flag(`each sentence should name billing-v2; they read ${JSON.stringify(lines.says)}`);
        if (!lines.says.some((s) => s.includes('not committed'))) c.flag(`the uncommitted TODO should read "not committed"; the sentences are ${JSON.stringify(lines.says)}`);

        await c.call('navigate_to', { target: 'code', file_path: path.join(fx.path, fx.file), line: 1 });
        await c.say('The same, on main', 'The reader on main\'s copy names billing-v2 and its lines. Compare with… puts the two side by side.');
        await c.shot('h2-branch-compare', { file: fx.file });
      },
    },
  ],
};
