/**
 * "Hide this?" under a sentence that names where somebody works, studied or lives.
 *
 * WHY (build list item 14). The server marks the sentence (server tests/identifying.
 * test.ts); this pins the question's words and that "How you appear" asks it under the
 * quotes and under the agent's answers alike -- beside the Hide the person may tap.
 *
 * WHY PART OF IT IS THE SOURCE: no React Native renderer under vitest; the screen is
 * checked to render the question in both places, comments stripped.
 *
 * Negative control, run 2026-09-25: the quotes list without the question -> "both
 * places" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hideAsk } from '../src/features/appearance/appearance-state';

describe('Hide this?', () => {
  it('says what the sentence names, and asks', () => {
    expect(hideAsk('company')).toBe('This names a company. Hide this?');
    expect(hideAsk('college')).toBe('This names a college. Hide this?');
    expect(hideAsk('building')).toBe('This names a building. Hide this?');
    expect(hideAsk(null)).toBeNull();
    expect(hideAsk(undefined)).toBeNull();
  });

  it('is asked in both places a sentence can leave from', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'appearance', 'appearance-screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src).toMatch(/!q\.hidden && hideAsk\(q\.names\)/);
    expect(src).toMatch(/hideAsk\(q\.answer\.names\)/);
  });
});
