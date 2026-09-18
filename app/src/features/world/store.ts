/**
 * What the town knows: the roster, kept in a store so the screen, the HUD and the
 * sheets read one copy. The pure bridge from roster to motion lives in ./bridge.ts,
 * where vitest can reach it; this file is the part that talks to the network.
 */
import { create } from 'zustand';
import { getWorld, type World } from '../../lib/api';

export { YOU, fromRoster, planTransitions, roundActive } from './bridge';
export type { AgentSpec, Transition } from './bridge';

interface WorldStore {
  world: World | null;
  /** True while a fetch is in flight. */
  loading: boolean;
  /** Set by "Send my agent out", so the round's finish can be announced once. */
  announce: string | null;
  setWorld: (w: World | null) => void;
  setAnnounce: (id: string | null) => void;
  load: (token: string) => Promise<World | null>;
}

export const useWorld = create<WorldStore>((set) => ({
  world: null,
  loading: false,
  announce: null,
  setWorld: (world) => set({ world }),
  setAnnounce: (announce) => set({ announce }),
  load: async (token) => {
    set({ loading: true });
    const w = await getWorld(token);
    // Offline keeps the last picture rather than blanking the square.
    set((s) => ({ loading: false, world: w ?? s.world }));
    return w;
  },
}));
