/**
 * Phase 33 C9 — a review on your own device counts on the pull request.
 *
 * A review run on a developer's machine, by any agent (`codetrellis review`,
 * or Cursor, Codex, Claude Code or any MCP client through `get_review_bundle`
 * and `report_review`), is checked by code (C4b) and then signed by
 * CodeTrellis with the device's key, never by the agent. The signed statement
 * is a git note on the commit it reviewed (`refs/notes/codetrellis-reviews`),
 * so it changes neither the commit nor the diff; `codetrellis review publish`
 * pushes it.
 *
 * In CI, `codetrellis review verify` reads the note on the pull request's head
 * and verifies it against the device keys already on the base: no secret, no
 * AI and no app. A review whose signature does not hold is refused; a review
 * of an earlier commit is stale, said with the commit it was of.
 *
 * Pure but for git: this module is read by the CLI in CI as well as the app.
 */
import { execFileSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';
import { canonicalJson, parseKeyIntroduction, parseSignature, verifyWithDevice, type RecordSignature } from './task-records/signing';

export const NOTES_REF = 'refs/notes/codetrellis-reviews';
export const REVIEW_NAMESPACE = 'codetrellis-review';
const KEYS_DIR = '.codetrellis/keys';
const MAX_NOTE = 512 * 1024;
const COMMIT = /^[0-9a-f]{40}$/;
/** A key's fingerprint, short enough to say and long enough to tell apart: `SHA256:dXk3p9Qa7Zm2`. */
const shortKey = (fp: string): string => (fp.startsWith('SHA256:') ? fp.slice(0, 19) : fp.slice(0, 12));

/** One kept finding, as signed. */
export interface SignedFinding { kind: string; path: string | null; start: number | null; end: number | null; quote: string | null; says: string; rule: string | null; fix: string | null }

/** What a device signs about a review: which commit, against what, who reviewed, and what held. */
export interface ReviewStatement {
  kind: 'codetrellis-review';
  version: 1;
  /** The commit reviewed: every file the review read was this commit's. */
  head: string;
  /** What it was compared with (the merge base), or null. */
  base: string | null;
  /** The agent that reviewed: `cursor`, `claude-code`. */
  agent: string;
  outcome: string;
  reason: string | null;
  scope: string;
  findings: SignedFinding[];
  dropped: number;
  /** The device key's fingerprint. */
  signer: string;
  at: string;
}

export const statementBytes = (s: ReviewStatement): string => canonicalJson(s);
export const signedBytes = (bytes: string): string => `${REVIEW_NAMESPACE}\n${bytes}`;

/** One attestation as it sits in the note: a YAML document. */
export function attestationYaml(s: ReviewStatement, signature: RecordSignature): string {
  return `---\n# CodeTrellis: a review of this commit, made on a developer's device and signed by its key.\n`
    + `kind: ${REVIEW_NAMESPACE}\nversion: 1\nstatement: ${JSON.stringify(statementBytes(s))}\nsignature: ${JSON.stringify(signature)}\n`;
}

export interface Attestation { statement: ReviewStatement; bytes: string; signature: RecordSignature }

/** The attestations in a note's text; what cannot be read is said, not believed. */
export function parseNote(text: string): { attestations: Attestation[]; unreadable: number } {
  if (Buffer.byteLength(text, 'utf8') > MAX_NOTE) return { attestations: [], unreadable: 1 };
  const out: Attestation[] = [];
  let unreadable = 0;
  for (const doc of parseAllDocuments(text)) {
    if ('errors' in doc && doc.errors.length) { unreadable++; continue; }
    let raw: unknown;
    try { raw = doc.toJS({ maxAliasCount: 0 }); } catch { unreadable++; continue; }
    if (raw === null || raw === undefined) continue;
    const r = raw as Record<string, unknown>;
    const signature = parseSignature(r.signature);
    if (r.kind !== REVIEW_NAMESPACE || r.version !== 1 || typeof r.statement !== 'string' || !signature) { unreadable++; continue; }
    let s: ReviewStatement;
    try { s = JSON.parse(r.statement) as ReviewStatement; } catch { unreadable++; continue; }
    if (s.kind !== REVIEW_NAMESPACE || typeof s.head !== 'string' || typeof s.signer !== 'string' || !Array.isArray(s.findings)) { unreadable++; continue; }
    out.push({ statement: s, bytes: r.statement, signature });
  }
  return { attestations: out, unreadable };
}

const git = (root: string, args: string[]): string | null => {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }); } catch { return null; }
};

/** The note on a commit, or null. */
export function noteOn(root: string, commit: string): string | null {
  return git(root, ['notes', `--ref=${NOTES_REF}`, 'show', commit]);
}

/** The device keys a commit lists under `.codetrellis/keys/`, by fingerprint. */
export function devicesAt(root: string, commit: string): Map<string, string> {
  const devices = new Map<string, string>();
  for (const line of (git(root, ['ls-tree', '--name-only', commit, `./${KEYS_DIR}/`]) ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 500)) {
    const name = line.split('/').pop()!;
    const m = /^([a-f0-9]{8,32})\.yaml$/.exec(name);
    if (!m) continue;
    const text = git(root, ['show', `${commit}:./${KEYS_DIR}/${name}`]);
    if (!text) continue;
    const parsed = parseKeyIntroduction(text, m[1]);
    if ('key' in parsed) devices.set(parsed.key.fingerprint, parsed.key.publicKey);
  }
  return devices;
}

/** Why an attestation does not hold for `commit`, or null when it does. */
export function attestationProblem(a: Attestation, commit: string, devices: ReadonlyMap<string, string>): string | null {
  if (a.statement.head !== commit) return `it is signed as a review of ${a.statement.head.slice(0, 7)}, not of the commit it is on`;
  if (a.signature.how !== 'device') return 'it is not signed by a device key';
  if (a.signature.key !== a.statement.signer) return 'it names one signer and is signed by another';
  const pub = devices.get(a.signature.key);
  if (!pub) return `its key (${shortKey(a.signature.key)}) is not one the base branch lists under ${KEYS_DIR}/`;
  if (!verifyWithDevice(pub, signedBytes(a.bytes), a.signature.value)) return 'its signature does not verify: it was changed after it was signed, or forged';
  return null;
}

export type ReviewState = 'verified' | 'stale' | 'refused' | 'none';

export interface VerifiedReview {
  state: ReviewState;
  head: string;
  /** The review that holds: on the head, or (stale) on the newest earlier commit that has one. */
  review: ReviewStatement | null;
  /** Reviews on the head that did not hold, with why. */
  refused: Array<{ agent: string; why: string }>;
  words: string;
}

/**
 * The review that counts for `head`, judged by the device keys on `baseCommit`
 * (R2: a branch cannot list its own key). The newest that holds wins; with
 * none on the head, the newest on an earlier commit since the base is stale.
 */
export function verifyReview(root: string, head: string, baseCommit: string): VerifiedReview {
  if (!COMMIT.test(head) || !COMMIT.test(baseCommit)) return { state: 'none', head, review: null, refused: [], words: 'The head or the base is not a commit here.' };
  const devices = devicesAt(root, baseCommit);
  const held = (commit: string): { ok: Attestation | null; refused: Array<{ agent: string; why: string }> } => {
    const text = noteOn(root, commit);
    if (!text) return { ok: null, refused: [] };
    const { attestations, unreadable } = parseNote(text);
    const refused: Array<{ agent: string; why: string }> = [];
    let ok: Attestation | null = null;
    for (const a of attestations) {
      const why = attestationProblem(a, commit, devices);
      if (why) refused.push({ agent: a.statement.agent, why });
      else if (!ok || a.statement.at > ok.statement.at) ok = a;
    }
    for (let i = 0; i < unreadable; i++) refused.push({ agent: 'unknown', why: 'it could not be read as a signed review' });
    return { ok, refused };
  };
  const now = held(head);
  const short = head.slice(0, 7);
  if (now.ok) {
    const s = now.ok.statement;
    return { state: 'verified', head, review: s, refused: now.refused, words: `✓ ${s.agent}'s review of ${short}, signed on a device the base trusts (${shortKey(s.signer)}): ${s.findings.length} finding${s.findings.length === 1 ? '' : 's'}.` };
  }
  // None that holds on the head: the newest earlier one since the base is stale.
  const earlier = (git(root, ['rev-list', '--first-parent', `${baseCommit}..${head}`]) ?? '').split('\n').map((l) => l.trim()).filter((c) => COMMIT.test(c) && c !== head).slice(0, 200);
  for (const c of earlier) {
    const e = held(c);
    if (e.ok) {
      const s = e.ok.statement;
      return { state: 'stale', head, review: s, refused: now.refused, words: `⚠ The latest review is ${s.agent}'s of ${c.slice(0, 7)}, before the last push: it does not count for ${short}. Review the head again.` };
    }
  }
  if (now.refused.length) return { state: 'refused', head, review: null, refused: now.refused, words: `✗ The review on ${short} is refused: ${now.refused.map((r) => `${r.agent}'s, because ${r.why}`).join('; ')}.` };
  return { state: 'none', head, review: null, refused: [], words: `No review on ${short}: review it on your device (codetrellis review, or your agent through get_review_bundle) and push the notes (codetrellis review publish).` };
}
