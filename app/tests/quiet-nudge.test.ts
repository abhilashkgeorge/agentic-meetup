/**
 * The one gentle nudge, as the chat and the list show it.
 *
 * WHY (build list item 8): quiet two days after the match -> one nudge, mentioning the
 * date idea, once per match, in the app. The server decides when it is due and
 * remembers it was seen (server tests/quiet-nudge.test.ts); this pins the phone's half:
 * what the card says, that the chat reports it seen as soon as it shows, and that the
 * list says so while it is due.
 *
 * WHY PART OF IT IS THE SOURCE: no React Native renderer runs under vitest, so "the chat
 * calls nudgeSeen when a nudge is on screen" is checked in the code, comments stripped.
 *
 * Negative controls, run 2026-09-25:
 *   - the quiet card never mentioning the idea         -> "mentions the date idea" fails
 *   - thread-screen without the nudgeSeen effect       -> "reports it seen" fails
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatCard, QUIET_LINE } from '../src/features/dm/date-idea';

const IDEA = 'Sunrise walk in Cubbon Park, then filter coffee';
const code = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the quiet nudge', () => {
  it('mentions the date idea, with its button, when there is one', () => {
    expect(chatCard({ idea: IDEA, proposed: false, quiet: true })).toEqual({
      title: 'IT HAS BEEN QUIET FOR TWO DAYS', line: `Your agents had an idea: ${IDEA}`, propose: true, nudge: true,
    });
  });

  it('without an idea, or once it was proposed, it only says hello', () => {
    for (const s of [{ idea: null, proposed: false, quiet: true }, { idea: IDEA, proposed: true, quiet: true }]) {
      expect(chatCard(s)).toEqual({
        title: 'IT HAS BEEN QUIET FOR TWO DAYS', line: 'Say hello? You both said yes.', propose: false, nudge: true,
      });
    }
  });

  it('is not a nudge when it is not quiet: the idea card, or nothing', () => {
    expect(chatCard({ idea: IDEA, proposed: false, quiet: false })?.nudge).toBe(false);
    expect(chatCard({ idea: IDEA, proposed: true, quiet: false })).toBeNull();
    expect(chatCard(null)).toBeNull();
  });

  it('the chat reports it seen as soon as it shows, and the list says so while it is due', () => {
    expect(code('features/dm/thread-screen.tsx')).toMatch(/if \(card\?\.nudge && token\) void nudgeSeen\(token, rendezvousId\)/);
    expect(code('features/dm/conversations-screen.tsx')).toMatch(/c\.quiet\s*\?\s*QUIET_LINE/);
    expect(QUIET_LINE).not.toMatch(/\d{2,}|%/);
  });
});
