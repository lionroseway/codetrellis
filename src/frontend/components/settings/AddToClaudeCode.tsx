/**
 * Phase 32 A3.4 — the `codetrellis-parallel` skill and the optional
 * PreToolUse hook, offered to Claude Code. Desktop app only.
 *
 * Add to Claude Desktop's flow (AddToClaudeDesktop.tsx), for two files: the
 * person sees where each goes and the whole change as a diff, ticks what they
 * want (the skill is ticked, the hook is not: it runs before every edit, so
 * it is theirs to opt into), and only those are written, each only if it is
 * still the file they saw. The content is decided in the main process.
 */
import { useState } from 'react';

type Api = NonNullable<NonNullable<Window['electronAPI']>['claudeCode']>;
type Preview = Awaited<ReturnType<Api['preview']>>;
type Shown = Extract<Preview, { ok: true }>;
type Item = Shown['skill'];

const isItem = (x: Shown['hook']): x is Item => 'beforeHash' in x;

function Diff({ item, testId }: { item: Item; testId: string }) {
  return (
    <pre className="mt-1.5 max-h-40 overflow-auto bg-black/30 border border-white/[0.06] rounded px-2 py-1.5 text-[10.5px] font-mono leading-[1.45]" data-testid={testId}>
      {item.diff.map((l, i) => (
        <div key={i} className={l.op === '+' ? 'text-emerald-300 bg-emerald-400/[0.06]' : l.op === '-' ? 'text-red-300 bg-red-400/[0.06]' : 'text-foreground-subtle'}>
          {l.op} {l.text}
        </div>
      ))}
    </pre>
  );
}

function where(item: Item) {
  return (
    <>
      {item.status === 'update' ? 'Updates' : item.exists ? 'Changes' : 'Creates'}{' '}
      <code className="font-mono break-all">{item.path}</code>
      {item.exists ? ' (a copy of the current file is kept beside it)' : ''}.
    </>
  );
}

export function AddToClaudeCode() {
  const api: Api | undefined = window.electronAPI?.claudeCode;
  const [shown, setShown] = useState<Shown | null>(null);
  const [want, setWant] = useState<{ skill: boolean; hook: boolean }>({ skill: true, hook: false });
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api) return null;

  const preview = async (note?: string) => {
    setBusy(true);
    try {
      const p = await api.preview();
      if (!p.ok) { setShown(null); setMessage({ tone: 'warn', text: p.reason }); return; }
      setShown(p);
      setWant({ skill: p.skill.status !== 'unchanged', hook: false });
      setMessage(note ? { tone: 'warn', text: note } : null);
    } finally {
      setBusy(false);
    }
  };

  const hook = shown && isItem(shown.hook) ? shown.hook : null;
  const skillPending = !!shown && shown.skill.status !== 'unchanged';
  const hookPending = !!hook && hook.status !== 'unchanged';
  const chosen = (skillPending && want.skill) || (hookPending && want.hook);

  const apply = async () => {
    if (!shown || !chosen) return;
    setBusy(true);
    try {
      const r = await api.apply({
        ...(skillPending && want.skill ? { skill: shown.skill.beforeHash } : {}),
        ...(hookPending && want.hook && hook ? { hook: hook.beforeHash } : {}),
      });
      if (!r.ok) {
        if (r.changed) { await preview(r.reason); return; }
        setShown(null);
        setMessage({ tone: 'warn', text: r.reason });
        return;
      }
      const done = [r.skill && 'the skill', r.hook && 'the hook'].filter(Boolean).join(' and ');
      const backups = [r.skill?.backupPath, r.hook?.backupPath].filter(Boolean);
      setShown(null);
      setMessage({
        tone: 'ok',
        text: `Added ${done}. Claude Code picks them up in its next session.${backups.length ? ` The previous files are kept as ${backups.join(', ')}.` : ''}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3" data-testid="add-to-claude-code">
      {!shown && (
        <button
          onClick={() => void preview()}
          disabled={busy}
          className="px-2.5 py-1 rounded-md text-[11px] border border-accent/30 text-accent hover:bg-accent/10 disabled:opacity-50"
          title="A Claude Code skill for working alongside other agents, and an optional check before every edit"
        >
          Add parallel work to Claude Code…
        </button>
      )}
      {shown && (
        <div className="rounded-md border border-white/[0.08] bg-black/20 p-3 space-y-3">
          <p className="text-[10.5px] text-foreground-muted leading-relaxed">
            For agents working in other worktrees at the same time. Choose what to add to Claude Code; nothing else in
            its settings changes.
          </p>

          <div data-testid="claude-code-skill">
            <label className="flex items-start gap-2 text-[11px] text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={skillPending && want.skill}
                disabled={!skillPending || busy}
                onChange={(e) => setWant((w) => ({ ...w, skill: e.target.checked }))}
              />
              <span>
                <strong>The <code className="font-mono">codetrellis-parallel</code> skill</strong>
                <span className="block text-[10.5px] text-foreground-muted leading-relaxed">
                  {skillPending
                    ? <>How to work alongside other agents: check for overlaps first, say what you will change, ask you when a choice is needed. {where(shown.skill)}</>
                    : 'Already added, and up to date.'}
                </span>
              </span>
            </label>
            {skillPending && <Diff item={shown.skill} testId="claude-code-skill-diff" />}
          </div>

          <div data-testid="claude-code-hook">
            {hook ? (
              <>
                <label className="flex items-start gap-2 text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={hookPending && want.hook}
                    disabled={!hookPending || busy}
                    onChange={(e) => setWant((w) => ({ ...w, hook: e.target.checked }))}
                  />
                  <span>
                    <strong>Check before every edit</strong> <span className="text-foreground-subtle">(optional)</span>
                    <span className="block text-[10.5px] text-foreground-muted leading-relaxed">
                      {hookPending
                        ? <>Before Claude Code edits a file, it asks CodeTrellis whether another workstream has changed it, and tells the agent if so. It never blocks or approves an edit, and does nothing when CodeTrellis is not running. {where(hook)}</>
                        : 'Already added, and up to date.'}
                    </span>
                  </span>
                </label>
                {hookPending && hook.caveat && (
                  <p className="mt-1.5 text-[10.5px] text-amber-200/90 leading-relaxed" data-testid="claude-code-hook-caveat">{hook.caveat}</p>
                )}
                {hookPending && <Diff item={hook} testId="claude-code-hook-diff" />}
              </>
            ) : (
              <p className="text-[10.5px] text-amber-200/90 leading-relaxed">
                <strong>Check before every edit</strong> is not available: {(shown.hook as { unavailable: string }).unavailable}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => void apply()} disabled={busy || !chosen} className="px-2.5 py-1 rounded-md text-[11px] bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50">
              Add to Claude Code
            </button>
            <button onClick={() => { setShown(null); setMessage(null); }} disabled={busy} className="px-2.5 py-1 rounded-md text-[11px] text-foreground-subtle hover:text-foreground">
              {skillPending || hookPending ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={`mt-2 text-[10.5px] leading-relaxed ${message.tone === 'ok' ? 'text-emerald-300/90' : 'text-amber-200/90'}`}>{message.text}</p>
      )}
    </div>
  );
}
