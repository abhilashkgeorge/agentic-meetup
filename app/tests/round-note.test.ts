/**
 * Why a round met nobody, as a sentence (features/matches/round-note.ts).
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-02): the town and Matches showed the server's reason
 * as it came -- "nobody fits what you have asked for", lowercase, no full stop -- and
 * Matches showed it under "That is not because of anything you asked for".
 *
 * WHAT IS PINNED: every reason the server can give today becomes a sentence; an unknown one
 * is at least capitalised and ended; both screens say it through roundNote. The server's
 * list is read from orchestrator.ts so a new reason there without words here fails.
 *
 * AND IT DOES NOT GO STALE (the two-phone test, 2026-10-02): "Nobody on the app fits what
 * you asked for yet." stayed on both screens -- tabs stay mounted -- after the person had
 * changed what they asked for, and somebody did fit. Each screen now drops its note when
 * the person leaves it (SOURCE SHAPE: focus is React Navigation's, not run here).
 *
 * Negative controls, run by hand and recorded in the commits: world-screen.tsx back on
 * `r.skipped ? r.skipped` -> "both screens" fails; either screen without the clearing focus
 * effect -> "drops the note" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roundNote } from '../src/features/matches/round-note';

const ROOT = join(import.meta.dirname, '..', '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('why a round met nobody', () => {
  it('is a sentence for every reason the server gives', () => {
    const orchestrator = readFileSync(join(ROOT, 'server', 'src', 'matching', 'orchestrator.ts'), 'utf8');
    const reasons = [...orchestrator.matchAll(/stop: (?:target \? )?'([^']+)'(?: : '([^']+)')?/g)]
      .flatMap((m) => [m[1]!, m[2]].filter((x): x is string => Boolean(x)));
    expect(reasons.length).toBeGreaterThanOrEqual(8);
    for (const r of reasons) {
      const said = roundNote(r);
      expect(said, r).toMatch(/^[A-Z]/);
      expect(said, r).toMatch(/[.!?]$/);
    }
    expect(roundNote('nobody fits what you have asked for')).toBe('Nobody on the app fits what you asked for yet.');
  });

  it('is at least capitalised and ended when the reason is new', () => {
    expect(roundNote('something new happened')).toBe('Something new happened.');
    expect(roundNote('Done!')).toBe('Done!');
  });

  it('is what both screens show', () => {
    const world = strip(readFileSync(join(ROOT, 'app', 'src', 'features', 'world', 'world-screen.tsx'), 'utf8'));
    const matches = strip(readFileSync(join(ROOT, 'app', 'src', 'features', 'matches', 'matches-screen.tsx'), 'utf8'));
    expect(world).toContain('r.skipped ? roundNote(r.skipped)');
    expect(matches).toMatch(/round\.skipped\s*\?\s*roundNote\(round\.skipped\)/);
  });

  it('drops the note when the person leaves either screen, so it is never stale', () => {
    for (const screen of [['world', 'world-screen.tsx'], ['matches', 'matches-screen.tsx']]) {
      const src = strip(readFileSync(join(ROOT, 'app', 'src', 'features', ...screen), 'utf8'));
      expect(src, screen[1]).toContain('useFocusEffect(useCallback(() => () => setSaid(null), []));');
    }
  });
});
