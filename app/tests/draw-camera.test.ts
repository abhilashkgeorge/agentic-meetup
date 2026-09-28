/**
 * The town is drawn through the camera the frame loop moves.
 *
 * THE BUG THIS EXISTS FOR (the founder, 2026-09-29: "when I head to the park area and
 * try to walk the camera is no longer following my character, the view is fixed").
 * The canvas told r3f which camera to draw through only when the mode changed, map to
 * walk or back. A hot reload in development runs Town's useMemo again and builds two
 * new cameras; the mode had not changed, so r3f went on drawing through the old
 * walking camera, frozen where it stood, while the frame loop moved the new one. On
 * the phone: the stick walked the agent off screen and the picture never moved. A log
 * of the agent and the camera showed both moving; the screen did not.
 *
 * Now the camera r3f draws through is compared with the one the frame placed, every
 * frame, and a new one gets its lens set. This lives in a useFrame closure that cannot
 * run without a GL context, so it is held by its SOURCE SHAPE, comments stripped.
 *
 * Negative control, run 2026-09-29 in a copy of the code (a hot reload would have put
 * the broken version on the phone) and restored: move `set({ camera })` back inside the
 * mode change -> both tests fail.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const code = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the camera the town is drawn through', () => {
  it('is checked every frame, not only when the mode changes', () => {
    expect(code).toMatch(/if \(get\(\)\.camera !== camera\) \{\s*set\(\{ camera \}\);\s*lens\.current = '';\s*\}/);
    // ...and set nowhere else: a second, mode-only switch is the bug coming back.
    expect(code.match(/set\(\{ camera \}\)/g)).toHaveLength(1);
  });

  it('is not switched inside the change of mode', () => {
    const start = code.indexOf('if (want !== mode.current) {');
    expect(start).toBeGreaterThan(0);
    const block = code.slice(start, code.indexOf('\n    }\n', start));
    expect(block).not.toContain('set({ camera })');
  });
});
