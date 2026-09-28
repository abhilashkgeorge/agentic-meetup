/**
 * The first setup screen moves on whenever anything was heard.
 *
 * WHAT WAS WRONG (found 2026-09-28 writing docs/END-TO-END.md): the screen advanced only
 * on a LEARNED fact. A sentence about a field the person taps -- city, age, the cards,
 * and since 34f33cf work, exercise, sleep and moving cities -- is only held for a Yes, so
 * "I work in AI and run most mornings" came back as 0 learned, 2 to confirm, and a new
 * person sat on the very first screen reading "Got it" with nowhere to go.
 *
 * Negative control, run 2026-09-28: afterTell without the held-only branch -> "moves on"
 * fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterTell } from '../src/features/onboarding/start-state';

const reply = (learned: number, toConfirm: number, message = 'm') => ({ learned, toConfirm, facts: [], message });

describe('the first setup screen, after "Go"', () => {
  it('moves on when the sentence was only held for a Yes -- and skips the sample reply', () => {
    expect(afterTell(reply(0, 2, 'Got it. 2 to check on the You screen before it changes an answer you gave.')))
      .toEqual({ next: 'questions' });
  });

  it('shows the sample reply when something was learned, held facts or not', () => {
    expect(afterTell(reply(1, 0))).toEqual({ next: 'sample' });
    expect(afterTell(reply(1, 2))).toEqual({ next: 'sample' });
  });

  it('asks again only when nothing was heard at all, or the server was not reached', () => {
    const nothing = 'Nothing new in that one — tell me something I might not know yet.';
    expect(afterTell(reply(0, 0, nothing))).toEqual({ next: 'retry', note: nothing });
    expect(afterTell(null)).toEqual({ next: 'retry', note: 'Could not reach the server.' });
  });

  it('is the rule the screen actually follows', () => {
    // Behaviour inside a React Native screen is not rendered in these tests, so the
    // screen's source is held to calling the tested function (comments stripped).
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'onboarding', 'start-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(src).toContain('afterTell(await tell(');
    expect(src, 'the old learned-only gate is back').not.toMatch(/learned\.learned === 0/);
  });
});
