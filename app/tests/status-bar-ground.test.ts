/**
 * Scrolled content and the status bar (the You tab on the Pixel, 2026-10-03).
 *
 * WHAT WAS WRONG. Screen lets a long page slide under the status bar, as iPhone apps do --
 * but there the bar is blurred over what passes beneath, and on Android, drawn edge to
 * edge, it is see-through: scrolled rows ("Lives in · Bangalore", "How far you'd go")
 * ran straight through the clock and the battery, both unreadable.
 *
 * WHAT IS GUARDED (SOURCE SHAPE: a scroll position does not exist under vitest): a
 * scrolling Screen with a top inset draws the page's own grey behind the status bar,
 * nearly solid, over the content and under nothing that takes a touch.
 *
 * Negative control, run by hand and recorded in the commit: the ground taken out ->
 * this test fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the status bar over a scrolling page', () => {
  it('has the page\'s own ground behind it, so the clock stays readable', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'screen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\s*\}/g, '');
    const ground = src.match(/\{scroll && topInset && insets\.top > 0 && \(\s*<View pointerEvents="none"\s*style=\{\{([^}]*)\}\}/);
    expect(ground, 'no ground behind the status bar').not.toBeNull();
    expect(ground![1]).toMatch(/position: 'absolute', top: 0, left: 0, right: 0, height: insets\.top/);
    expect(ground![1]).toMatch(/backgroundColor: p\.bg/);
    const opacity = Number(/opacity: ([\d.]+)/.exec(ground![1])?.[1]);
    expect(opacity).toBeGreaterThanOrEqual(0.9);
    // Drawn after the scroll view, so it lies over the content that passes beneath.
    expect(src.indexOf('{scroll && topInset && insets.top > 0')).toBeGreaterThan(src.indexOf('</ScrollView>'));
  });
});
