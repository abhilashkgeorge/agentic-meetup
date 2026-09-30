/**
 * The You tab's words, read on the Pixel 6a on 2026-09-30.
 *
 * - "Things to talk about" said "What your agent can say when it meets someone's" -- a
 *   sentence that stopped at "someone's".
 * - Points said "Earned by answering after your dates", which stopped being the whole story
 *   when Cubbon Park started paying points (2026-09-29); and it never said what they are for.
 * - The three numbers at the top were "KNOWN", "WON'T GUESS" and "CAN REACH": known what,
 *   reach whom.
 *
 * Words on a screen, so the source is what is checked. Negative control, run by hand: any
 * one of the old strings back -> this fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const screen = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'profile', 'profile-screen.tsx'), 'utf8');

describe('the You tab', () => {
  it('finishes its sentences and says what its numbers count', () => {
    expect(screen).toContain('subtitle="What your agent can say when it meets another agent"');
    expect(screen).toContain('Earned after your dates and in Cubbon Park, spent on your character.');
    expect(screen).toMatch(/label: 'Things known'/);
    expect(screen).toMatch(/label: 'People in reach'/);
    expect(screen).not.toMatch(/meets someone's"|Earned by answering after your dates|label: 'Known'|label: 'Can reach'/);
  });
});
