/**
 * The reveal's two answers, one above the other (features/matches/reveal-screen.tsx).
 *
 * WHAT WAS WRONG (the Pixel at its larger display size, 2026-10-02): "Yes, share mine back"
 * and "Not for me" sat side by side, half the row each, and the yes -- the one button the
 * screen is for -- read "Yes, share mine b...". Layout only runs on a phone, so the shape is
 * checked: no row, no half widths, and "Not for me" a full button rather than a faint one,
 * so both answers weigh the same.
 *
 * Negative control, run by hand and recorded in the commit: reveal-screen.tsx as it was
 * -> fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'matches', 'reveal-screen.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the reveal\'s answers', () => {
  it('stand one above the other, each the full width, and weigh the same', () => {
    expect(src).not.toContain('<ButtonRow');
    const yes = src.slice(src.indexOf('WORDS.shareBack :'), src.indexOf('answer(true)'));
    const no = src.slice(src.indexOf('label={WORDS.notForMe}'), src.indexOf('answer(false)'));
    expect(yes).not.toContain('flex: 1');
    expect(no).not.toContain('flex: 1');
    expect(no).not.toContain('variant="ghost"');
  });
});
