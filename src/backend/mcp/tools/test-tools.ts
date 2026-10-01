/**
 * Test results (Phase 32 B8.1, grounding; observability doc §9).
 *
 * CodeTrellis never runs tests: the agent runs them and hands over the
 * report. `report_tests` reads a JUnit report in the project test by test
 * and keeps each test's last result; `get_test_results` says what the last
 * runs said. The person sees the same in the Checks panel and, from B8.3,
 * on the graph and the task.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../types';
import { authorFromExtra } from '../helpers';
import { ingestTestReport, listTestReports, listTestResults, testsSummary, TestReportError } from '../../services/tests/test-results';
import { groundingOf, NotAFileError } from '../../services/tests/grounding';
import { ConfinementError } from '../../services/confined-fs';

const noProject = { isError: true, content: [{ type: 'text' as const, text: 'No project is open, and none was named.' }] };
const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'report_tests',
    {
      description:
        'Hand over a test run\'s JUnit report so CodeTrellis keeps each test\'s result: which passed, failed, errored or ' +
        'was skipped, and the first line of each failure. CodeTrellis never runs tests; run them yourself with a JUnit ' +
        'reporter (vitest --reporter=junit, jest-junit, pytest --junitxml, go-junit-report, Playwright\'s junit reporter) ' +
        'and pass the file it wrote. Reporting the same file twice changes nothing; an older run never replaces a newer ' +
        'result. Returns the totals and the failing tests by name.',
      inputSchema: {
        path: z.string().min(1).max(500).describe('The JUnit report, relative to the project root (or absolute inside it).'),
        project_path: z.string().optional().describe('Absolute path of an opened project. Defaults to the active project.'),
      },
    },
    async ({ path: file, project_path }, extra: any) => {
      const root = project_path ?? deps.getActiveProjectPath();
      if (!root) return noProject;
      try {
        const out = ingestTestReport(root, file, authorFromExtra(deps, extra));
        if (!out.already) deps.broadcast('tests-reported', { project: root });
        const r = out.report;
        const failing = r.failed + r.errors;
        return text({
          report: r.path,
          ran_at: new Date(r.ranAt).toISOString(),
          totals: { tests: r.tests, passed: r.passed, failing, skipped: r.skipped },
          says: `${r.tests} test${r.tests === 1 ? '' : 's'}, ${failing ? `${failing} failing` : 'none failing'}${r.skipped ? `, ${r.skipped} skipped` : ''}${out.already ? ' (already reported; nothing changed)' : ''}.`,
          failing: out.failing.map((f) => ({ test: f.label, result: f.result, why: f.message })),
          ...(out.truncated ? { note: 'The report has more tests than are read; the rest are not counted.' } : {}),
        });
      } catch (err) {
        if (err instanceof TestReportError) return { isError: true, content: [{ type: 'text' as const, text: err.message }] };
        throw err;
      }
    },
  );

  server.registerTool(
    'get_test_results',
    {
      description:
        'What the last test runs said, from the reports handed over with report_tests or as a test criterion\'s evidence: ' +
        'each test\'s last result and when that run happened, failing first. Pass match to narrow to tests whose file, ' +
        'class or suite contains it (e.g. "billing/invoice"), or failing_only. Pass for_file to ask about a source file ' +
        'instead: its tests are those whose test file imports it (directly or through a barrel), and it reads passing, ' +
        'failing, "tests older than the code" (it changed after they last ran — run them again before claiming done) or ' +
        'no tests. CodeTrellis never runs tests itself.',
      inputSchema: {
        match: z.string().max(300).optional(),
        failing_only: z.boolean().optional(),
        for_file: z.string().min(1).max(500).optional().describe('A source file, relative to the project root: its tests and whether they still hold.'),
        project_path: z.string().optional().describe('Absolute path of an opened project. Defaults to the active project.'),
      },
    },
    async ({ match, failing_only, for_file, project_path }) => {
      const root = project_path ?? deps.getActiveProjectPath();
      if (!root) return noProject;
      if (for_file) {
        try {
          const g = groundingOf(root, for_file);
          return text({
            file: g.path, state: g.state, says: g.words, test_files: g.testFiles,
            ...(g.lastRunAt ? { last_run_at: new Date(g.lastRunAt).toISOString() } : {}),
            ...(g.changedAt ? { changed_at: new Date(g.changedAt).toISOString() } : {}),
            tests: g.tests.filter((t) => !failing_only || t.result === 'failed' || t.result === 'error')
              .map((t) => ({ test: t.label, result: t.result, ...(t.message ? { why: t.message } : {}), test_file: t.testFile })),
          });
        } catch (err) {
          if (err instanceof ConfinementError) return { isError: true, content: [{ type: 'text' as const, text: `${for_file} is not a file inside this project.` }] };
          if (err instanceof NotAFileError) return { isError: true, content: [{ type: 'text' as const, text: err.message }] };
          throw err;
        }
      }
      const tests = listTestResults(root, { match, limit: 200 })
        .filter((t) => !failing_only || t.result === 'failed' || t.result === 'error');
      return text({
        says: testsSummary(root).words,
        tests: tests.map((t) => ({
          test: t.label, file: t.file, result: t.result, ...(t.message ? { why: t.message } : {}),
          ran_at: new Date(t.ranAt).toISOString(), report: t.reportPath,
        })),
        reports: listTestReports(root, 5).map((r) => ({ report: r.path, ran_at: new Date(r.ranAt).toISOString(), tests: r.tests, failing: r.failed + r.errors, by: r.reportedBy })),
      });
    },
  );
}
