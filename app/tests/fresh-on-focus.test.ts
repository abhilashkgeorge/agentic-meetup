/**
 * The tabs that say whether your agent can go out re-read it every time they are shown.
 *
 * WHAT WAS WRONG (the founder, 2026-09-24). He answered all five cards, tapped "Let it
 * go out", and landed on Matches -- which still said "It still needs your answer about
 * children", and four more, with a "Finish setting it up" button back into the setup he
 * had just finished: "it never finishes setting it up". The server had him in the pool
 * three minutes earlier (match_profile.in_pool true, all five question_answers rows
 * there). The screen was wrong, not the data: a tab stays mounted, and Matches and You
 * loaded once, on mount, so the card they drew before the setup outlived it.
 *
 * HOW IT IS GUARDED. There is no React Native renderer under vitest, so the screens
 * cannot be focused here. The test reads their source with comments stripped (the
 * comments explain the old way and would match) and checks that each loads inside
 * useFocusEffect and never in a mount-only effect.
 *
 * Negative control, run 2026-09-24: put matches-screen.tsx's
 * `useEffect(() => { void load(); }, [load])` back -> both checks fail for it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\{\s*\}/g, '{}');

/** Every tab screen that draws "Finish setup" or the pool from the server. */
const TABS = [
  'features/matches/matches-screen.tsx',
  'features/profile/profile-screen.tsx',
  'features/dm/conversations-screen.tsx',
];

describe('a tab re-reads what it shows on every focus', () => {
  for (const file of TABS) {
    const src = strip(readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8'));

    it(`${file} loads inside useFocusEffect`, () => {
      expect(src).toMatch(/useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\)/);
    });

    it(`${file} does not load once on mount`, () => {
      expect(src).not.toMatch(/useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/);
    });
  }
});
