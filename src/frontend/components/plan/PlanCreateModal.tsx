import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Layers, FileText } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';

interface TaskInput {
  description: string;
  affectedFiles: string;
}

interface TemplatePlaceholder {
  key: string;
  label?: string;
  default?: string;
}

interface TemplateSummary {
  id: string;
  label: string;
  shortDescription: string;
  longDescription: string;
  defaultTitle: string;
  phaseCount: number;
  docCount: number;
  source?: 'builtin' | 'project' | 'user';
  placeholders?: TemplatePlaceholder[];
}

type Mode = 'blank' | 'template';

export function PlanCreateModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('blank');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tasks, setTasks] = useState<TaskInput[]>([{ description: '', affectedFiles: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const root = useProjectStore((s) => s.root);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);

  // Pull the template list once when the modal opens. Pass the
  // active project so disk templates from `<root>/.codetrellis/templates/`
  // appear alongside built-ins (Phase 13 §C).
  useEffect(() => {
    const url = root
      ? `/api/plan-templates?project=${encodeURIComponent(root)}`
      : '/api/plan-templates';
    fetch(url)
      .then((r) => r.json())
      .then((list: TemplateSummary[]) => {
        if (Array.isArray(list)) setTemplates(list);
      })
      .catch(() => { /* not fatal — blank mode still works */ });
  }, [root]);

  const addTask = () => setTasks([...tasks, { description: '', affectedFiles: '' }]);
  const removeTask = (i: number) => setTasks(tasks.filter((_, j) => j !== i));
  const updateTask = (i: number, field: keyof TaskInput, value: string) => {
    setTasks(tasks.map((t, j) => j === i ? { ...t, [field]: value } : t));
  };

  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (mode === 'template') {
      if (!selectedTemplateId) {
        setError('Pick a template');
        return;
      }
      if (!root) {
        setError('Open a project first');
        return;
      }
      setError('');
      setSubmitting(true);
      const res = await fetch('/api/plans/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          projectPath: root,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          placeholderValues: Object.keys(placeholderValues).length ? placeholderValues : undefined,
        }),
      });
      setSubmitting(false);
      if (!res.ok) {
        setError('Failed to create plan from template');
        return;
      }
      const result = await res.json();
      await fetchPlans(root);
      // Auto-open the new plan so the user can see what got seeded.
      if (result?.plan?.uid) await setActivePlan(result.plan.uid);
      onClose();
      return;
    }

    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!root) {
      setError('Open a project first');
      return;
    }
    setError('');
    setSubmitting(true);

    await fetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        projectPath: root,
        tasks: tasks.filter((t) => t.description.trim()).map((t) => ({
          description: t.description.trim(),
          affectedFiles: t.affectedFiles.split(',').map((f) => f.trim()).filter(Boolean),
        })),
      }),
    });

    await fetchPlans(root);
    setSubmitting(false);
    onClose();
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] w-[520px] max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-foreground">Create Plan</h2>
          <button onClick={onClose} className="text-foreground-subtle hover:text-foreground"><X size={14} /></button>
        </div>

        {/* Mode tabs — Blank vs From template */}
        <div className="flex items-center gap-1 px-5 pt-3">
          <button
            onClick={() => setMode('blank')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors ${
              mode === 'blank'
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent'
            }`}
          >
            <FileText size={11} /> Blank plan
          </button>
          <button
            onClick={() => setMode('template')}
            disabled={templates.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md transition-colors ${
              mode === 'template'
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            <Layers size={11} /> From template
            {templates.length > 0 && (
              <span className="text-[9px] opacity-70">({templates.length})</span>
            )}
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {mode === 'template' && (
            <div className="space-y-2">
              <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">Pick a template</label>
              <div className="space-y-1.5">
                {templates.map((t) => {
                  const selected = selectedTemplateId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplateId(t.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selected
                          ? 'border-accent/40 bg-accent/10'
                          : 'border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04] hover:border-accent/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Layers size={11} className={selected ? 'text-accent' : 'text-foreground-subtle'} />
                        <span className="text-[12px] font-semibold text-foreground flex-1">{t.label}</span>
                        {t.source && t.source !== 'builtin' && (
                          <span className={`text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${
                            t.source === 'project'
                              ? 'text-emerald-300 bg-emerald-500/[0.1] border border-emerald-500/20'
                              : 'text-cyan-300 bg-cyan-500/[0.1] border border-cyan-500/20'
                          }`}>
                            {t.source === 'project' ? 'Project' : 'User'}
                          </span>
                        )}
                        <span className="text-[9px] text-foreground-subtle font-mono">
                          {t.phaseCount} phases · {t.docCount} docs
                        </span>
                      </div>
                      <p className="text-[10.5px] text-foreground-muted mt-1 leading-relaxed">
                        {t.shortDescription}
                      </p>
                    </button>
                  );
                })}
                {templates.length === 0 && (
                  <div className="text-[10.5px] text-foreground-subtle text-center py-4">
                    Loading templates…
                  </div>
                )}
              </div>

              {selectedTemplate && (
                <div className="space-y-3 pt-2 border-t border-white/[0.04]">
                  <div>
                    <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">Title (optional)</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={selectedTemplate.defaultTitle.replace('{name}', '<your label>')}
                      className="w-full mt-1 px-3 py-2 text-[12px] bg-surface border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">Description (optional)</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Override the template default if you have one in mind"
                      rows={2}
                      className="w-full mt-1 px-3 py-2 text-[12px] bg-surface border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-none"
                    />
                  </div>

                  {selectedTemplate.placeholders && selectedTemplate.placeholders.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-white/[0.04]">
                      <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">
                        Template values
                      </label>
                      <p className="text-[10px] text-foreground-subtle leading-relaxed">
                        These fill in <code className="font-mono bg-white/[0.05] px-1 rounded">{'{{'}…{'}}'}</code> placeholders the template author left for you.
                      </p>
                      {selectedTemplate.placeholders.map((p) => (
                        <div key={p.key}>
                          <label className="text-[10px] text-foreground-subtle font-mono">
                            {`{{${p.key}}}`} — {p.label || p.key}
                          </label>
                          <input
                            type="text"
                            value={placeholderValues[p.key] ?? p.default ?? ''}
                            onChange={(e) => setPlaceholderValues({ ...placeholderValues, [p.key]: e.target.value })}
                            placeholder={p.default || p.key}
                            className="w-full mt-1 px-3 py-1.5 text-[11.5px] bg-surface border border-border rounded-md text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-[10px] text-foreground-subtle leading-relaxed">
                    {selectedTemplate.longDescription}
                  </p>
                </div>
              )}
            </div>
          )}

          {mode === 'blank' && (
            <>
              <div>
                <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Add authentication system"
                  className="w-full mt-1 px-3 py-2 text-[12px] bg-surface border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this plan achieves and why"
                  rows={2}
                  className="w-full mt-1 px-3 py-2 text-[12px] bg-surface border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">Tasks</label>
                  <button onClick={addTask} className="flex items-center gap-0.5 text-[10px] text-accent hover:text-accent-hover">
                    <Plus size={10} /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {tasks.map((task, i) => (
                    <div key={i} className="flex gap-2">
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={task.description}
                          onChange={(e) => updateTask(i, 'description', e.target.value)}
                          placeholder={`Task ${i + 1} description`}
                          className="w-full px-2.5 py-1.5 text-[11px] bg-surface border border-border rounded-md text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30"
                        />
                        <input
                          type="text"
                          value={task.affectedFiles}
                          onChange={(e) => updateTask(i, 'affectedFiles', e.target.value)}
                          placeholder="Affected files (comma separated)"
                          className="w-full px-2.5 py-1 text-[10px] bg-surface border border-border-subtle rounded-md text-foreground-muted placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30"
                        />
                      </div>
                      {tasks.length > 1 && (
                        <button onClick={() => removeTask(i)} className="text-foreground-subtle hover:text-danger shrink-0 mt-1">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          {error && <span className="text-[11px] text-red-400 mr-auto">{error}</span>}
          <button onClick={onClose} className="px-4 py-1.5 text-[11px] rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || (mode === 'blank' ? !title.trim() : !selectedTemplateId)}
            className="px-4 py-1.5 text-[11px] rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 shadow-[0_0_10px_rgba(59,130,246,0.2)]"
          >
            {submitting
              ? 'Creating...'
              : mode === 'template'
                ? `Seed plan${selectedTemplate ? ` (${selectedTemplate.phaseCount}+${selectedTemplate.docCount})` : ''}`
                : 'Create Plan'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
