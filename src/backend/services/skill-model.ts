/**
 * Phase 32 C1 — a skill on a plan item, checked on the way in.
 *
 * Skills arrive from the routing panel, from plan files pulled through git,
 * and from templates, and what they say is later put in front of an agent
 * that follows a skill with full trust. So every write normalises them here:
 * a name and a reason are one short line, a location is one of the five
 * kinds and nothing else, a `repo` path stays a relative path inside the
 * project (no `..`, no absolute path; confinement is checked again against
 * the real files before an agent is told), and a `link` is an http(s) URL,
 * which people see and agents never do.
 *
 * Pure: no database, no filesystem. `normaliseSkills` is lenient (a bad
 * field is dropped, the rest kept), because an old or hand-edited plan file
 * must still load; the REST route refuses what it reports instead.
 */

import type { Skill, SkillLocation } from '../../shared/types';

export const SKILL_SOURCES = ['mcp', 'skill', 'lang', 'plugin'] as const;
export const MAX_SKILLS = 30;
export const MAX_SKILL_NAME = 80;
export const MAX_SKILL_WHY = 200;
const MAX_REPO_PATH = 300;
const MAX_URL = 500;

/** One line, no control characters and no backticks (they would break the brief's markdown). */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const NAME_RE = /^[^\u0000-\u001f\u007f`]+$/;
const IDENT_RE = /^[A-Za-z0-9][A-Za-z0-9._@/:+-]{0,99}$/;
const UID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** Collapse whitespace to single spaces and strip control characters. */
function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A `repo` location's path, as a relative POSIX path to a markdown file
 * inside the project, or null. A folder means its `SKILL.md`.
 */
export function normaliseRepoPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let p = raw.trim();
  if (!p || p.length > MAX_REPO_PATH || p.includes('\0') || p.includes('\\')) return null;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~')) return null;
  p = p.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  const parts = p.split('/');
  if (parts.some((x) => x === '..' || x === '.' || x === '')) return null;
  if (!/\.md$/i.test(p)) p = `${p}/SKILL.md`;
  return p;
}

export function normaliseLocation(raw: unknown): { where: SkillLocation | null; problem: string | null } {
  if (raw === undefined || raw === null) return { where: null, problem: null };
  const r = raw as Record<string, unknown>;
  switch (r?.kind) {
    case 'repo': {
      const path = normaliseRepoPath(r.path);
      return path ? { where: { kind: 'repo', path }, problem: null } : { where: null, problem: 'a repo location must be a relative path inside the project' };
    }
    case 'plugin':
      return typeof r.name === 'string' && IDENT_RE.test(r.name)
        ? { where: { kind: 'plugin', name: r.name }, problem: null }
        : { where: null, problem: 'a plugin location needs a plugin name' };
    case 'mcp':
      return typeof r.server === 'string' && IDENT_RE.test(r.server)
        ? { where: { kind: 'mcp', server: r.server }, problem: null }
        : { where: null, problem: 'an mcp location needs a server name' };
    case 'playbook':
      return typeof r.uid === 'string' && UID_RE.test(r.uid)
        ? { where: { kind: 'playbook', uid: r.uid }, problem: null }
        : { where: null, problem: 'a playbook location needs a playbook id' };
    case 'link': {
      if (typeof r.url !== 'string' || r.url.length > MAX_URL) return { where: null, problem: 'a link needs an http(s) URL' };
      try {
        const u = new URL(r.url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
        return { where: { kind: 'link', url: u.toString() }, problem: null };
      } catch {
        return { where: null, problem: 'a link needs an http(s) URL' };
      }
    }
    default:
      return { where: null, problem: 'a location is one of repo, plugin, mcp, playbook or link' };
  }
}

/** One skill, normalised; null when it has no usable name or source. */
export function normaliseSkill(raw: unknown): { skill: Skill | null; problems: string[] } {
  const problems: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' ? oneLine(r.name) : '';
  if (!name || name.length > MAX_SKILL_NAME || !NAME_RE.test(name)) {
    return { skill: null, problems: [`a skill needs a name of at most ${MAX_SKILL_NAME} characters, on one line, without backticks`] };
  }
  // An absent source is a skill (the common case, and what an editor that
  // sends only a name means); a source that is present must be a known one.
  if (r.source !== undefined && r.source !== null && !SKILL_SOURCES.includes(r.source as typeof SKILL_SOURCES[number])) {
    return { skill: null, problems: [`skill "${name}": source must be one of ${SKILL_SOURCES.join(', ')}`] };
  }
  const source = (r.source ?? 'skill') as Skill['source'];
  const skill: Skill = { name, source, required: r.required === true };
  if (r.use !== undefined && r.use !== null) {
    if (r.use === 'recommended') skill.use = 'recommended';
    else problems.push(`skill "${name}": use can only be "recommended"`);
  }
  if (r.why !== undefined && r.why !== null) {
    const why = typeof r.why === 'string' ? oneLine(r.why) : '';
    if (typeof r.why !== 'string') problems.push(`skill "${name}": why must be text`);
    else if (why.length > MAX_SKILL_WHY) problems.push(`skill "${name}": why is at most ${MAX_SKILL_WHY} characters`);
    if (why) skill.why = why.slice(0, MAX_SKILL_WHY);
  }
  const { where, problem } = normaliseLocation(r.where);
  if (problem) problems.push(`skill "${name}": ${problem}`);
  if (where) skill.where = where;
  return { skill, problems };
}

/**
 * A skills list, normalised: unusable entries dropped, bad fields dropped,
 * one entry per name (the first), at most MAX_SKILLS. `problems` says what
 * was dropped, for a caller that would rather refuse.
 */
export function normaliseSkills(raw: unknown): { skills: Skill[]; problems: string[] } {
  if (raw === undefined || raw === null) return { skills: [], problems: [] };
  if (!Array.isArray(raw)) return { skills: [], problems: ['skills must be a list'] };
  const problems: string[] = [];
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const { skill, problems: p } = normaliseSkill(entry);
    problems.push(...p);
    if (!skill) continue;
    if (seen.has(skill.name)) { problems.push(`skill "${skill.name}" is listed twice`); continue; }
    if (out.length >= MAX_SKILLS) { problems.push(`at most ${MAX_SKILLS} skills`); break; }
    seen.add(skill.name);
    out.push(skill);
  }
  return { skills: out, problems };
}

/** True when an item's skill is to be left out of what an agent reads (C1.4: waiting for a person). */
export type HideSkill = (itemUid: string, skill: string) => boolean;

/**
 * A value with every skill's `link` location removed, wherever a `skills`
 * list appears in it (an item, a list of items, a claim result). Agents are
 * never pointed at a link: people see it, and an agent reading an item gets
 * the skill without it. Returns the value itself when there was nothing to
 * remove.
 */
export function withoutLinks<T>(value: T, depth = 0, hide?: HideSkill): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const w = withoutLinks(v, depth + 1, hide);
      if (w !== v) changed = true;
      return w;
    });
    return (changed ? out : value) as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  let copy: Record<string, unknown> | null = null;
  const rawUid = (value as Record<string, unknown>).uid;
  const ownerUid = typeof rawUid === 'string' ? rawUid : null;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    let w: unknown = v;
    if (k === 'skills' && Array.isArray(v)) {
      // C1.4: a skill waiting for a person is not in what an agent reads at all.
      const shown = hide && ownerUid ? v.filter((s) => !hide(ownerUid, (s as Skill)?.name)) : v;
      w = shown.some((s) => (s as Skill)?.where?.kind === 'link')
        ? shown.map((s) => {
          if ((s as Skill)?.where?.kind !== 'link') return s;
          const { where: _link, ...rest } = s as Skill;
          return rest;
        })
        : shown.length === v.length ? v : shown;
    } else {
      w = withoutLinks(v, depth + 1, hide);
    }
    if (w !== v) {
      copy ??= { ...(value as Record<string, unknown>) };
      copy[k] = w;
    }
  }
  return (copy ?? value) as T;
}

/**
 * A service module as MCP tools see it: every function's result passed
 * through `withoutLinks`. Classes (error types used with instanceof) and
 * other exports are passed through unchanged.
 */
export function agentView<M extends object>(mod: M, hide?: HideSkill): M {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === 'function' && !/^class[\s{]/.test(Function.prototype.toString.call(v))) {
      out[k] = (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown)(...args);
        return r instanceof Promise ? r.then((x) => withoutLinks(x, 0, hide)) : withoutLinks(r, 0, hide);
      };
    } else {
      out[k] = v;
    }
  }
  return out as M;
}
