/**
 * Which of a person's own sentences are on a card, after a Hide or Show tap.
 *
 * The screen moves the "On your card" marks at once, before the server answers; this is
 * the rule it moves them by, and it must say what the server says (server/src/api/me.ts
 * and server/tests/appearance.test.ts): the first two visible sentences, identical
 * wording once, and a hidden one never.
 *
 * The same tap moves the answer sheet: a sentence is hidden everywhere or nowhere, so
 * an answer hidden there leaves the sheet and waits in the hidden list for its Show.
 *
 * Negative controls, run by hand:
 *   - markShown ignoring `hidden`                    -> "a hidden sentence" fails
 *   - markShown not counting identical words once   -> "the same words" fails
 *   - withHidden leaving the sheet alone             -> "leaves the sheet" fails
 *   - withHidden listing a quote a second time       -> "listed once" fails
 *   - withShared leaving the sentence in the list    -> "leaves the learned list" fails
 */
import { describe, expect, it } from 'vitest';
import { markShown, sheetView, withHidden, withShared } from '../src/features/appearance/appearance-state';

const q = (factId: string, text: string, hidden = false) => ({ factId, text, hidden, shown: false });
const base = {
  headline: 'Here for marriage · 29', line: 'Passes your rules both ways', tags: [],
  quotes: markShown([q('a', 'canoe'), q('b', 'bouldering'), q('c', 'subtitles')]),
};
const shown = (a: { quotes: { factId: string; shown: boolean }[] }) => a.quotes.filter((x) => x.shown).map((x) => x.factId);

describe('which sentences are on a card', () => {
  it('is the first two', () => {
    expect(shown(base)).toEqual(['a', 'b']);
  });

  it('is never a hidden sentence, and the next one takes its place', () => {
    const after = withHidden(base, 'a', true);
    expect(shown(after)).toEqual(['b', 'c']);
    expect(after.quotes.find((x) => x.factId === 'a')).toMatchObject({ hidden: true, shown: false });
    expect(shown(withHidden(after, 'a', false))).toEqual(['a', 'b']);
  });

  it('counts the same words once', () => {
    expect(shown({ quotes: markShown([q('a', 'Canoe'), q('b', 'canoe'), q('c', 'subtitles')]) })).toEqual(['a', 'c']);
  });
});

describe('the answer sheet', () => {
  const entry = (id: string, answer: { factId: string; text: string } | null) =>
    ({ id, ask: `${id}?`, short: id[0]!.toUpperCase() + id.slice(1), answer });
  const withSheet = {
    ...base,
    sheet: [entry('weekends', { factId: 'b', text: 'bouldering' }), entry('goal', { factId: 'g', text: 'a bakery' }), entry('music', null)],
    hidden: [],
  };

  it('lays out what the agent answers, then what it says "I don\'t know" to', () => {
    const v = sheetView(withSheet.sheet);
    expect(v.answered.map((q) => q.id)).toEqual(['weekends', 'goal']);
    expect(v.unknown).toEqual(['Music']);
    expect(sheetView(undefined)).toEqual({ answered: [], unknown: [] });
  });

  it('a hidden answer leaves the sheet and waits in the hidden list, and comes back out of it', () => {
    const after = withHidden(withSheet, 'g', true);
    expect(after.sheet!.find((q) => q.id === 'goal')!.answer).toBeNull();
    expect(after.hidden).toEqual([{ factId: 'g', text: 'a bakery' }]);
    const back = withHidden(after, 'g', false);
    expect(back.hidden).toEqual([]);
  });

  it('a sentence that is also a quote is listed once, under its quote', () => {
    const after = withHidden(withSheet, 'b', true);
    expect(after.sheet!.find((q) => q.id === 'weekends')!.answer).toBeNull();
    expect(after.quotes.find((x) => x.factId === 'b')).toMatchObject({ hidden: true, shown: false });
    expect(after.hidden, 'listed twice: under its quote and in the hidden list').toEqual([]);
  });
});

describe('what the clone learned in chat', () => {
  it('"OK to share" leaves the learned list at once', () => {
    const a = { ...base, learned: [{ factId: 'l1', text: 'I have been learning the tabla' }, { factId: 'l2', text: 'x' }] };
    expect(withShared(a, 'l1').learned).toEqual([{ factId: 'l2', text: 'x' }]);
    expect(withShared({ ...base }, 'l1').learned).toEqual([]);
  });
});
