/**
 * The character being built, and the one that is saved.
 *
 * One store so the You tab, the builder and (later) the town preview read one copy.
 * `look` is the draft; `saved` says whether the server holds one at all -- until it
 * does, the draft starts from the free character the server seeded for this person.
 */
import { create } from 'zustand';
import { STARTER, clampLook } from '@clone/shared';
import { buyItem, getLook, putLook, type Look } from '../../lib/api';

const NONE: ReadonlySet<string> = new Set();

interface LookStore {
  look: Look;
  /** What the server holds (or seeded): what the draft goes back to when it is left unsaved. */
  kept: Look;
  saved: boolean;
  owned: ReadonlySet<string>;
  balance: number;
  loaded: boolean;
  load: (token: string) => Promise<void>;
  setLook: (look: Look) => void;
  /** Drop the draft: back to what was last loaded or saved. */
  discard: () => void;
  save: (token: string) => Promise<{ ok: true; first: boolean; awarded: number } | { ok: false; error: string; items?: string[] }>;
  buy: (token: string, item: string) => Promise<{ ok: true } | { ok: false; error: string; balance?: number }>;
}

export const useLook = create<LookStore>((set, get) => ({
  look: STARTER,
  kept: STARTER,
  saved: false,
  owned: NONE,
  balance: 0,
  loaded: false,
  load: async (token) => {
    const r = await getLook(token);
    if (!r) return;                                  // offline keeps the last picture
    // CLAMPED ON THE WAY IN. An app that has been updated before the server behind it
    // gets a look with parts it has never heard of and none of the ones it needs --
    // and `look.legs.toString()` on an undefined is a red screen over a pair of
    // trousers. `clampLook` is the same function the server uses on stored rows.
    const look = clampLook(r.look);
    set({ look, kept: look, saved: r.saved, owned: new Set(r.owned), balance: r.balance, loaded: true });
  },
  setLook: (look) => set({ look }),
  discard: () => set({ look: get().kept }),
  save: async (token) => {
    const r = await putLook(token, get().look);
    if (!r) return { ok: false, error: 'offline' };
    if ('error' in r) return { ok: false, error: r.error, ...(r.items ? { items: r.items } : {}) };
    const look = clampLook(r.look);
    set({ look, kept: look, saved: true, balance: r.balance });
    return { ok: true, first: r.first, awarded: r.awarded };
  },
  buy: async (token, item) => {
    const r = await buyItem(token, item);
    if (!r) return { ok: false, error: 'offline' };
    if ('error' in r) return { ok: false, error: r.error };
    set({ owned: new Set(r.owned), balance: r.balance });
    return { ok: true };
  },
}));
