import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, default 5000
  /**
   * A toast with the same key replaces the one showing, in its place, and
   * its timer starts again (Phase 33 S2: a burst is one notice, never a
   * stack of them).
   */
  key?: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

let counter = 0;
/** Each showing toast's dismissal timer, so a keyed replacement can restart it. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const duration = toast.duration ?? 5000;
    const same = toast.key ? get().toasts.find((t) => t.key === toast.key) : undefined;
    const id = same?.id ?? `toast-${++counter}`;

    if (same) {
      clearTimeout(timers.get(id));
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...toast, id } : t)) }));
    } else {
      set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] })); // Keep max 5
    }

    timers.delete(id);
    if (duration > 0) {
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration));
    }
  },

  removeToast: (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
