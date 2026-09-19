/**
 * The character being built, and the one that is saved.
 *
 * One store so the You tab, the builder and (later) the town preview read one copy.
 * `look` is the draft; `saved` says whether the server holds one at all -- until it
 * does, the draft starts from the free character the server seeded for this person.
 */
import { create } from 'zustand';
import { STARTER } from '@clone/shared';
import { buyItem, getLook, putLook, type Look } from '../../lib/api';

const NONE: ReadonlySet<string> = new Set();

interface LookStore {
  look: Look;
  saved: boolean;
  owned: ReadonlySet<string>;
  balance: number;
  loaded: boolean;
  load: (token: string) => Promise<void>;
  setLook: (look: Look) => void;
  save: (token: string) => Promise<{ ok: true; first: boolean; awarded: number } | { ok: false; error: string; items?: string[] }>;
  buy: (token: string, item: string) => Promise<{ ok: true } | { ok: false; error: string; balance?: number }>;
}

export const useLook = create<LookStore>((set, get) => ({
  look: STARTER,
  saved: false,
  owned: NONE,
  balance: 0,
  loaded: false,
  load: async (token) => {
    const r = await getLook(token);
    if (!r) return;                                  // offline keeps the last picture
    set({ look: r.look, saved: r.saved, owned: new Set(r.owned), balance: r.balance, loaded: true });
  },
  setLook: (look) => set({ look }),
  save: async (token) => {
    const r = await putLook(token, get().look);
    if (!r) return { ok: false, error: 'offline' };
    if ('error' in r) return { ok: false, error: r.error, ...(r.items ? { items: r.items } : {}) };
    set({ look: r.look, saved: true, balance: r.balance });
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
