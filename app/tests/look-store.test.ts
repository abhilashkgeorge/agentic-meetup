/**
 * The builder's draft goes back to what is saved when it is left unsaved.
 *
 * THE BUG (found on the Seeker, 2026-09-29): the You tab's card draws the store's
 * look, which is the builder's DRAFT. Pick a top, go back without saving, and the card
 * showed a character nobody had saved -- until the app restarted.
 *
 * Negative control, run by hand and recorded in the commit: make `discard` a no-op ->
 * "leaves nothing behind" fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER, type Look } from '@clone/shared';

const saved: Look = { ...STARTER, top: 2, hat: 4 };
vi.mock('../src/lib/api', () => ({
  getLook: async () => ({ look: saved, saved: true, owned: [], balance: 20 }),
  putLook: async (_t: string, look: Look) => ({ look, first: false, awarded: 0, balance: 20 }),
  buyItem: async () => null,
}));

let useLook: typeof import('../src/features/look/store').useLook;
beforeEach(async () => {
  vi.resetModules();
  ({ useLook } = await import('../src/features/look/store'));
});

describe('the look store', () => {
  it('leaves nothing behind when the draft is not saved', async () => {
    await useLook.getState().load('t');
    expect(useLook.getState().look).toEqual(saved);
    useLook.getState().setLook({ ...saved, top: 1, legs: 1 });
    useLook.getState().discard();
    expect(useLook.getState().look).toEqual(saved);
  });

  it('keeps what was saved as the thing to go back to', async () => {
    await useLook.getState().load('t');
    const next = { ...saved, hair: 7 };
    useLook.getState().setLook(next);
    expect((await useLook.getState().save('t')).ok).toBe(true);
    useLook.getState().setLook({ ...next, glasses: 1 });
    useLook.getState().discard();
    expect(useLook.getState().look).toEqual(next);
  });
});
