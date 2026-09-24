import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CriterionKind, CriterionPolicy, CriterionState, ItemCriterion, TaskAttachment } from '@shared/types';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { describeLocator, openArtefactAt } from '../../../lib/open-artefact-at';
import { BRIEF_WORDS, briefState } from '../../../lib/brief-vocabulary';

/**
 * Phase 31 §4.1–4.3 — what this item is judged on, and where each
 * criterion stands.
 *
 * States are a glyph AND a word (§10.4) — colour is the third carrier,
 * never the first. Approve / Send back are here, on the desktop, because
 * this is one of the two places a person's decision can come from; no
 * agent tool can make one.
 */

const STATE: Record<CriterionState, { glyph: string; label: string; tone: string }> = {
  open: { glyph: '○', label: 'not yet', tone: 'text-foreground-subtle' },
  submitted: { glyph: '◐', label: 'waiting for you', tone: 'text-amber-300' },
  met: { glyph: '✓', label: 'met', tone: 'text-green-400' },
  sent_back: { glyph: '↩', label: 'sent back', tone: 'text-red-300' },
  stale: { glyph: '⚠', label: 'changed since approved', tone: 'text-amber-300' },
};

const KIND_LABEL: Record<CriterionKind, string> = {
  manual: 'judgement',
  artefact: 'output',
  citation: 'citation',
  code: 'code',
  test: 'test',
};

const POLICY_LABEL: Record<CriterionPolicy, string> = {
  agent: 'agent may mark met',
  propose: 'agent proposes, you decide',
  human: 'only you',
};

export function CriteriaBlock({
  itemUid, criteria, attachments = [], vocabulary = 'plan', you = null,
}: {
  itemUid: string;
  criteria: ItemCriterion[];
  /** The item's attachments, so a submission can name the files it cites. */
  attachments?: TaskAttachment[];
  /** Phase 31 §10.3 — in the Brief, the same block in the Brief's words. */
  vocabulary?: 'plan' | 'brief';
  /** Who "you" are — the desktop's identity — so a decision you took reads "met — you, 14:10". */
  you?: string | null;
}) {
  const addCriterion = usePlanItemsStore((s) => s.addCriterion);
  // The unfinished criterion lives in the store, keyed by item, so a
  // remount of this block keeps it (see criterionDrafts).
  const pending = usePlanItemsStore((s) => s.criterionDrafts[itemUid]);
  const setPending = usePlanItemsStore((s) => s.setCriterionDraft);
  const adding = pending !== undefined;
  const draft = pending?.text ?? '';
  const kind: CriterionKind = pending?.kind ?? 'manual';
  const setAdding = (open: boolean) => setPending(itemUid, open ? { text: draft, kind } : null);
  const setDraft = (text: string) => setPending(itemUid, { text, kind });
  const setKind = (k: CriterionKind) => setPending(itemUid, { text: draft, kind: k });
  const [error, setError] = useState<string | null>(null);

  const met = criteria.filter((c) => c.state === 'met').length;

  const submit = async () => {
    if (!draft.trim()) return;
    const err = await addCriterion(itemUid, { text: draft.trim(), kind });
    setError(err);
    if (!err) setPending(itemUid, null);
  };

  if (criteria.length === 0 && !adding) {
    return (
      <section data-testid="criteria-block">
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md border border-dashed border-white/[0.1] text-foreground-subtle hover:text-foreground hover:border-accent/30 hover:bg-accent/5 transition-colors"
        >
          <Plus size={12} /> {vocabulary === 'brief' ? 'Say what good looks like' : 'Add acceptance criterion'}
        </button>
      </section>
    );
  }

  return (
    <section data-testid="criteria-block">
      <h3 className="text-[12px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold mb-3">
        {vocabulary === 'brief' ? BRIEF_WORDS.criteria : 'Acceptance criteria'} <span className="opacity-60">· {met}/{criteria.length} met</span>
      </h3>
      <ul className="space-y-2">
        {criteria.map((c) => <CriterionRow key={c.uid} itemUid={itemUid} criterion={c} attachments={attachments} vocabulary={vocabulary} you={you} />)}
      </ul>

      {adding ? (
        <div className="mt-3 space-y-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="In the requester's words — this is what the work is checked against"
            rows={2}
            className="w-full text-[13px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent/40"
          />
          <div className="flex items-center gap-2 text-[11px]">
            <label className="text-foreground-subtle">Satisfied by</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CriterionKind)}
              className="bg-white/[0.03] border border-white/[0.08] rounded px-1.5 py-0.5"
            >
              {(Object.keys(KIND_LABEL) as CriterionKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
            <div className="flex-1" />
            <button onClick={() => { setPending(itemUid, null); setError(null); }} className="text-foreground-subtle hover:text-foreground">Cancel</button>
            <button
              onClick={submit}
              disabled={!draft.trim()}
              className="px-2.5 py-1 rounded-md bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground"
        >
          <Plus size={11} /> {vocabulary === 'brief' ? 'Add another' : 'Add criterion'}
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
    </section>
  );
}

function CriterionRow({
  itemUid, criterion: c, attachments, vocabulary, you,
}: {
  itemUid: string;
  criterion: ItemCriterion;
  attachments: TaskAttachment[];
  vocabulary: 'plan' | 'brief';
  you: string | null;
}) {
  const decideCriterion = usePlanItemsStore((s) => s.decideCriterion);
  const updateCriterion = usePlanItemsStore((s) => s.updateCriterion);
  const deleteCriterion = usePlanItemsStore((s) => s.deleteCriterion);
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = STATE[c.state];

  const decide = async (decision: 'approved' | 'sent_back') => {
    const err = await decideCriterion(itemUid, c.uid, decision, decision === 'sent_back' ? note : undefined);
    setError(err);
    if (!err) { setSendingBack(false); setNote(''); }
  };

  const decidedBy = c.latestSignoff
    ? c.latestSignoff.actorType === 'human'
      ? c.latestSignoff.actor
      : `${c.latestSignoff.actor} (agent)`
    : null;
  const evidenceNote = c.latestSubmission.find((e) => e.note)?.note ?? null;
  // Each piece of evidence with the place it cites, opened in the viewer
  // there (§7.5) — the claim and where it came from, one click apart.
  const evidence = c.latestSubmission
    .filter((e) => e.attachmentUid)
    .map((e) => ({ e, a: attachments.find((a) => a.uid === e.attachmentUid) ?? null }));
  const evidenceCount = evidence.length;
  const open = (attachmentUid: string, locator: unknown) =>
    openArtefactAt(attachmentUid, locator, { criterionUid: c.uid, itemUid });
  const anchor = c.state === 'sent_back' ? c.latestSignoff?.anchor ?? null : null;
  const anchorFile = anchor ? attachments.find((a) => a.uid === anchor.attachmentUid) : null;

  return (
    <li
      data-testid="criterion-row"
      data-state={c.state}
      className="group rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
    >
      <div className="flex items-start gap-2">
        <span className={`${state.tone} text-[13px] leading-5 w-4 text-center`} aria-hidden>{state.glyph}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] leading-5 whitespace-pre-wrap">{c.text}</p>
          <p className="text-[10px] text-foreground-subtle mt-0.5">
            {vocabulary === 'brief' && c.state === 'met' ? (
              <span className={state.tone}>
                {briefState(c.state, c.latestSignoff ? { actor: c.latestSignoff.actor, actorType: c.latestSignoff.actorType, at: c.latestSignoff.createdAt } : null, you).words}
              </span>
            ) : (
              <>
                <span className={state.tone}>{state.label}</span>
                {decidedBy && c.state !== 'submitted' && <> — {decidedBy}</>}
              </>
            )}
            {' · '}{KIND_LABEL[c.kind]}{' · '}
            {c.kind === 'manual' ? (
              <span title="A judgement — only a person can meet it">{POLICY_LABEL.human}</span>
            ) : (
              <select
                aria-label="Who may mark this met"
                value={c.policy}
                onChange={async (e) => setError(await updateCriterion(itemUid, c.uid, { policy: e.target.value as CriterionPolicy }))}
                className="bg-transparent text-[10px] text-foreground-subtle hover:text-foreground cursor-pointer"
              >
                {(Object.keys(POLICY_LABEL) as CriterionPolicy[]).map((p) => (
                  <option key={p} value={p}>{POLICY_LABEL[p]}</option>
                ))}
              </select>
            )}
          </p>
          {(c.state === 'submitted' || c.state === 'stale') && (evidenceNote || evidenceCount > 0) && (
            <p className="text-[11px] text-foreground-muted mt-1">
              {evidenceNote}
              {evidenceCount > 0 && (
                <span className="text-foreground-subtle">
                  {evidenceNote ? ' · ' : ''}
                  {evidence.map(({ e, a }, i) => (
                    <span key={e.uid}>
                      {i > 0 && ', '}
                      <button
                        onClick={() => open(e.attachmentUid!, e.locator)}
                        data-testid="evidence-link"
                        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                        title="Open it at the place it cites"
                      >
                        {a ? a.label || a.value : 'a file'}{describeLocator(e.locator) ? ` · ${describeLocator(e.locator)}` : ''}
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </p>
          )}
          {c.state === 'stale' && (
            <p className="text-[11px] text-amber-300/90 mt-1">⚠ A file this was approved on has changed since. Look again.</p>
          )}
          {c.state === 'sent_back' && c.latestSignoff?.note && (
            <p className="text-[11px] text-red-300/90 mt-1">
              ↩ {c.latestSignoff.note}
              {anchor && (
                <>
                  {' — '}
                  <button
                    onClick={() => open(anchor.attachmentUid, anchor.locator)}
                    className="underline decoration-dotted underline-offset-2 hover:text-red-200"
                    title="Open the place this was sent back from"
                  >
                    {anchorFile ? anchorFile.label || anchorFile.value : 'the file'}
                    {describeLocator(anchor.locator) ? `, ${describeLocator(anchor.locator)}` : ''}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {c.source !== 'gate' && (
          <button
            onClick={async () => { if (confirm('Remove this criterion? Its decisions stay in the record.')) setError(await deleteCriterion(itemUid, c.uid)); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-foreground-subtle hover:text-red-300"
            title="Remove criterion"
            aria-label="Remove criterion"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>

      {c.state !== 'met' && !sendingBack && (
        <div className="flex gap-2 mt-2 pl-6">
          <button
            onClick={() => decide('approved')}
            className="text-[11px] px-2 py-0.5 rounded border border-green-400/30 text-green-300 hover:bg-green-400/10"
          >
            ✓ Approve
          </button>
          {c.state === 'submitted' && (
            <button
              onClick={() => setSendingBack(true)}
              className="text-[11px] px-2 py-0.5 rounded border border-red-300/30 text-red-300 hover:bg-red-300/10"
            >
              ↩ Send back
            </button>
          )}
        </div>
      )}
      {c.state === 'met' && (
        <div className="flex gap-2 mt-2 pl-6">
          <button
            onClick={() => setSendingBack(true)}
            className="text-[11px] text-foreground-subtle hover:text-red-300"
          >
            ↩ Send back
          </button>
        </div>
      )}
      {sendingBack && (
        <div className="mt-2 pl-6 space-y-1.5">
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What isn't right? The agent reads this next."
            rows={2}
            className="w-full text-[12px] bg-white/[0.03] border border-white/[0.08] rounded-md px-2 py-1 focus:outline-none focus:border-red-300/40"
          />
          <div className="flex gap-2 justify-end text-[11px]">
            <button onClick={() => { setSendingBack(false); setNote(''); }} className="text-foreground-subtle hover:text-foreground">Cancel</button>
            <button
              onClick={() => decide('sent_back')}
              disabled={!note.trim()}
              className="px-2 py-0.5 rounded bg-red-400/15 text-red-300 hover:bg-red-400/25 disabled:opacity-40"
            >
              Send back
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1 pl-6 text-[11px] text-red-300">{error}</p>}
    </li>
  );
}
