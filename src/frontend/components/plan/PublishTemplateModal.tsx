import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Layers } from 'lucide-react';
import { useToastStore } from '../../stores/toast-store';

/**
 * Snapshot the active plan as a reusable template under
 * `<projectRoot>/.codetrellis/templates/<id>/`. Phase 13 §C.
 *
 * UX: keep it minimal. Ask only for the things the publish service
 * can't infer — `templateId` (slug) is the one mandatory bit. Label,
 * description, default title default to the plan's own values; the
 * user can override and then later open the generated `template.yaml`
 * by hand to add `placeholders` if they want parameterisation.
 */
export function PublishTemplateModal({
  planUid,
  planTitle,
  projectRoot,
  onClose,
  onPublished,
}: {
  planUid: string;
  planTitle: string;
  projectRoot: string;
  onClose: () => void;
  onPublished: (templateId: string, templateDir: string) => void;
}) {
  const [templateId, setTemplateId] = useState(suggestSlug(planTitle));
  const [label, setLabel] = useState(planTitle);
  const [shortDescription, setShortDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const addToast = useToastStore((s) => s.addToast);

  const handleSubmit = async () => {
    if (!templateId.trim() || !/^[a-z0-9][a-z0-9-]*$/.test(templateId.trim())) {
      setError('Template id must be lowercase alphanumeric + hyphens (e.g. "company-mass-refactor").');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/plans/${planUid}/publish-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectRoot,
          templateId: templateId.trim(),
          label: label.trim() || undefined,
          shortDescription: shortDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Publish failed');
      addToast({
        type: 'success',
        title: 'Template published',
        message: `${data.files.length} files written. Available in "From template" next time.`,
        duration: 6000,
      });
      onPublished(templateId.trim(), data.templateDir);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Layers size={13} className="text-accent" />
            Publish plan as template
          </h3>
          <button onClick={onClose} className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[11px] text-foreground-muted leading-relaxed">
            Snapshots this plan as a reusable template under
            <code className="font-mono mx-1 bg-white/[0.05] px-1 rounded">.codetrellis/templates/&lt;id&gt;/</code>.
            Statuses, assignees, and git checkpoints are stripped. Commit it to git to share with your team.
          </p>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
              Template ID (slug)
            </label>
            <input
              type="text"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="company-mass-refactor"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
            />
            <p className="text-[9.5px] text-foreground-subtle mt-1">
              Lowercase, alphanumeric + hyphens. Used as the directory name.
            </p>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={planTitle}
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">
              Short description (optional)
            </label>
            <input
              type="text"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="One-line summary shown in the picker"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
            />
          </div>

          <p className="text-[10px] text-foreground-subtle leading-relaxed pt-2">
            Want placeholders like <code className="font-mono">{'{{service-name}}'}</code>? Open the generated
            <code className="font-mono mx-1">template.yaml</code> after publishing and add a <code className="font-mono">placeholders:</code> section.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          {error && <span className="text-[10.5px] text-red-300 mr-auto">{error}</span>}
          <button onClick={onClose} className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04]">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !templateId.trim()}
            className="px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function suggestSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
