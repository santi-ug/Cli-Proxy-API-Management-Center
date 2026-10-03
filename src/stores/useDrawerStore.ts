/**
 * The app-wide navigation drawer. MainLayout renders it; any page header can
 * open it. `opener` is where focus returns when the drawer closes.
 */

import { create } from 'zustand';

interface DrawerState {
  open: boolean;
  opener: HTMLElement | null;
  openDrawer: (opener: HTMLElement | null) => void;
  closeDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  open: false,
  opener: null,
  openDrawer: (opener) => set({ open: true, opener }),
  closeDrawer: () => set({ open: false }),
}));
