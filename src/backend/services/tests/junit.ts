/**
 * A JUnit report, test by test (Phase 32 B8.1; observability doc §9).
 *
 * Phase 31 read only a report's totals. Grounding needs each test's last
 * result: which test, in which suite and file, passed, failed, errored or
 * was skipped, how long it took, and the first line of why it failed. The
 * agent runs the tests; CodeTrellis reads what they reported and never runs
 * them. Pure. A report is untrusted text: read with limits, never executed,
 * and anything it names is a label, never a path to open.
 */

export type TestResult = 'passed' | 'failed' | 'error' | 'skipped';

export interface TestCase {
  /** The `<testsuite name>` it sits in, when there is one. */
  suite: string | null;
  /** `classname`: the test file or class, as the runner names it. */
  classname: string | null;
  name: string;
  /** The `file` attribute some runners add (Jest, pytest, Vitest, Playwright). */
  file: string | null;
  result: TestResult;
  /** `time`, in milliseconds, when given. */
  durationMs: number | null;
  /** The first line of the failure or error message. */
  message: string | null;
}

export interface JUnitReport {
  cases: TestCase[];
  totals: { tests: number; passed: number; failed: number; errors: number; skipped: number };
  /** More cases than are read: the rest are counted in nothing. */
  truncated: boolean;
}

export const MAX_CASES = 20_000;
const MAX_TEXT = 300;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (!m) return null;
  const v = decode(m[2] ?? m[3] ?? '').trim();
  return v ? v.slice(0, MAX_TEXT) : null;
}

/** The first line of a failure: its message attribute, else its text. */
function firstLine(tag: string, body: string): string | null {
  const fromAttr = attr(tag, 'message');
  const text = fromAttr ?? decode(body.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')).trim();
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, MAX_TEXT) : null;
}

/**
 * Every test case in a JUnit (or xUnit-style) report, with its suite, or
 * null when the text is not one. Suites nest in some runners; a case takes
 * the nearest enclosing suite's name.
 */
export function parseJUnit(xml: string): JUnitReport | null {
  if (!/<testsuites?\b/.test(xml) && !/<testcase\b/.test(xml)) return null;
  const cases: TestCase[] = [];
  let truncated = false;
  const suites: Array<string | null> = [];
  // Opening and closing suites, and each case with its body when it has one.
  const re = /<testsuite\b([^>]*?)(\/?)>|<\/testsuite>|<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[0].startsWith('</testsuite')) { suites.pop(); continue; }
    if (m[0].startsWith('<testsuite')) {
      if (m[2] !== '/') suites.push(attr(`<s${m[1]}`, 'name'));
      continue;
    }
    if (cases.length >= MAX_CASES) { truncated = true; break; }
    const tag = `<c${m[3] ?? ''}`;
    const body = m[4] ?? '';
    const name = attr(tag, 'name');
    if (!name) continue;
    const failure = /<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(body);
    const error = /<error\b([^>]*?)(?:\/>|>([\s\S]*?)<\/error>)/.exec(body);
    const skipped = /<skipped\b/.test(body);
    const result: TestResult = failure ? 'failed' : error ? 'error' : skipped ? 'skipped' : 'passed';
    const why = failure ?? error;
    const seconds = Number(attr(tag, 'time'));
    cases.push({
      suite: suites.length ? suites[suites.length - 1] : null,
      classname: attr(tag, 'classname'),
      name,
      file: attr(tag, 'file'),
      result,
      durationMs: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null,
      message: why ? firstLine(`<x${why[1] ?? ''}`, why[2] ?? '') : null,
    });
  }
  if (cases.length === 0 && !/<testsuites?\b/.test(xml)) return null;
  const count = (r: TestResult) => cases.filter((c) => c.result === r).length;
  return {
    cases,
    totals: { tests: cases.length, passed: count('passed'), failed: count('failed'), errors: count('error'), skipped: count('skipped') },
    truncated,
  };
}

/** A test's name as a person reads it: "InvoiceTest › rounds half up". */
export function testLabel(c: Pick<TestCase, 'classname' | 'name'>): string {
  return c.classname ? `${c.classname} › ${c.name}` : c.name;
}
