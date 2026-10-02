/**
 * Phase 32 C1 — the skills an opened project has, and what an agent is told
 * about a task's skills.
 *
 * The index reads `.claude/skills/<dir>/SKILL.md` in the opened project,
 * taking each skill's name and description from its front-matter. Every
 * read goes through `confined-fs`: a `.claude` or `skills` folder that is a
 * link is not read, a skill folder that is a link is skipped, and a
 * `SKILL.md` that is a link is refused at the open.
 *
 * What an agent is told (`get_brief`, `claim_item`, `get_next_item`) is the
 * task's required and recommended skills, each with where to find it. A
 * `link` is never among them: it is shown to people only. A `repo` skill is
 * checked against the real files, in the project and in the agent's own
 * workstream, and when it is not there the agent is told so and how to get
 * it (a worktree on a branch from before the skill was added, say).
 */

import * as fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { readFileWithin, resolveWithin } from './confined-fs';
import { MAX_SKILL_NAME, normaliseRepoPath } from './skill-model';
import type { AgentSkill, ProjectSkill, Skill } from '../../shared/types';

const SKILLS_DIR = '.claude/skills';
const MAX_SKILL_FILE = 256 * 1024;
const MAX_DESCRIPTION = 300;
const MAX_INDEX = 200;

function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A markdown file's YAML front-matter, or {} when it has none or it is malformed. */
export function frontMatter(text: string): Record<string, unknown> {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/);
  if (!m) return {};
  try {
    const meta = parseYaml(m[1]);
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The skills in the project's `.claude/skills`, by name. */
export function listProjectSkills(projectRoot: string): ProjectSkill[] {
  let base: string;
  try {
    base = resolveWithin(projectRoot, SKILLS_DIR, 'skills folder');
    if (!fs.lstatSync(base).isDirectory()) return [];
  } catch {
    return [];
  }
  const out: ProjectSkill[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  for (const ent of entries) {
    // A link is not a directory here (withFileTypes uses lstat), so it is skipped.
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const rel = `${SKILLS_DIR}/${ent.name}/SKILL.md`;
    let text: string;
    try {
      const buf = readFileWithin(projectRoot, rel, 'skill');
      if (buf.length > MAX_SKILL_FILE) continue;
      text = buf.toString('utf-8');
    } catch {
      continue;
    }
    const meta = frontMatter(text);
    const named = typeof meta.name === 'string' ? oneLine(meta.name) : '';
    const name = named && named.length <= MAX_SKILL_NAME && !named.includes('`') ? named : ent.name;
    const description = typeof meta.description === 'string' ? oneLine(meta.description).slice(0, MAX_DESCRIPTION) : '';
    out.push({ name, description, path: rel });
    if (out.length >= MAX_INDEX) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when `rel` is a regular file inside `root`, reached through no link. */
function presentIn(root: string, rel: string): boolean {
  try {
    readFileWithin(root, rel, 'skill');
    return true;
  } catch {
    return false;
  }
}

/**
 * One of the project's skills and its text (Phase 32 A8.4, `get_skill`), by
 * the name the index gives it, read inside `root` through confined-fs.
 * Null when there is no such skill there.
 */
export function readProjectSkill(root: string, name: string): { skill: ProjectSkill; text: string } | null {
  const skill = listProjectSkills(root).find((s) => s.name === name);
  if (!skill) return null;
  try {
    const buf = readFileWithin(root, skill.path, 'skill');
    return buf.length > MAX_SKILL_FILE ? null : { skill, text: buf.toString('utf-8') };
  } catch {
    return null;
  }
}

export interface SkillContext {
  /** The opened project's root, from the plan's record. */
  projectRoot: string | null;
  /** The folder the agent works in (its bound workstream), when known. */
  workstreamRoot: string | null;
}

/** A task's required and recommended skills, as an agent is told about them. */
export function agentSkills(skills: readonly Skill[], ctx: SkillContext): AgentSkill[] {
  const wanted = skills.filter((s) => s.required || s.use === 'recommended');
  if (wanted.length === 0) return [];
  let index: ProjectSkill[] | null = null;
  const indexed = (name: string) => {
    if (!ctx.projectRoot) return null;
    index ??= listProjectSkills(ctx.projectRoot);
    return index.find((p) => p.name === name) ?? null;
  };

  return wanted.map((s) => {
    let where: AgentSkill['where'] = s.where && s.where.kind !== 'link' ? s.where : null;
    // A skill named with no location: the project's own skill of that name, if there is one.
    if (!where && s.source === 'skill') {
      const found = indexed(s.name);
      if (found) where = { kind: 'repo', path: found.path };
    }
    let missing: string | null = null;
    if (where?.kind === 'repo') {
      // Stored skills are normalised on the way in; normalised again here so
      // nothing reaches an agent on the strength of how it was stored.
      const rel = normaliseRepoPath(where.path);
      where = rel ? { kind: 'repo', path: rel } : null;
    }
    if (where?.kind === 'repo') {
      if (!ctx.projectRoot || !presentIn(ctx.projectRoot, where.path)) {
        missing = `${where.path} is not in the project`;
        where = null;
      } else if (ctx.workstreamRoot && ctx.workstreamRoot !== ctx.projectRoot && !presentIn(ctx.workstreamRoot, where.path)) {
        missing = `${where.path} is not in your workstream (it is in the project's main checkout): bring your branch up to date with the main branch to get it`;
      }
    }
    return { name: s.name, use: s.required ? 'required' : 'recommended', why: s.why ?? null, where, missing };
  });
}

/** The one-line note, shared with the frontend's hand-off prompt. */
export { skillsNote } from '../../shared/lib/skills-note';
