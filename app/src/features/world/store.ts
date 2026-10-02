/**
 * What the town knows: the roster, kept in a store so the screen, the HUD and the
 * sheets read one copy. The pure bridge from roster to motion lives in ./bridge.ts,
 * where vitest can reach it; this file is the part that talks to the network.
 */
import { create } from 'zustand';
import { getWorld, type World } from '../../lib/api';

import { eventTransitions, type TownEvent, type Transition } from './bridge';

export { YOU, departed, fromRoster, metSpec, planTransitions, roundActive, stateAfter } from './bridge';
export type { AgentSpec, Motion, Transition, TownEvent } from './bridge';

interface WorldStore {
  world: World | null;
  /** True while a fetch is in flight. */
  loading: boolean;
  /** The square could not be had and there is none from before: said, not a placeholder for good. */
  failed: boolean;
  /** Set by "Send my agent out", so the round's finish can be announced once. */
  announce: string | null;
  /** Motion the socket asked for, waiting for the screen to hand it to the sim. */
  live: Transition[];
  /** Bumped by every town event; the screen refetches the roster shortly after. */
  nudge: number;
  setWorld: (w: World | null) => void;
  setAnnounce: (id: string | null) => void;
  load: (token: string) => Promise<World | null>;
  apply: (ev: TownEvent) => void;
  drained: () => void;
}

export const useWorld = create<WorldStore>((set) => ({
  world: null,
  loading: false,
  failed: false,
  announce: null,
  live: [],
  nudge: 0,
  setWorld: (world) => set({ world }),
  apply: (ev) => set((s) => ({ live: [...s.live, ...eventTransitions(ev)], nudge: Date.now() })),
  drained: () => set({ live: [] }),
  setAnnounce: (announce) => set({ announce }),
  load: async (token) => {
    set({ loading: true });
    const w = await getWorld(token);
    // Offline keeps the last picture rather than blanking the square. With no picture
    // at all, the town says it cannot reach the server, rather than a placeholder for good.
    set((s) => ({ loading: false, world: w ?? s.world, failed: !w && !s.world }));
    return w;
  },
}));
