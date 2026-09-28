/**
 * Phase 32 C1.2 — the skills on a task, and the picker that adds them.
 *
 * Each skill says how it is used (recommended, required — which gates the
 * claim — or only listed), why, and where it lives. The project's own
 * skills (`.claude/skills`) are searchable by name and description; picking
 * one adds it as recommended and points at its SKILL.md. A skill inherited
 * from a parent says so and is changed there. A link is marked "people
 * only": agents are never shown one.
 *
 * Saving goes through the item route, which checks every skill; when it
 * refuses one, the reason is shown here rather than the edit vanishing.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plug, RotateCcw, Pencil, X, Link2, CheckCircle2, Circle } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useProjectStore } from '../../../stores/project-store';
import type { PlanItem, ProjectSkill, Skill, SkillProof } from '@shared/types';
import {
  USE_LABEL, WHERE_LABEL, skillUse, withUse, withWhy, withWhere, whereText, whereValue,
  matchProjectSkills, fromProjectSkill, fromName, type SkillUse, type WhereKind,
} from '../../../lib/skill-picker';

const inputClass =
  'text-[11.5px] px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-foreground-subtle/40 focus:border-accent/30 focus:outline-none';

export function SkillsEditor({
  item,
  resolved,
}: {
  item: PlanItem;
  /** The skills in effect, own and inherited. */
  resolved: Skill[];
}) {
  const updateItemOrError = usePlanItemsStore((s) => s.updateItemOrError);
  const root = useProjectStore((s) => s.root);
  const [index, setIndex] = useState<ProjectSkill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!root) { setIndex([]); return; }
    let live = true;
    fetch(`/api/skills?project=${encodeURIComponent(root)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { skills?: ProjectSkill[] }).skills ?? [] : []))
      .catch(() => [] as ProjectSkill[])
      .then((skills) => { if (live) setIndex(skills); });
    return () => { live = false; };
  }, [root]);

  // What is in effect comes from the server: the plan's tree holds summaries
  // without skills, so an ancestor's skills cannot be resolved here.
  const [effective, setEffective] = useState<Array<{ skill: Skill; fromUid: string; fromTitle: string; proof?: SkillProof | null }> | null>(null);
  const ownKey = JSON.stringify([item.skills ?? [], item.skillsMode, item.parentUid]);
  useEffect(() => {
    let live = true;
    fetch(`/api/items/${item.uid}/skills`)
      .then(async (r) => (r.ok ? ((await r.json()) as { skills?: typeof effective }).skills ?? null : null))
      .catch(() => null)
      .then((rows) => { if (live) setEffective(rows); });
    return () => { live = false; };
  }, [item.uid, ownKey]);
  const rows = effective ?? resolved.map((skill) => ({ skill, fromUid: item.uid, fromTitle: item.title }));
  const inherited = rows.filter((r) => r.fromUid !== item.uid);
  const shown = rows.map((r) => r.skill);

  const own = useMemo(() => item.skills ?? [], [item.skills]);
  const isOwn = (name: string) => own.some((s) => s.name === name);
  const fromOf = (name: string) => rows.find((r) => r.skill.name === name)?.fromTitle ?? null;
  const proofOf = (name: string) => effective?.find((r) => r.skill.name === name)?.proof ?? null;
  const matches = useMemo(() => matchProjectSkills(index, query, shown.map((s) => s.name)), [index, query, shown]);

  const save = async (skills: Skill[]) => {
    // The mode is left as it is: own skills add to inherited ones ("inherit"
    // merges). Switching to "replace" on the first own skill, as this panel
    // used to, silently dropped every inherited one.
    const r = await updateItemOrError(item.uid, { skills });
    setError('error' in r ? r.error : null);
    return !('error' in r);
  };
  const change = (name: string, next: (s: Skill) => Skill) => save(own.map((s) => (s.name === name ? next(s) : s)));
  const add = async (skill: Skill) => {
    if (!skill.name || shown.some((s) => s.name === skill.name)) return;
    if (await save([...own, skill])) { setQuery(''); setOpen(false); }
  };

  return (
    <div data-testid="skills-editor">
      <div className="flex items-center gap-2 mb-1.5">
        <Plug size={11} className="text-zinc-500" />
        <span className="text-[11px] font-medium text-foreground-muted">Skills</span>
        {/* Each inherited skill says where it comes from on its own row; the
            heading only says so when every skill is inherited. */}
        {rows.length > 0 && inherited.length === rows.length && (
          <span className="text-[10px] text-foreground-subtle italic">
            (inherited from {[...new Set(inherited.map((r) => r.fromTitle))].join(', ')})
          </span>
        )}
        {own.length > 0 && (
          <button
            onClick={async () => { const r = await updateItemOrError(item.uid, { skills: [], skillsMode: 'inherit' }); setError('error' in r ? r.error : null); }}
            className="text-[10px] text-accent hover:text-accent-hover ml-auto"
            title="Reset to inherit"
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>

      <ul className="space-y-1.5 mb-2">
        {shown.map((s) => {
          const where = whereText(s.where);
          const mine = isOwn(s.name);
          const use = skillUse(s);
          return (
            <li key={s.name} data-testid="skill-row" data-skill={s.name} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11.5px]">
                {use === 'listed'
                  ? <Circle size={11} className="text-foreground-subtle shrink-0" aria-hidden />
                  : <CheckCircle2 size={11} className={`${use === 'required' ? 'text-warning' : 'text-purple-300'} shrink-0`} aria-hidden />}
                <span className="font-medium text-foreground whitespace-nowrap">{s.name}</span>
                {mine ? (
                  <select
                    data-testid="skill-use"
                    aria-label={`How ${s.name} is used`}
                    value={use}
                    onChange={(e) => change(s.name, (x) => withUse(x, e.target.value as SkillUse))}
                    className="text-[10.5px] px-1 py-0.5 rounded border border-white/[0.08] bg-transparent text-foreground-muted"
                  >
                    {(Object.keys(USE_LABEL) as SkillUse[]).map((u) => <option key={u} value={u}>{USE_LABEL[u]}</option>)}
                  </select>
                ) : (
                  <span className="text-[10.5px] text-foreground-subtle">{USE_LABEL[use]}</span>
                )}
                {where && (
                  <span className={`inline-flex items-center gap-1 min-w-0 text-[10.5px] font-mono ${where.peopleOnly ? 'text-foreground-subtle' : 'text-foreground-muted'}`} title={where.text}>
                    {where.peopleOnly && <Link2 size={10} aria-hidden className="shrink-0" />}
                    <span className="truncate">{where.text}</span>
                  </span>
                )}
                {/* Outside the location, so a long URL never truncates it away. */}
                {where?.peopleOnly && <span className="text-[10.5px] italic text-foreground-subtle whitespace-nowrap" data-testid="skill-people-only">people only</span>}
                <ProofBadge proof={proofOf(s.name)} use={use} />
                {!mine && <span className="text-[10px] text-foreground-subtle italic ml-auto" data-testid="skill-inherited">inherited from {fromOf(s.name)}</span>}
                {mine && (
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => setEditing(editing === s.name ? null : s.name)} className="opacity-60 hover:opacity-100" title={`Edit why and where for ${s.name}`} data-testid="skill-edit">
                      <Pencil size={10} />
                    </button>
                    <button onClick={() => save(own.filter((x) => x.name !== s.name))} className="opacity-60 hover:opacity-100" title={`Remove ${s.name}`} data-testid="skill-remove">
                      <X size={11} />
                    </button>
                  </span>
                )}
              </div>
              {s.why && editing !== s.name && (
                <div className="text-[10.5px] text-foreground-subtle mt-0.5 ml-4" data-testid="skill-why-text">why: {s.why}</div>
              )}
              {mine && editing === s.name && (
                <SkillDetails skill={s} onSave={(next) => change(s.name, () => next).then((ok) => { if (ok) setEditing(null); })} />
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="text-[11px] text-foreground-subtle">No skills yet</li>}
      </ul>

      {error && <div role="alert" data-testid="skill-error" className="text-[11px] text-danger mb-1.5">{error}</div>}

      <div className="relative">
        <input
          type="text"
          data-testid="skill-add-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              const exact = matches.find((m) => m.name === query.trim());
              void add(exact ? fromProjectSkill(exact) : fromName(query));
            }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={index.length ? `Add a skill: search ${index.length} in this project, or type a name` : 'Add a skill by name'}
          className={`w-full ${inputClass}`}
          aria-label="Add a skill"
        />
        {open && matches.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full rounded-md border border-white/[0.08] bg-surface-solid shadow-lg py-1" role="listbox" data-testid="skill-options">
            {matches.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  data-testid="skill-option"
                  onMouseDown={(e) => { e.preventDefault(); void add(fromProjectSkill(p)); }}
                  className="w-full text-left px-2 py-1 hover:bg-white/[0.05] flex items-baseline gap-2"
                >
                  <span className="text-[11.5px] text-foreground shrink-0">{p.name}</span>
                  <span className="text-[10.5px] text-foreground-subtle truncate">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Why and where for one skill, saved together. */
function SkillDetails({ skill, onSave }: { skill: Skill; onSave: (s: Skill) => void }) {
  const [why, setWhy] = useState(skill.why ?? '');
  const [kind, setKind] = useState<WhereKind>(skill.where?.kind ?? 'none');
  const [value, setValue] = useState(whereValue(skill.where));
  return (
    <div className="mt-1.5 ml-4 space-y-1.5" data-testid="skill-details">
      <input
        data-testid="skill-why"
        aria-label={`Why ${skill.name}`}
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder="Why, in one line (shown to the agent)"
        maxLength={200}
        className={`w-full ${inputClass}`}
      />
      <div className="flex gap-1.5">
        <select
          data-testid="skill-where-kind"
          aria-label={`Where ${skill.name} lives`}
          value={kind}
          onChange={(e) => setKind(e.target.value as WhereKind)}
          className={inputClass}
        >
          {(Object.keys(WHERE_LABEL) as WhereKind[]).map((k) => <option key={k} value={k}>{WHERE_LABEL[k]}</option>)}
        </select>
        {kind !== 'none' && (
          <input
            data-testid="skill-where-value"
            aria-label={`${WHERE_LABEL[kind]} for ${skill.name}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === 'repo' ? '.claude/skills/<name>' : kind === 'link' ? 'https://…' : kind === 'playbook' ? 'playbook id' : 'name'}
            className={`flex-1 font-mono ${inputClass}`}
          />
        )}
        <button
          data-testid="skill-save"
          onClick={() => onSave(withWhere(withWhy(skill, why), kind, value))}
          className="px-2 py-1 text-[11px] rounded-md border border-white/[0.08] bg-white/[0.03] text-foreground-muted hover:text-foreground hover:bg-white/[0.06]"
        >
          Save
        </button>
      </div>
      {kind === 'link' && (
        <p className="text-[10.5px] text-foreground-subtle">A link is for people: agents are never shown it, only the skill&apos;s name and why.</p>
      )}
    </div>
  );
}

/**
 * Whether the skill was used (C1.3), once an agent has worked the task.
 * "Unknown" for agents that record no such thing, never "not used" on a guess.
 */
function ProofBadge({ proof, use }: { proof: SkillProof | null; use: SkillUse }) {
  if (!proof) return null;
  const text = proof === 'used' ? '✓ used' : proof === 'not_used' ? `○ ${use === 'required' ? 'required' : 'recommended'}, not used` : 'use unknown';
  const tone = proof === 'used' ? 'text-success' : proof === 'not_used' ? 'text-warning' : 'text-foreground-subtle';
  const title = proof === 'used'
    ? 'The agent working this task loaded this skill'
    : proof === 'not_used'
      ? 'A Claude Code agent is working this task and has not loaded this skill'
      : 'This agent does not report which skills it loads';
  return <span className={`text-[10.5px] whitespace-nowrap ${tone}`} title={title} data-testid="skill-proof" data-proof={proof}>{text}</span>;
}
