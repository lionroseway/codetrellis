/**
 * Read many files as they were at one commit, without holding the event loop.
 *
 * Pinning the baseline to a commit used to run one synchronous `git show`
 * per tracked file, images and lockfiles included. On this repository that
 * held the server for seconds at a time: no HTTP, WebSocket or MCP request
 * was answered until it finished, and a browser test on the other worker
 * waited fifteen seconds for a socket to open. One `git cat-file --batch`
 * process now answers every path, asynchronously.
 */
import { spawn } from 'node:child_process';
import { isSafeGitRef } from './git-safety';

/**
 * The text of each path at `commit`, keyed by the path as given. A path the
 * commit does not have is left out, as is one that is not a file.
 */
export function readBlobsAtCommit(root: string, commit: string, paths: string[]): Promise<Map<string, string>> {
  // The batch protocol is one request per line, so a path with a newline in it cannot be asked for.
  const wanted = paths.filter((p) => !p.includes('\n'));
  if (!isSafeGitRef(commit)) return Promise.reject(new Error(`"${String(commit).slice(0, 80)}" is not a commit`));
  if (wanted.length === 0) return Promise.resolve(new Map());

  return new Promise((resolve, reject) => {
    const git = spawn('git', ['-C', root, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    git.stdout.on('data', (c: Buffer) => chunks.push(c));
    git.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    git.on('error', reject);
    git.on('close', (code) => {
      if (code !== 0) { reject(new Error(`git cat-file exited ${code}: ${stderr.trim().slice(0, 200)}`)); return; }
      resolve(parseBatch(Buffer.concat(chunks), wanted));
    });
    git.stdin.on('error', () => { /* git exited early; its close event reports why */ });
    git.stdin.end(wanted.map((p) => `${commit}:${p}\n`).join(''));
  });
}

/** Answers come back in the order asked: `<sha> <type> <size>\n<content>\n`, or `<name> missing\n`. */
function parseBatch(out: Buffer, wanted: string[]): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  for (const p of wanted) {
    const eol = out.indexOf(0x0a, at);
    if (eol < 0) break;
    const header = out.toString('utf8', at, eol);
    at = eol + 1;
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (!m) continue; // "<name> missing", or ambiguous
    const size = Number(m[2]);
    if (m[1] === 'blob') files.set(p, out.toString('utf8', at, at + size));
    at += size + 1;
  }
  return files;
}
