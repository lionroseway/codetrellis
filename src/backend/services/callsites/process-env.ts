/**
 * Commands a file runs and environment variables it reads (Phase 33
 * follow-up), as callsites, so a call rule can hold them like an HTTP call or
 * a table: `exec:git`, `env:STRIPE_SECRET_KEY`.
 *
 * Called for every language beside the per-language extractors, as embedded
 * SQL is (`ast-parser`). Unlike SQL, how a command is run or a variable read
 * differs per language, so the patterns are per language; what they find is
 * one shape. Only literals count: `spawn(cmd)` and `process.env[name]` name
 * nothing a rule could hold, and are left out rather than guessed.
 *
 * A command is its program, the first word of what is run, without its
 * folder: `/usr/bin/git status` is `git`. A variable is its name as written:
 * names are case-sensitive.
 */
import type { Callsite, SupportedLanguage } from '../../../shared/types';
import { lineOf } from './shared';

/** A program name: a word with dots, dashes or pluses, nothing a shell would expand. */
const PROGRAM = /^[A-Za-z0-9][\w.+-]{0,63}$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** In each pattern, the last capture group is the program (a command's first word) or the variable. */
const RUN: Partial<Record<SupportedLanguage, RegExp[]>> = {};
const READ: Partial<Record<SupportedLanguage, RegExp[]>> = {};

const JS_RUN = [
  // child_process and execa, with the command or program as the first argument.
  /(?<![\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|execa|execaSync)\s*\(\s*(['"`])\s*([^\s'"`$]+)/g,
];
const JS_READ = [
  /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bprocess\.env\[\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g,
  /\bimport\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /\bDeno\.env\.get\(\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1/g,
];
RUN.typescript = JS_RUN; RUN.javascript = JS_RUN;
READ.typescript = JS_READ; READ.javascript = JS_READ;

RUN.python = [
  /\bsubprocess\.(?:run|call|check_call|check_output|Popen)\s*\(\s*\[\s*(['"])\s*([^\s'"]+)/g,
  /\bsubprocess\.(?:run|call|check_call|check_output|Popen|getoutput|getstatusoutput)\s*\(\s*(['"])\s*([^\s'"]+)/g,
  /\bos\.(?:system|popen)\s*\(\s*(['"])\s*([^\s'"]+)/g,
];
READ.python = [
  /\bos\.environ\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g,
  /\bos\.environ\.get\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g,
  /\bos\.getenv\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g,
];

RUN.go = [/\bexec\.Command(?:Context)?\s*\(\s*(?:[^,()"]+,\s*)?"([^\s"]+)/g];
READ.go = [/\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g];

RUN.ruby = [
  /(?<![\w.])(?:system|spawn|exec)\s*\(?\s*(['"])\s*([^\s'"]+)/g,
  /\bOpen3\.(?:capture2e?|capture3|popen2e?|popen3)\s*\(\s*(['"])\s*([^\s'"]+)/g,
  /%x\(\s*([^\s)]+)/g,
];
READ.ruby = [
  /\bENV\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g,
  /\bENV\.fetch\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g,
];

RUN.csharp = [
  /\bProcess\.Start\s*\(\s*"([^\s"]+)/g,
  /\bnew\s+ProcessStartInfo\s*\(\s*"([^\s"]+)/g,
];
READ.csharp = [/\bEnvironment\.GetEnvironmentVariable\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g];

const JVM_RUN = [
  /\bProcessBuilder\s*\(\s*(?:(?:listOf|mutableListOf|arrayOf|List\.of|Arrays\.asList)\s*\(\s*)?"([^\s"]+)/g,
  /\bRuntime\.getRuntime\(\)\.exec\s*\(\s*"([^\s"]+)/g,
];
const JVM_READ = [/\bSystem\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g];
RUN.kotlin = JVM_RUN; RUN.java = JVM_RUN;
READ.kotlin = JVM_READ; READ.java = JVM_READ;

RUN.swift = [
  /\bexecutableURL\s*=\s*URL\s*\(\s*fileURLWithPath:\s*"([^\s"]+)/g,
  /\blaunchPath\s*=\s*"([^\s"]+)/g,
];
READ.swift = [/\benvironment\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]/g];

RUN.rust = [/\bCommand::new\(\s*"([^\s"]+)/g];
READ.rust = [/\benv::var(?:_os)?\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g];

RUN.php = [/\b(?:exec|shell_exec|system|passthru|proc_open|popen)\s*\(\s*(['"])\s*([^\s'"]+)/g];
READ.php = [
  /\bgetenv\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1/g,
  /\$_(?:ENV|SERVER)\[\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g,
];

/** `/usr/bin/git status` → `git`; null when it names no program a rule could hold. */
export function programOf(command: string): string | null {
  const first = command.trim().split(/\s+/)[0] ?? '';
  const name = first.slice(first.lastIndexOf('/') + 1).replace(/\.exe$/i, '');
  return PROGRAM.test(name) ? name : null;
}

/** The commands `content` runs and the environment variables it reads, each once per line. */
export function extractProcessAndEnv(language: SupportedLanguage, content: string): Callsite[] {
  const out: Callsite[] = [];
  const seen = new Set<string>();
  const add = (cs: Callsite) => {
    const k = `${cs.kind}\0${cs.urlPattern}\0${cs.line}`;
    if (!seen.has(k)) { seen.add(k); out.push(cs); }
  };
  for (const re of RUN[language] ?? []) {
    re.lastIndex = 0;
    for (let m = re.exec(content); m; m = re.exec(content)) {
      const program = programOf(m[m.length - 1]);
      if (program) add({ kind: 'subprocess', protocol: 'subprocess', line: lineOf(content, m.index), urlPattern: program, context: m[0].slice(0, 120) });
    }
  }
  for (const re of READ[language] ?? []) {
    re.lastIndex = 0;
    for (let m = re.exec(content); m; m = re.exec(content)) {
      const name = m[m.length - 1];
      if (VARIABLE.test(name)) add({ kind: 'env_lookup', protocol: 'env', line: lineOf(content, m.index), urlPattern: name, context: m[0].slice(0, 120) });
    }
  }
  return out;
}
