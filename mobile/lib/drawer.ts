/**
 * Global navigation drawer state.
 *
 * A tiny Zustand store so any screen can open the app-wide side panel
 * (AppDrawer) — the panel itself is mounted once at the root layout and
 * overlays everything. Decouples the trigger (a ☰ in the tab header) from
 * the panel (rendered in _layout) without prop-drilling through navigators.
 */

import { create } from 'zustand';

interface DrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
  toggleDrawer: () => set((s) => ({ open: !s.open })),
}));
