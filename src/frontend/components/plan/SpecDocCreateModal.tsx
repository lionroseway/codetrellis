import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { SPEC_DOC_TYPES, getSpecDocTypeMeta } from '../../lib/spec-doc-types';

function suggestNextOrderHint(existingHints: Array<string | null>): string {
  // Pick the next two-digit prefix after the highest existing one. Falls
  // back to "00" when the plan has no ordered docs yet, so the first
  // ordered doc lines up with the swf "00-EXECUTIVE" convention.
  const numeric = existingHints
    .filter((h): h is string => !!h)
    .map((h) => parseInt(h, 10))
    .filter((n) => Number.isFinite(n));
  if (numeric.length === 0) return '00';
  const max = Math.max(...numeric);
  return String(max + 1).padStart(2, '0');
}

const STARTER_BODIES: Record<string, string> = {
  executive_summary: '# Goal\n\n## Why this matters\n\n## Out of scope\n',
  architecture: '# Components\n\n# Data flow\n\n# Boundaries\n',
  patterns: '# Patterns to follow\n\n- \n\n# Anti-patterns to avoid\n\n- \n',
  examples: '# Example\n\n```\n\n```\n',
  research: '# Background\n\n# References\n\n- \n',
  testing: '# Test strategy\n\n# Coverage targets\n\n# Fixtures / mocks\n',
  security: '# Threat model\n\n# Sensitive paths\n\n# Do-not-touch\n',
  ux_ui: '# Design intent\n\n# Components\n\n# Interaction notes\n',
  constraints: '# Performance\n\n# Compatibility\n\n# Deadlines\n',
  acceptance_criteria: '- [ ] \n- [ ] \n- [ ] \n',
  rollout: '# Phases\n\n# Feature flags\n\n# Rollback plan\n',
  custom: '',
};

export function SpecDocCreateModal({
  planUid,
  defaultType,
  onClose,
}: {
  planUid: string;
  defaultType?: string;
  onClose: () => void;
}) {
  const createPlanDoc = usePlanStore((s) => s.createPlanDoc);
  const setSelectedDoc = usePlanStore((s) => s.setSelectedDoc);
  const existingDocs = usePlanStore((s) => s.planDocs);

  const initialType = defaultType ?? 'executive_summary';
  const initialMeta = getSpecDocTypeMeta(initialType);
  const [docType, setDocType] = useState(initialType);
  const [title, setTitle] = useState(initialMeta.label);
  const [body, setBody] = useState(STARTER_BODIES[initialType] ?? '');
  const [orderHint, setOrderHint] = useState(suggestNextOrderHint(existingDocs.map((d) => d.orderHint)));
  const [parentDocUid, setParentDocUid] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const meta = getSpecDocTypeMeta(docType);
  const parentCandidates = existingDocs.filter((d) => !d.parentDocUid);

  const handleTypeChange = (next: string) => {
    setDocType(next);
    const nextMeta = getSpecDocTypeMeta(next);
    // If user hasn't customized title, follow the type label
    if (title === getSpecDocTypeMeta(docType).label) {
      setTitle(nextMeta.label);
    }
    if (!body || body === STARTER_BODIES[docType]) {
      setBody(STARTER_BODIES[next] ?? '');
    }
  };

  const onCreate = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const doc = await createPlanDoc(planUid, {
      docType,
      title: title.trim(),
      body,
      orderHint: orderHint.trim() || null,
      parentDocUid: parentDocUid || null,
    });
    setSaving(false);
    if (doc) {
      setSelectedDoc(doc.uid);
      onClose();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <Sparkles size={13} className="text-accent" />
            New spec doc
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-2">Type</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SPEC_DOC_TYPES.map((t) => {
                const isSelected = docType === t.type;
                return (
                  <button
                    key={t.type}
                    onClick={() => handleTypeChange(t.type)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-left transition-all ${
                      isSelected ? `${t.chipClass} ring-1 ring-accent/40` : 'border-white/[0.06] bg-white/[0.015] text-foreground-muted hover:bg-white/[0.04]'
                    }`}
                    title={t.description}
                  >
                    <t.icon size={10} className={isSelected ? '' : 'opacity-60'} />
                    <span className="text-[10px] font-medium truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-foreground-subtle mt-2">{meta.description}</p>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-2 text-[12.5px] text-foreground focus:outline-none focus:border-accent/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
                Order
                <span className="ml-1 normal-case tracking-normal text-foreground-subtle/70">(optional)</span>
              </label>
              <input
                type="text"
                value={orderHint}
                onChange={(e) => setOrderHint(e.target.value)}
                placeholder='e.g. "00", "01", "01.5"'
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
              />
              <p className="text-[9.5px] text-foreground-subtle mt-1">Lex sort. Use "00" for the overview.</p>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
                Nest under
                <span className="ml-1 normal-case tracking-normal text-foreground-subtle/70">(optional)</span>
              </label>
              <select
                value={parentDocUid}
                onChange={(e) => setParentDocUid(e.target.value)}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
              >
                <option value="">(top level)</option>
                {parentCandidates.map((d) => (
                  <option key={d.uid} value={d.uid}>
                    {d.orderHint ? `${d.orderHint} · ` : ''}{d.title}
                  </option>
                ))}
              </select>
              <p className="text-[9.5px] text-foreground-subtle mt-1">Group sub-docs under a parent.</p>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Body (markdown)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Markdown supported — headings, lists, code, links..."
              className="w-full min-h-[220px] bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-none leading-relaxed"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            onClick={onCreate}
            disabled={saving || !title.trim()}
            className="px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Creating...' : 'Create doc'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
