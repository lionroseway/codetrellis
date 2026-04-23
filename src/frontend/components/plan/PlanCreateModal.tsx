import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';

interface TaskInput {
  description: string;
  affectedFiles: string;
}

export function PlanCreateModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tasks, setTasks] = useState<TaskInput[]>([{ description: '', affectedFiles: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const root = useProjectStore((s) => s.root);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);

  const addTask = () => setTasks([...tasks, { description: '', affectedFiles: '' }]);
  const removeTask = (i: number) => setTasks(tasks.filter((_, j) => j !== i));
  const updateTask = (i: number, field: keyof TaskInput, value: string) => {
    setTasks(tasks.map((t, j) => j === i ? { ...t, [field]: value } : t));
  };

  const [error, setError] = useState('');

  const handleSubmit = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] w-[520px] max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-foreground">Create Plan</h2>
          <button onClick={onClose} className="text-foreground-subtle hover:text-foreground"><X size={14} /></button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06]">
          {error && <span className="text-[11px] text-red-400 mr-auto">{error}</span>}
          <button onClick={onClose} className="px-4 py-1.5 text-[11px] rounded-lg border border-border text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="px-4 py-1.5 text-[11px] rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-40 shadow-[0_0_10px_rgba(59,130,246,0.2)]"
          >
            {submitting ? 'Creating...' : 'Create Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
