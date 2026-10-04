/**
 * Something arrived that may change a tab's dot (dots.ts): a card met or decided, your
 * turn, an introduction, a message. The socket bumps it (lib/socket.ts); the tab bar
 * reads the two lists again (use-tab-dots.ts). Its own module, with no React Native, so
 * the socket does not import the tab bar.
 */
import { create } from 'zustand';

export const useTabPulse = create<{ n: number; bump: () => void }>((set) => ({
  n: 0,
  bump: () => set((s) => ({ n: s.n + 1 })),
}));
