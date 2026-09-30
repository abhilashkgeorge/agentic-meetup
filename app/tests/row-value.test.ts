/**
 * A list row's value gives way to its title (components/ui/row.tsx).
 *
 * Settings' "Server" row on the Pixel 6a, 2026-09-30: the address (an ngrok host name) could
 * not shrink, so the title's column got what was left and read "Serve" over "r". The value
 * now shrinks, is cut with an ellipsis, and never takes more than 55% of the row. Seen on the
 * phone after it: "Server  0a70-...ng...", and the You tab's short values still whole.
 *
 * Layout only runs on a phone, so the style is what is checked. Negative control, run by
 * hand: the value without flexShrink -> this fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const row = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'row.tsx'), 'utf8');

describe('a row with a value', () => {
  it('lets the value shrink, cut to one line, under 55% of the row', () => {
    expect(row).toMatch(/color: p\.textSecondary, flexShrink: 1, maxWidth: '55%' \}\]\} numberOfLines=\{1\}>\s*\{value\}/);
  });
});
