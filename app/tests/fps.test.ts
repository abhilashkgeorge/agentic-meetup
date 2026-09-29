/**
 * The frame-rate meter is a debug-build thing, and it stays one.
 *
 * WHAT COULD GO WRONG. A red number pinned over the product is fine on the founder's
 * desk and is not fine in anybody's hands. It ships only if `__DEV__` gates BOTH ends:
 * the canvas must not be asked for statistics at all in a release build (the sampling
 * path sorts a 240-frame buffer twice a second, so the cost is real even with nothing
 * listening), and the meter must render nothing.
 *
 * There is no React Native renderer in this suite, so this reads the source instead --
 * CLAUDE.md's "assert the source shape" case -- with comments stripped so the prose in
 * fps.tsx cannot satisfy its own guard.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - `export const FPS_METER = true` -> the first test fails.
 *   - `onStats={feedFps}` in world-screen -> the second fails.
 *   - drop `if (!FPS_METER || !shot) return null` -> the third fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (...p: string[]) => strip(readFileSync(join(SRC, ...p), 'utf8'));

const fps = read('features', 'dev', 'fps.tsx');
const screen = read('features', 'world', 'world-screen.tsx');

describe('the fps meter', () => {
  it('is switched by __DEV__ and by nothing else', () => {
    expect(fps).toMatch(/export const FPS_METER = __DEV__;/);
    // No second definition hiding further down that would win.
    expect(fps.match(/FPS_METER\s*=/g)).toHaveLength(1);
  });

  it('does not make the canvas measure anything in a release build', () => {
    // The whole sampling path in canvas.tsx is behind `if (!onStats) return`, so an
    // undefined prop is what actually turns it off.
    expect(screen).toMatch(/onStats=\{FPS_METER \? feedFps : undefined\}/);
  });

  it('renders nothing when the flag is off, and nothing before the first report', () => {
    expect(fps).toMatch(/if \(!FPS_METER \|\| !shot\) return null;/);
    // ...and does not even register the sink, so feedFps stays a no-op.
    expect(fps).toMatch(/if \(!FPS_METER\) return;\s*\n\s*const mine = setShot;\s*\n\s*listener = mine;/);
  });

  it('shows the worst frame as well as the mean', () => {
    // A mean alone hides a stutter: 58 fps with one 90 ms frame a second reads clean.
    expect(fps).toMatch(/shot\.fps/);
    expect(fps).toMatch(/shot\.p95/);
    // ...and what the frame cost, so 'laggy' can be told apart from 'too many triangles'.
    expect(fps).toMatch(/shot\.calls/);
    expect(fps).toMatch(/shot\.tris/);
  });

  it('says when the 30 fps cap is what is holding the number down', () => {
    // Without this, a capped 28 fps reads as a phone in trouble -- it is a phone
    // being told to rest, with the UI thread idle at 10 ms between frames.
    expect(fps).toMatch(/capped \? ' · 30 cap' : ''/);
    expect(screen).toMatch(/<FpsMeter capped=\{cap30\}/);
  });

  it('does not let a replacing meter be unregistered by the one it replaced', () => {
    // React mounts the new one before unmounting the old, so an unconditional
    // `listener = null` in the cleanup silences the meter that is actually on screen.
    expect(fps).toMatch(/if \(listener === mine\) listener = null;/);
    expect(fps).not.toMatch(/=> \{ listener = null; \}/);
  });

  it('never eats a touch meant for the world under it', () => {
    expect(fps).toMatch(/pointerEvents="none"/);
  });

  it('stays out of the renderer, so the lazy-import guard still holds', () => {
    expect(fps).not.toMatch(/\bthree\b/);
    expect(fps).not.toMatch(/@react-three/);
  });
});
