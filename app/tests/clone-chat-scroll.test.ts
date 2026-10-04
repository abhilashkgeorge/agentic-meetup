/**
 * The newest line of the chat with your clone stays in view, the whole of it.
 *
 * WHAT WAS WRONG (the Pixel, 2026-10-04): with the keyboard up, the end of the clone's
 * reply sat under the box you type in -- "Someone who can keep up with a trek, respects
 * that you don't smoke, and won't" and the rest hidden until the keyboard closed. The list
 * scrolled to its end only when its content changed, at once: not when the list itself
 * shrank as the keyboard opened, and, scrolled at once, to where the end had been before
 * the last line was measured.
 *
 * WHAT IS PINNED (SOURCE SHAPE: the scroll is React Native's; no renderer runs here):
 * the list scrolls to its end on a content change AND on a change of its own size, both
 * a frame later.
 *
 * Negative control, run by hand and recorded in the commit: the list without onLayout ->
 * fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the chat with your clone', () => {
  it('scrolls to its end when its content changes and when it changes size, a frame later', () => {
    const chat = src('features', 'chat', 'clone-chat.tsx');
    expect(chat).toMatch(/const toEnd = useCallback\(\(\) => \{\s*requestAnimationFrame\(\(\) => list\.current\?\.scrollToEnd\(\{ animated: true \}\)\);\s*\}, \[\]\);/);
    expect(chat).toMatch(/onContentSizeChange=\{toEnd\}\s*onLayout=\{toEnd\}/);
  });
});
