/**
 * No screen says how the agents got on, or what an agent worried about.
 *
 * WHAT WAS WRONG. The match card printed the agreement rate as words ("Your agents got
 * on", "did not really click") above a section headed ONE THING I'D WANT TO KNOW, which
 * was the conversation assessor's concern carried through verbatim -- and that is how
 * an invented "comedy writer" reached a real person's card. The sheet you get by
 * tapping someone in the square said the same words, and the square drew them as a
 * tick or a cross over both heads. The list said "The one it liked most is first".
 * Since 2026-09-23 no agent judges anybody (server/src/matching/brief.ts), the server
 * sends none of it, and none of it may be drawn.
 *
 * WHY THE SOURCE, NOT THE SCREEN. These tests run under vitest with no React Native
 * renderer in the room, so what a screen draws cannot be observed here. What can be
 * checked is that no code on these paths reads the fields or holds the words: with the
 * comments stripped, because the comments explain the history and name every one of
 * them.
 *
 * TWO SCANS, because a hand-picked list is what let one through. The first version
 * read nine named files; the Chats tab said "Your agent met them and thinks it is worth
 * it" and the people list said "Your agents are talking now", in files it never
 * opened. Now the verdict WORDS are looked for in every source file, and the verdict
 * FIELDS in every file that reads a card, a met seat or a town cue -- found by what it
 * uses, so a new screen that reads one is scanned without anybody adding it.
 *
 * Negative control: put the old agreement words back in matches-screen.tsx, or
 * `agreement?: AgreementWords` back on WorldAgent, or "thinks it is worth it" back on
 * the Chats tab -> this fails, naming the file.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

/** The code with its comments removed, lines kept, so a hit can still be placed. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/** Every .ts / .tsx file under src, as paths relative to it. */
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name))
    : /\.tsx?$/.test(e.name) ? [relative(SRC, join(dir, e.name))]
    : []);
}
const ALL = sources();

/**
 * Every path where a brief, a met seat or a town cue is read or drawn: the ones named
 * here, plus any file whose code uses a card, the roster or a round event.
 */
const NAMED = [
  'features/matches/matches-screen.tsx',
  'features/matches/reveal-screen.tsx',
  'features/world/agent-sheet.tsx',
  'features/world/hud.tsx',
  'features/world/bridge.ts',
  'features/world/sim.ts',
  'features/world/canvas.tsx',
  'features/world/world-screen.tsx',
  'features/world/people-sheet.tsx',
  'features/world/people.ts',
  'features/world/store.ts',
  'features/dm/conversations-screen.tsx',
  'lib/api.ts',
  'lib/socket.ts',
];
const READS_A_MATCH = /\b(WorldAgent|MatchCard|getMatches|getWorld|TownEvent|ServerEvent)\b|round\.(met|talking|decided|done)/;
const CONSUMERS = [...new Set([
  ...NAMED,
  ...ALL.filter((rel) => READS_A_MATCH.test(stripComments(readFileSync(join(SRC, rel), 'utf8')))),
])];

/** Field names and values: only where a card or a town cue is read. */
const FIELDS: Array<[string, RegExp]> = [
  ['the agreement field', /\bagreement\b/i],
  ['the concern field', /\bconcern\b/i],
  ['a verdict value', /got_on|did_not_click|could_not_tell|AgreementWords/],
];

/**
 * Words a person would read as the agent's judgement: anywhere at all. The consent
 * screen's "Your agent talks to other agents for you" is consent copy, and so the
 * founder's call; it is flagged to him, and deliberately not matched here.
 */
const WORDS: Array<[string, RegExp]> = [
  ['verdict words', /agents got on|really click|were not sure|could not tell|thinks (it|they)|worth it/i],
  ['a conversation that is not held', /agents are talking|talks? to (theirs|other people's agents)/i],
  ['a ranking claim', /liked most|made of (them|each)/i],
];

function scan(files: readonly string[], banned: Array<[string, RegExp]>): string[] {
  const hits: string[] = [];
  for (const rel of files) {
    const code = stripComments(readFileSync(join(SRC, rel), 'utf8'));
    code.split('\n').forEach((line, i) => {
      for (const [what, re] of banned) {
        if (re.test(line)) hits.push(`src/${rel}:${i + 1} ${what}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

describe('what the app may say about a match', () => {
  it('finds the files it has to read', () => {
    // A scan of nothing passes. Every named file exists, so a rename cannot quietly
    // shrink the scan, and the whole tree is more than the named part of it.
    for (const rel of NAMED) expect(ALL, rel).toContain(rel);
    expect(ALL.length).toBeGreaterThan(CONSUMERS.length);
  });

  it('no screen, type or town cue reads a verdict or a concern', () => {
    expect(scan(CONSUMERS, FIELDS)).toEqual([]);
  });

  it('no screen anywhere says what the agent thought of somebody', () => {
    expect(scan(ALL, WORDS)).toEqual([]);
  });

  it('the card type carries the code-written brief and nothing a model wrote', () => {
    const api = stripComments(readFileSync(join(SRC, 'lib/api.ts'), 'utf8'));
    const start = api.indexOf('export interface MatchCard');
    // To the interface's own closing brace, at the start of a line; the quote type
    // inside it has braces of its own.
    const card = api.slice(start, api.indexOf('\n}', start));
    for (const field of ['headline', 'line', 'shared', 'quotes', 'opener']) expect(card).toContain(`${field}:`);
    for (const gone of ['overlaps', 'questions', 'concern', 'agreement']) expect(card).not.toContain(gone);
  });
});
