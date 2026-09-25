/**
 * What the two agents asked each other, on a card and in the town.
 *
 * The server builds the lines from two answer sheets (server/src/matching/answer-sheet.ts,
 * pinned in server/tests/answer-sheet.test.ts). This pins how the app draws them,
 * because the drawing is where a missing answer could quietly turn into a guess and a
 * practice template into a quotation:
 *   - a missing answer is "I don't know", never blank and never anything else;
 *   - every word shown is a bank question, somebody's own sentence or "I don't know";
 *   - only a person's own words go in quotation marks; a template is labelled practice;
 *   - in the town both agents answer every question, the asker second, turns
 *     alternate, at most three questions play -- keeping one "I don't know" if there is
 *     one -- and only the current question is on screen;
 *   - the town plays the round's own card, never one the reveal rule held back.
 *
 * Negative controls, run by hand:
 *   - bubblesFor without the asker's own answer           -> "both agents answer" fails
 *   - townLines without the room kept for "I don't know"  -> "keeps one" fails
 *   - pickExchange looking past the round's own cards     -> "the round's own card" fails
 *   - sayOnCard quoting a practice template               -> "quotation marks" fails
 *   - talkBubbles drawing an ask or a reaction as `words`  -> "only their own words" fails
 *   - bubblesForCard ignoring the talk                     -> "plays the talk" fails
 *   - wantRowsView saying "Met" beside a quote             -> "never a verdict" fails
 *   - wantRowsView ignoring a private want's check         -> "says only whether it matches" fails
 *
 * AND THE TALK (2026-09-24): when the agents talked (server talk.ts), the town plays
 * their talk and the card lists it -- a person's sentence is still the only thing in
 * quotation marks, the date idea closes it as a moment of its own, and a card with a
 * talk and no answer-sheet exchange is still played.
 */
import { describe, expect, it } from 'vitest';
import type { MatchCard, QaLine, Talk } from '../src/lib/api';
import {
  CANT_CHECK, DONT_KNOW, NOTHING_YET, bubblesFor, bubblesForCard, chatRows, exchangeRows, onScreen, pickExchange, sayOnCard,
  talkBubbles, wantRowsView,
} from '../src/features/matches/exchange';

const line = (q: string, theirs: string | null, mine: string | null, practice?: boolean): QaLine =>
  ({ q, ask: `About ${q.toLowerCase()}?`, theirs, mine, ...(practice ? { practice } : {}) });

const WEEKENDS = line('Weekends', 'Long bike rides out of the city', 'Up Nandi Hills before sunrise');
const FOOD = line('Favourite food', 'Green curry, every single day', null);
const MUSIC = line('Music', null, 'Old jazz records');
const NOBODY = line('Pets', null, null);

describe('the card', () => {
  it('says "I don\'t know" for a missing answer, and drops a line nobody answered', () => {
    const rows = exchangeRows([WEEKENDS, FOOD, MUSIC, NOBODY]);
    expect(rows.map((r) => r.label)).toEqual(['Weekends', 'Favourite food', 'Music']);
    expect(rows[1]!.you).toEqual({ kind: 'dunno', text: DONT_KNOW });
    expect(rows[2]!.them).toEqual({ kind: 'dunno', text: DONT_KNOW });
    expect(exchangeRows(undefined)).toEqual([]);
  });

  it('puts only a person\'s own words in quotation marks', () => {
    const [real, practice] = exchangeRows([WEEKENDS, line('Work', 'I work in logistics.', null, true)]);
    expect(sayOnCard(real!.them)).toBe('“Long bike rides out of the city”');
    expect(sayOnCard(practice!.them)).toBe('I work in logistics. (practice)');
    expect(sayOnCard(practice!.you)).toBe(DONT_KNOW);
  });
});

describe('the town', () => {
  it('both agents answer every question: one asks, the other answers, then the asker', () => {
    const b = bubblesFor([WEEKENDS, MUSIC]);
    expect(b.map((x) => [x.who, x.kind, x.text])).toEqual([
      ['you', 'ask', 'About weekends?'],
      ['them', 'words', 'Long bike rides out of the city'],
      ['you', 'words', 'Up Nandi Hills before sunrise'],
      ['them', 'ask', 'About music?'],
      ['you', 'words', 'Old jazz records'],
      ['them', 'dunno', DONT_KNOW],
    ]);
  });

  it('says nothing but a bank question, somebody\'s own words or "I don\'t know"', () => {
    const lines = [WEEKENDS, FOOD, MUSIC, NOBODY];
    const allowed = new Set([DONT_KNOW, ...lines.flatMap((l) => [l.ask, l.theirs, l.mine])]);
    for (const b of bubblesFor(lines, 10)) expect(allowed.has(b.text), b.text).toBe(true);
  });

  it('plays three questions at most, and keeps one "I don\'t know" when there is one', () => {
    const both = (n: number) => line(`Q${n}`, `theirs ${n}`, `mine ${n}`);
    const asked = (qa: QaLine[]) => bubblesFor(qa).filter((x) => x.kind === 'ask').map((x) => x.text);
    expect(asked([both(1), both(2), both(3), both(4), MUSIC]))
      .toEqual(['About q1?', 'About q2?', 'About music?']);
    expect(asked([both(1), both(2), both(3), both(4)])).toEqual(['About q1?', 'About q2?', 'About q3?']);
    // Theirs first: it is the one the card's "Ask them about ..." comes from.
    expect(asked([both(1), both(2), both(3), FOOD, MUSIC])).toEqual(['About q1?', 'About q2?', 'About music?']);
  });

  it('shows the current question only', () => {
    const b = bubblesFor([WEEKENDS, MUSIC]);
    expect(onScreen(b, 1).map((x) => x.text)).toEqual(['About weekends?']);
    expect(onScreen(b, 3)).toHaveLength(3);
    expect(onScreen(b, 4).map((x) => x.text)).toEqual(['About music?']);
    expect(onScreen(b, 99)).toEqual(b.slice(3));
    expect(onScreen(b, 0)).toEqual([]);
  });

  it('plays the round\'s own card, and never one the reveal rule held back', () => {
    const card = (id: string, qa: QaLine[]): MatchCard => ({
      id, headline: 'h', line: 'l', shared: [], quotes: [], opener: null, qa, waitingOnYou: qa.length > 0,
    });
    // Newest round first: this round met two people; the first card is plain because
    // the other side decides first, and the card under the round is an older one.
    const list = [card('plain', []), card('mine', [WEEKENDS]), card('older', [FOOD])];
    expect(pickExchange(list, 2)?.id).toBe('mine');
    expect(pickExchange(list, 1), 'reached past the round into an older card').toBeNull();
    expect(pickExchange(list, 0)).toBeNull();
    expect(pickExchange([card('none', [NOBODY])], 1)).toBeNull();
  });
});

describe('the talk', () => {
  const TALK: Talk = {
    lines: [
      { who: 'you', kind: 'ask', text: 'What do you do on weekends?', q: 'Weekends' },
      { who: 'them', kind: 'say', text: 'Most Sundays I am up Nandi Hills before sunrise' },
      { who: 'you', kind: 'react', text: 'Love that.' },
      { who: 'you', kind: 'say', text: 'I cycle out of the city most weekends' },
      { who: 'them', kind: 'ask', text: 'What are you listening to lately?', q: 'Music' },
      { who: 'you', kind: 'dunno', text: "I don't know." },
      { who: 'them', kind: 'say', text: 'I work in logistics.', practice: true },
    ],
    shared: [{ mine: 'I cycle out of the city most weekends', theirs: 'Most Sundays I am up Nandi Hills before sunrise' }],
    date: { idea: 'Sunrise ride out to Nandi Hills', mine: 'I cycle out of the city most weekends', theirs: 'Most Sundays I am up Nandi Hills before sunrise' },
  };

  it('plays in order and closes on the date idea, with only their own words as words', () => {
    const b = talkBubbles(TALK);
    expect(b.map((x) => [x.who, x.kind])).toEqual([
      ['you', 'ask'], ['them', 'words'], ['you', 'react'], ['you', 'words'],
      ['them', 'ask'], ['you', 'dunno'], ['them', 'practice'], ['you', 'date'],
    ]);
    expect(b[5]!.text).toBe(DONT_KNOW);
    expect(b.at(-1)!.text).toBe('Sunrise ride out to Nandi Hills');
    const said = new Set(TALK.lines.filter((l) => l.kind === 'say' && !l.practice).map((l) => l.text));
    for (const x of b.filter((y) => y.kind === 'words')) expect(said.has(x.text), x.text).toBe(true);
    expect(talkBubbles(null)).toEqual([]);
  });

  it('a date idea is a moment of its own on screen', () => {
    const b = talkBubbles(TALK);
    expect(onScreen(b, b.length).map((x) => x.kind)).toEqual(['date']);
  });

  it('plays the talk when there is one, and the exchange when there is not', () => {
    const card = (talk: Talk | null, qa: QaLine[]): MatchCard =>
      ({ id: 'x', headline: 'h', line: 'l', shared: [], quotes: [], opener: null, qa, talk, waitingOnYou: true });
    expect(bubblesForCard(card(TALK, [WEEKENDS]))[0]!.text).toBe('What do you do on weekends?');
    expect(bubblesForCard(card(null, [WEEKENDS]))[0]!.text).toBe('About weekends?');
    // A talk and no exchange is still something to play.
    expect(pickExchange([card(TALK, [])], 1)?.id).toBe('x');
    expect(pickExchange([card(null, [])], 1)).toBeNull();
  });

  it('the card\'s chat puts only a person\'s own words in quotation marks', () => {
    const rows = chatRows(TALK);
    expect(rows.map((r) => r.speaker)).toEqual([
      'Your agent', 'Their agent', 'Your agent', 'Your agent', 'Their agent', 'Your agent', 'Their agent',
    ]);
    expect(rows[1]!.text).toBe('“Most Sundays I am up Nandi Hills before sunrise”');
    expect(rows[0]!.text).toBe('What do you do on weekends?');
    expect(rows[2]!.text).toBe('Love that.');
    expect(rows[5]).toEqual({ speaker: 'Your agent', text: DONT_KNOW, dim: true });
    expect(rows[6]!.text).toBe('I work in logistics. (practice)');
  });
});

describe('what you asked for', () => {
  it('shows your words beside theirs, and never a verdict beside a quote', () => {
    const rows = wantRowsView([
      { want: 'Must love dogs', kind: 'wants', theirs: 'I have two indies and walk them every morning' },
      { want: 'Someone glued to their phone', kind: 'not', theirs: null },
      { want: 'Someone who reads', kind: 'wants', theirs: 'A lot of regional cinema.', practice: true },
    ]);
    expect(rows).toEqual([
      { label: 'You asked for', want: '“Must love dogs”', prefix: 'They said', theirs: '“I have two indies and walk them every morning”', dim: false },
      { label: "You couldn't be with", want: '“Someone glued to their phone”', prefix: 'They said', theirs: NOTHING_YET, dim: true },
      { label: 'You asked for', want: '“Someone who reads”', prefix: 'They said', theirs: 'A lot of regional cinema. (practice)', dim: false },
    ]);
    for (const r of rows) {
      expect(`${r.label} ${r.theirs}`).not.toMatch(/\b(met|not met|matches|matched|fits|passes|good sign|red flag)\b/i);
    }
    expect(wantRowsView(undefined)).toEqual([]);
  });

  it('a private want says only whether it matches, never beside a quote -- and none is left off', () => {
    const rows = wantRowsView([
      { want: "Someone who doesn't drink", kind: 'wants', theirs: null, check: 'matches' },
      { want: 'Same faith as me', kind: 'wants', theirs: null, check: 'doesnt_match' },
      { want: 'Someone politically on the left', kind: 'wants', theirs: null, check: 'cant_check' },
    ]);
    expect(rows.map((r) => [r.prefix, r.theirs, r.dim])).toEqual([
      [null, 'Matches', false], [null, "Doesn't match", false], [null, CANT_CHECK, true],
    ]);
    expect(rows.some((r) => r.theirs.includes('“'))).toBe(false);
  });
});
