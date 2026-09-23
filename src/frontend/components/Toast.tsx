import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useToastStore, type ToastType } from '../stores/toast-store';

const TOAST_STYLES: Record<ToastType, { icon: typeof Info; color: string; bg: string; border: string; glow: string }> = {
  info: { icon: Info, color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/20', glow: 'shadow-[0_0_12px_rgba(59,130,246,0.15)]' },
  success: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', glow: 'shadow-[0_0_12px_rgba(34,197,94,0.15)]' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', glow: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', glow: 'shadow-[0_0_12px_rgba(239,68,68,0.15)]' },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  // bottom-20, not lower: MinimizedPlanChip floats in the same corner, and a
  // toast stacked over it swallowed the click that restores the workspace —
  // for as long as toasts kept arriving.
  return (
    <div className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border ${style.border} ${style.bg} backdrop-blur-xl ${style.glow} animate-[slideIn_0.3s_ease-out]`}
          >
            <Icon size={14} className={`${style.color} shrink-0 mt-0.5 drop-shadow-[0_0_3px_currentColor]`} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-foreground">{toast.title}</p>
              {toast.message && (
                <p className="text-[10px] text-foreground-muted mt-0.5 leading-relaxed">{toast.message}</p>
              )}
            </div>
            <button onClick={() => removeToast(toast.id)} className="text-foreground-subtle hover:text-foreground shrink-0">
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
