/**
 * The town's GL context outlives navigation (patches/expo-gl+57.0.2.patch; the founder,
 * 2026-09-30: "the fps dropped from 100+ fps to 22fps what happened here?").
 *
 * WHAT WAS WRONG. Android detaches a screen's views whenever something covers it: another
 * tab, or a screen pushed on top ("How you appear", a card, Settings). expo-gl's GLView is a
 * TextureView, and on a detach it destroyed its GL context; coming back made a new one, and
 * @react-three/fiber rebuilt the whole scene on it. Measured on the Pixel 6a: every return
 * to the town started a new GL thread (Thread-9, -15, -16, -17 ... one per return), the map
 * showed blank for a moment, and seven returns took the app from 578 to 689 MB of native
 * heap (981 to 1233 MB PSS).
 *
 * THE FIX, in expo-gl's Android code: a detach keeps the SurfaceTexture -- and with it the
 * EGL surface and context -- and hands it back to the view when it is attached again; no
 * swap happens while it is off the window (nothing consumes frames then, and a full queue
 * would block the GL thread); the context is destroyed when the view is dropped for good.
 * After it, eight returns in a row kept the same GL thread (Thread-8).
 *
 * WHY THE SOURCE SHAPE IS ASSERTED. The behaviour lives in Kotlin and Java that only runs
 * on a phone. What can silently undo it here is: the patch losing a piece, `npm install`
 * not applying it, or -- the trap -- expo-gl being linked from its PRECOMPILED library
 * (node_modules/expo-gl/local-maven-repo), which ignores the patched sources entirely. The
 * first build after writing the patch did exactly that: it installed, and nothing changed.
 *
 * Negative controls, run by hand and recorded in the commit: GLView.kt in node_modules put
 * back as shipped -> "is applied" fails; app/package.json without buildFromSource ->
 * "is compiled" fails; the patch without its OnViewDestroys hunk -> "keeps" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const GL = ['node_modules', 'expo-gl', 'android', 'src', 'main', 'java', 'expo', 'modules', 'gl'];

describe('the town keeps its GL context when another screen covers it', () => {
  const patch = read('patches', 'expo-gl+57.0.2.patch');

  it('keeps: a detach keeps the surface, an attach gives it back, a drop destroys it', () => {
    expect(patch).toMatch(/\+\s+keptSurface = surface\n\+\s+glContext\.setSurfacePaused\(true\)\n\+\s+return false/);
    expect(patch).toMatch(/\+\s+override fun onAttachedToWindow\(\)[\s\S]*?\+\s+setSurfaceTexture\(kept\)/);
    expect(patch).toMatch(/\+\s+fun release\(\) \{\n\+\s+dropped = true\n\+\s+glContext\.destroy\(\)/);
    expect(patch).toMatch(/\+\s+OnViewDestroys \{ view: GLView ->\n\+\s+view\.release\(\)/);
    // No swap while nothing consumes frames.
    expect(patch).toMatch(/\+\s+if \(!isHeadless\(\) && !mSurfacePaused && EXGLContextNeedsRedraw\(mEXGLCtxId\)\)/);
  });

  it('is applied: the installed expo-gl is the patched one, and install applies it', () => {
    expect(JSON.parse(read('node_modules', 'expo-gl', 'package.json')).version, 'expo-gl moved: remake the patch').toBe('57.0.2');
    expect(read(...GL, 'GLView.kt')).toContain('keptSurface = surface');
    expect(read(...GL, 'GLModule.kt')).toContain('OnViewDestroys { view: GLView ->');
    expect(JSON.parse(read('package.json')).scripts.postinstall).toBe('patch-package');
  });

  it('is compiled: expo-gl builds from its sources, not the precompiled library', () => {
    const app = JSON.parse(read('app', 'package.json'));
    expect(app.expo?.autolinking?.android?.buildFromSource ?? []).toContain('expo-gl');
  });
});
