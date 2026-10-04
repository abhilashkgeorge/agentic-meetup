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
 *   - the town has "Your clone", always, with how many wait; the chat shows the cards first;
 *   - the list is read by its own call, which costs no model call, and once however many
 *     ask at the same time: opening the town asked "How you appear" three times at once,
 *     and each could build the answer sheet -- three of a new person's ten turns (the
 *     Pixel, 2026-10-04; the server side is server/tests/first-day-turns.test.ts).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - CARDS_AT_ONCE at 5 -> "more, one card" fails;
 *   - keepPrivate without its cap -> "the newest KEPT_MAX" fails;
 *   - "Okay to share all" sharing only the first -> "every one" fails;
 *   - readLearned without the shared read -> "once" fails;
 *   - the hook reading "How you appear" again -> "its own call" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const server = vi.hoisted(() => ({ asked: 0, learned: [] as { factId: string; text: string }[] }));
vi.mock('../src/lib/api', () => ({
  getLearned: async () => {
    server.asked++;
    await new Promise((r) => setTimeout(r, 20));
    return { learned: server.learned };
  },
  setQuoteHidden: async () => ({ ok: true }),
}));
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
    // Read aloud as words, in the singular for one: "1 agents here", "1 new things" were
    // heard on the Pixel (2026-10-04).
    expect(hud).toContain("accessibilityLabel={`${area}, ${here} ${here === 1 ? 'agent' : 'agents'} here. Who they are`} />");
    expect(hud).toContain("new ${learned === 1 ? 'thing' : 'things'} it learned");
    const world = src('features', 'world', 'world-screen.tsx');
    expect(world).toContain('onClone={() => setChatOpen(true)} learned={learned.items.length}');
    // Counted again when the chat closes, by the Back key as well as by a tap outside.
    expect(world).toContain('useEffect(() => { if (!chatOpen) void refreshLearned(); }, [chatOpen, refreshLearned]);');
  });
});

describe('reading what it learned', () => {
  it('asks the server once however many ask at the same time', async () => {
    const { readLearned } = await import('../src/features/knowledge/read-learned');
    server.asked = 0;
    server.learned = L(3);
    const [a, b, c] = await Promise.all([readLearned('t'), readLearned('t'), readLearned('t')]);
    expect(server.asked, 'the town asked once per reason, not once').toBe(1);
    expect(a).toEqual(b);
    expect(c?.map((l) => l.factId)).toEqual(['f0', 'f1', 'f2']);
    // And asks again next time: the shared read is only while one is running.
    await readLearned('t');
    expect(server.asked).toBe(2);
  });

  it('by its own call, which costs no model call -- never through "How you appear" (SOURCE SHAPE)', () => {
    const read = src('features', 'knowledge', 'read-learned.ts');
    expect(read).toContain('const [seen, kept] = await Promise.all([getLearned(token), getKeptPrivate()]);');
    const use = src('features', 'knowledge', 'use-learned.ts');
    expect(use).toContain('const now = await readLearned(token);');
    expect(use + read).not.toContain('getAppearance');
    expect(src('lib', 'api.ts')).toContain("get<{ learned: { factId: string; text: string }[] }>('/v1/me/learned', token);");
  });
});
