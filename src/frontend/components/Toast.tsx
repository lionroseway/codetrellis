import { useLayoutEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useToastStore, type ToastType } from '../stores/toast-store';
import { usePlanStore } from '../stores/plan-store';
import { useUiStore } from '../stores/ui-store';

/** The stack's resting offset from the bottom edge, in px (Tailwind bottom-20). */
const BASE_BOTTOM = 80;
/** Clearance kept between the stack and the minimised-plan chip. */
const CHIP_GAP = 16;

/**
 * How far up the stack must sit to clear the minimised-plan chip.
 *
 * A fixed offset cannot do this. The chip is positioned inside its pane,
 * not the viewport, so its height on screen moves with the panes around
 * it. #73's `bottom-20` cleared it in one layout, and in another a stack
 * of four notifications still overlapped it by ~15px, taking the click
 * meant for "restore plan" (seen as an intermittent failure of
 * workspace-shell.spec on CI, where other specs' plan broadcasts pile up
 * toasts). So the stack measures the chip and sits above it.
 */
function bottomOffsetClearingChip(): number {
  const chip = document.querySelector('[data-minimized-plan-chip]');
  if (!chip) return BASE_BOTTOM;
  const top = chip.getBoundingClientRect().top;
  return Math.max(BASE_BOTTOM, window.innerHeight - top + CHIP_GAP);
}

const TOAST_STYLES: Record<ToastType, { icon: typeof Info; color: string; bg: string; border: string; glow: string }> = {
  info: { icon: Info, color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/20', glow: 'shadow-[0_0_12px_rgba(59,130,246,0.15)]' },
  success: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', glow: 'shadow-[0_0_12px_rgba(34,197,94,0.15)]' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', glow: 'shadow-[0_0_12px_rgba(245,158,11,0.15)]' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', glow: 'shadow-[0_0_12px_rgba(239,68,68,0.15)]' },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  // What decides whether the chip is on screen: re-measure when it changes.
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const [bottom, setBottom] = useState(BASE_BOTTOM);

  useLayoutEffect(() => {
    if (toasts.length === 0) return;
    const measure = () => setBottom(bottomOffsetClearingChip());
    measure();
    // The chip slides in over 300ms; measure again once it has landed.
    const settle = window.setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('resize', measure);
    };
  }, [toasts.length, activePlanUid, workspaceMode]);

  if (toasts.length === 0) return null;

  // bottom-20, not lower: MinimizedPlanChip floats in the same corner, and a
  // toast stacked over it swallowed the click that restores the workspace —
  // for as long as toasts kept arriving.
  return (
    // pointer-events-none on the stack, auto on each toast: the gaps between
    // toasts are not a wall over whatever sits behind them.
    <div
      className="fixed right-4 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none"
      style={{ bottom }}
      data-testid="toast-stack"
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border ${style.border} ${style.bg} backdrop-blur-xl ${style.glow} animate-[slideIn_0.3s_ease-out]`}
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
