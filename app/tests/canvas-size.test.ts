/**
 * A GL canvas with no width is an invisible canvas.
 *
 * THE BUG THIS EXISTS FOR. The builder's 3D preview was a blank hole for everybody who
 * opened it, and nothing anywhere said so -- no error, no warning, no red box. The
 * builder centres whatever preview it is handed (`alignItems: 'center'`), and a React
 * Native View that declares a height but no width shrinks to fit its content. A GL
 * canvas has no content to measure, so it was laid out zero pixels wide. expo-gl never
 * got a surface, the frame loop never started, and the component tree was perfectly
 * correct the whole time. It was found by a person looking at a phone (2026-09-22).
 *
 * This cannot be observed without a renderer, so it reads the source instead: every
 * `<Canvas>` in the app has to say how wide it is, one way or another. Named in
 * CLAUDE.md's terms, this is the "assert the source shape" case.
 *
 * Negative control, run by hand and recorded in the commit: drop `alignSelf: 'stretch'`
 * from CharacterCanvas -> this fails, naming canvas.tsx.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Comments stripped, so a width written in prose does not count as a width. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Anything that makes a View take a width it did not measure from its content.
 *
 * NO COLON IN THESE. A style is as often written `{{ height }}` -- object shorthand,
 * the value coming from a variable of the same name -- as `{{ height: 260 }}`, and the
 * first version is exactly what the broken preview used. An earlier draft of this test
 * required the colon, matched neither, and passed happily with the bug in place. The
 * negative control is what found that, which is the entire point of running one.
 */
const WIDTH = /\b(width|minWidth|alignSelf|flex|flexGrow|flexBasis)\b/;
const HEIGHT = /\b(height|minHeight)\b/;

describe('a GL canvas', () => {
  it('always says how wide it is', () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const src = code(readFileSync(file, 'utf8'));
      // Each `<Canvas ...>` opening tag, however it is wrapped across lines.
      for (const m of src.matchAll(/<Canvas\b[\s\S]*?>/g)) {
        const tag = m[0];
        // A Canvas with NO style of its own is fine: it fills its parent, which is the
        // renderer's default and how the town is drawn. The fault is naming ONE axis.
        // That is what reads as "I have decided my size", and a parent that centres
        // its children then gives the other axis nothing.
        if (HEIGHT.test(tag) && !WIDTH.test(tag)) {
          offenders.push(`${file.replace(ROOT, 'src')}: a <Canvas> that sets a height but no width. ` +
            `Inside a centring parent that is zero pixels wide and draws nothing, silently.`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('gives every instanced mesh a bounding sphere of its own', () => {
    // THE OTHER SILENT ONE. three computes an InstancedMesh's bounding sphere lazily,
    // once, from instances 0..count-1, and never invalidates it. The renderer now
    // varies `count` every frame to match who is on screen, so the first raycast
    // freezes the sphere around whatever happened to be visible, and every later tap
    // outside that patch misses. If count is 0 at that moment the sphere has radius
    // -1 and the mesh is untappable for good. Nothing warns; taps just stop working.
    const offenders: string[] = [];
    let watched = 0;
    for (const file of sources(ROOT)) {
      const src = code(readFileSync(file, 'utf8'));
      const built = [...src.matchAll(/new THREE\.InstancedMesh\b/g)].length;
      if (!built) continue;
      const counts = [...src.matchAll(/\.count\s*=/g)].length;
      // More count assignments than meshes means count is being changed after the
      // mesh was made, which is the only case that goes wrong. A mesh built once with
      // a fixed count gets a lazy sphere that is computed correctly and stays correct,
      // which is every other mesh in the world -- the map, the garden, the furniture.
      if (counts <= built) continue;
      watched++;
      const pinned = [...src.matchAll(/\.boundingSphere\s*=/g)].length;
      if (pinned < built) {
        offenders.push(`${file.replace(ROOT, 'src')}: ${built} InstancedMesh whose count changes, ` +
          `only ${pinned} given a bounding sphere of their own`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
    // Guard the guard: if nothing varies its count any more, this test is asleep.
    expect(watched, 'no mesh varies its count, so this checked nothing').toBeGreaterThan(0);
  });

  it('is actually looking at the canvases, not at nothing', () => {
    // Guard the guard. If the pattern above ever stops matching, the test passes for
    // the wrong reason -- which is how this bug survived in the first place.
    let found = 0;
    for (const file of sources(ROOT)) found += [...code(readFileSync(file, 'utf8')).matchAll(/<Canvas\b/g)].length;
    expect(found, 'no <Canvas> found anywhere, so the check above proved nothing').toBeGreaterThan(0);
  });
});
