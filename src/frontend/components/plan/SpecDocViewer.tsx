import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Edit3, Save, Trash2, Eye, Clock, History } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { getSpecDocTypeMeta, SPEC_DOC_TYPES } from '../../lib/spec-doc-types';
import { Markdown } from '../../lib/markdown';
import type { PlanDocument, PlanDocumentVersion } from '../../../shared/types';

/**
 * Full-screen modal for viewing or editing a single spec doc.
 * Doubles as a markdown read view and a textarea-based edit view.
 */
export function SpecDocViewer({ docUid, onClose }: { docUid: string; onClose: () => void }) {
  const docs = usePlanStore((s) => s.planDocs);
  const updatePlanDoc = usePlanStore((s) => s.updatePlanDoc);
  const deletePlanDoc = usePlanStore((s) => s.deletePlanDoc);
  const doc = docs.find((d) => d.uid === docUid);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '', docType: '', changeSummary: '' });
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<PlanDocumentVersion[]>([]);

  useEffect(() => {
    if (!doc) return;
    setDraft({ title: doc.title, body: doc.body, docType: doc.docType, changeSummary: '' });
    setEditing(false);
  }, [doc?.uid]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, onClose]);

  if (!doc) {
    return null;
  }

  const meta = getSpecDocTypeMeta(doc.docType);

  const onSave = async () => {
    setSaving(true);
    const updates: { title?: string; body?: string; docType?: string; changeSummary?: string } = {};
    if (draft.title !== doc.title) updates.title = draft.title;
    if (draft.body !== doc.body) updates.body = draft.body;
    if (draft.docType !== doc.docType) updates.docType = draft.docType;
    if (draft.changeSummary.trim()) updates.changeSummary = draft.changeSummary.trim();

    if (Object.keys(updates).length > 0) {
      await updatePlanDoc(doc.uid, updates);
    }
    setSaving(false);
    setEditing(false);
  };

  const onDelete = async () => {
    if (!confirm(`Delete "${doc.title}"? This will remove the doc and its version history.`)) return;
    await deletePlanDoc(doc.uid);
    onClose();
  };

  const loadVersions = async () => {
    try {
      const res = await fetch(`/api/plan-docs/${doc.uid}/versions`);
      const data = await res.json();
      setVersions(Array.isArray(data) ? data : []);
      setShowVersions(true);
    } catch {
      setVersions([]);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/[0.06]">
          <div className={`p-2 rounded-lg border shrink-0 ${meta.chipClass}`}>
            <meta.icon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <>
                <select
                  value={draft.docType}
                  onChange={(e) => setDraft({ ...draft, docType: e.target.value })}
                  className="w-full mb-1 text-[11px] bg-transparent border border-white/[0.08] rounded px-2 py-1 text-foreground-muted focus:outline-none focus:border-accent/40"
                >
                  {SPEC_DOC_TYPES.map((t) => (
                    <option key={t.type} value={t.type} className="bg-[#0b1020]">{t.label}</option>
                  ))}
                  {!SPEC_DOC_TYPES.some((t) => t.type === doc.docType) && (
                    <option value={doc.docType}>{doc.docType}</option>
                  )}
                </select>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Doc title"
                  className="w-full text-[15px] font-semibold bg-transparent border-b border-white/[0.06] focus:border-accent/40 focus:outline-none py-1 text-foreground"
                />
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border ${meta.chipClass}`}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-foreground-subtle flex items-center gap-1">
                    <Clock size={9} />
                    v{doc.version} · {new Date(doc.updatedAt).toLocaleString()}
                  </span>
                </div>
                <h2 className="text-[15px] font-semibold text-foreground leading-tight">{doc.title}</h2>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!editing && (
              <>
                <button
                  onClick={loadVersions}
                  className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] transition-colors"
                  title="Version history"
                >
                  <History size={14} />
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] transition-colors"
                  title="Edit"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={onDelete}
                  className="p-1.5 rounded-md text-foreground-subtle hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] transition-colors"
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {editing ? (
            <div className="flex flex-col gap-3 h-full">
              <textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder="Write spec content in markdown — # headings, **bold**, `code`, lists, links..."
                className="flex-1 min-h-[300px] w-full text-[12.5px] font-mono bg-black/30 border border-white/[0.06] rounded-lg p-3 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 leading-relaxed resize-none"
              />
              <input
                type="text"
                value={draft.changeSummary}
                onChange={(e) => setDraft({ ...draft, changeSummary: e.target.value })}
                placeholder="Why this update? (shows in version history)"
                className="w-full text-[11px] bg-white/[0.02] border border-white/[0.06] rounded-md px-3 py-2 text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30"
              />
            </div>
          ) : doc.body ? (
            <Markdown source={doc.body} />
          ) : (
            <div className="text-[12px] text-foreground-subtle italic py-8 text-center">
              This doc has no content yet. Click <Edit3 size={11} className="inline" /> to add some.
            </div>
          )}
        </div>

        {/* Footer */}
        {editing && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/[0.06]">
            <span className="text-[10px] text-foreground-subtle">
              Author: {doc.author} ({doc.authorType})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setEditing(false); setDraft({ title: doc.title, body: doc.body, docType: doc.docType, changeSummary: '' }); }}
                className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save size={11} />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showVersions && (
        <VersionHistoryModal
          versions={versions}
          currentVersion={doc.version}
          onClose={() => setShowVersions(false)}
          onRestore={async (body, summary) => {
            await updatePlanDoc(doc.uid, { body, changeSummary: summary });
            setShowVersions(false);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function VersionHistoryModal({
  versions,
  currentVersion,
  onClose,
  onRestore,
}: {
  versions: PlanDocumentVersion[];
  currentVersion: number;
  onClose: () => void;
  onRestore: (body: string, summary: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<PlanDocumentVersion | null>(versions[0] ?? null);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
            <History size={14} className="text-accent" />
            Version history
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-[200px] border-r border-white/[0.06] overflow-y-auto py-2">
            {versions.length === 0 ? (
              <div className="text-[10.5px] text-foreground-subtle px-3 py-4">No history yet</div>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className={`w-full text-left px-3 py-2 text-[10.5px] transition-colors ${
                    selected?.id === v.id ? 'bg-accent/10 text-accent' : 'text-foreground-muted hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">v{v.version}</span>
                    {v.version === currentVersion && (
                      <span className="text-[8px] text-emerald-300 uppercase tracking-wide">current</span>
                    )}
                  </div>
                  <div className="text-[9.5px] text-foreground-subtle truncate">{v.changeSummary || '(no summary)'}</div>
                  <div className="text-[9px] text-foreground-subtle/70 mt-0.5">{new Date(v.createdAt).toLocaleString()}</div>
                </button>
              ))
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selected ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10.5px] text-foreground-subtle">
                    {selected.author} · {new Date(selected.createdAt).toLocaleString()}
                  </span>
                  {selected.version !== currentVersion && (
                    <button
                      onClick={() => onRestore(selected.body, `Restored from v${selected.version}`)}
                      className="text-[10px] text-accent hover:underline"
                    >
                      Restore this version
                    </button>
                  )}
                </div>
                <div className="rounded-lg bg-black/20 border border-white/[0.04] p-3">
                  <Markdown source={selected.body} />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-[11px] text-foreground-subtle">
                <Eye size={14} className="mr-2" />
                Pick a version to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
