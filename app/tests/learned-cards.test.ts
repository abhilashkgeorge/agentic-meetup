/**
 * What your clone learned in chat, and whether it may say so (features/knowledge/
 * learned.ts, learned-cards.tsx, learned-screen.tsx, lib/storage.ts keepPrivate).
 *
 * WHAT THE FOUNDER ASKED (2026-10-04): "we need to have a chat option in the town square
 * to chat with my clone ... when the agent learns something from the chat, okay to share
 * should be shown as a card in the chat UI or on the town square map; if more cards are
 * present, it should move to a new screen with all the things the agent has learned ...
 * and a button to okay to share all."
 *
 * WHAT IS GUARDED:
 *   - one or two learned things are asked in the chat, each; more, one card opens them all;
 *   - kept private is never asked again, and remembered for the newest KEPT_MAX;
 *   - "OK to share" is the server's disclosure call, "Keep private" changes nothing there;
 *   - the town has "Your clone", always, with how many wait; the chat shows the cards first.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - CARDS_AT_ONCE at 5 -> "more, one card" fails;
 *   - keepPrivate without its cap -> "the newest KEPT_MAX" fails;
 *   - "Okay to share all" sharing only the first -> "every one" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));

const { CARDS_AT_ONCE, cardsFor, clonePill, stillToAsk } = await import('../src/features/knowledge/learned');
const { KEPT_MAX, getKeptPrivate, keepPrivate } = await import('../src/lib/storage');

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const L = (n: number) => Array.from({ length: n }, (_, i) => ({ factId: `f${i}`, text: `thing ${i}` }));

describe('asking', () => {
  it('one or two, each in the chat; more, one card that opens them all; none, nothing', () => {
    expect(cardsFor([])).toEqual({ kind: 'none' });
    expect(cardsFor(L(1))).toEqual({ kind: 'each', items: L(1) });
    expect(cardsFor(L(CARDS_AT_ONCE))).toEqual({ kind: 'each', items: L(CARDS_AT_ONCE) });
    expect(cardsFor(L(CARDS_AT_ONCE + 1))).toEqual({ kind: 'review', count: CARDS_AT_ONCE + 1 });
    expect(CARDS_AT_ONCE).toBe(2);
  });

  it('what you kept private is not asked again', () => {
    expect(stillToAsk(L(3), ['f1'])).toEqual([L(3)[0], L(3)[2]]);
    expect(stillToAsk(undefined, [])).toEqual([]);
  });

  it('kept private is remembered on the phone, the newest KEPT_MAX, and nothing else', async () => {
    store.clear();
    await keepPrivate(['a', 'b']);
    await keepPrivate(['b', 'c']);
    expect(await getKeptPrivate()).toEqual(['a', 'b', 'c']);
    await keepPrivate(Array.from({ length: KEPT_MAX + 5 }, (_, i) => `x${i}`));
    const kept = await getKeptPrivate();
    expect(kept.length).toBe(KEPT_MAX);
    expect(kept.at(-1)).toBe(`x${KEPT_MAX + 4}`);
    expect(kept.join(',').length, 'past what a secure store holds').toBeLessThan(2048);
  });

  it('the town\'s button says how many wait', () => {
    expect(clonePill(0)).toEqual({ label: 'Your clone' });
    expect(clonePill(3)).toEqual({ label: 'Your clone', detail: '· 3 new' });
  });
});

describe('where it is (SOURCE SHAPE: React Native)', () => {
  it('"OK to share" is the disclosure call; "Keep private" only remembers; "Okay to share all" shares every one', () => {
    const use = src('features', 'knowledge', 'use-learned.ts');
    expect(use).toContain('const r = await setQuoteHidden(token, id, false);');
    expect(use).toMatch(/const keep = useCallback\(async \(ids: readonly string\[\]\) => \{\s*await keepPrivate\(ids\);/);
    const screen = src('features', 'knowledge', 'learned-screen.tsx');
    expect(screen).toContain('const ok = await share(items.map((l) => l.factId));');
    expect(screen).toContain('label="Okay to share all"');
    expect(src('app', 'learned.tsx')).toContain("export { default } from '../features/knowledge/learned-screen';");
  });

  it('the chat shows the cards first; the town has "Your clone", which opens it', () => {
    expect(src('features', 'chat', 'clone-chat.tsx')).toContain('ListHeaderComponent={<LearnedCards />}');
    const hud = src('features', 'world', 'hud.tsx');
    expect(hud).toContain('<EdgePill glyph="💬" label={clone.label} detail={clone.detail} onPress={onClone}');
    const world = src('features', 'world', 'world-screen.tsx');
    expect(world).toContain('onClone={() => setChatOpen(true)} learned={learned.items.length}');
    // Counted again when the chat closes, by the Back key as well as by a tap outside.
    expect(world).toContain('useEffect(() => { if (!chatOpen) void refreshLearned(); }, [chatOpen, refreshLearned]);');
  });
});
