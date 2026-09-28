/**
 * Your own marker disc is a map thing, and it does not follow you on foot.
 *
 * THE BUG THIS EXISTS FOR. The accent disc under your feet exists so you can pick
 * yourself out of sixty-four people seen from above. In walk mode the camera sits
 * behind your own head, so the disc is a purple plate the size of your shoulders that
 * you appear to be standing on. The founder asked what he was walking on before he
 * asked for it to go (2026-09-23) -- it read as scenery, not as a marker.
 *
 * People you have MET keep theirs, in both modes: that is how you spot someone you
 * already know across the grass, and it is the one thing the bodies stopped saying.
 *
 * This is a line inside a `useFrame` closure in a file that cannot be imported outside
 * a GL context, so there is nothing to call and nothing to observe. Named in CLAUDE.md's
 * terms this is the "assert the source shape" case, with comments stripped so the prose
 * above cannot satisfy it.
 *
 * Negative controls, run by hand and recorded in the commit: put the condition back to
 * `a.kind === 'you' || a.kind === 'met'` -> both assertions fail; set `discs.count`
 * to `used` (2026-09-28, the markers packed) -> "leaves no disc behind" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const code = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('the disc under your feet', () => {
  it('is not drawn for you while you are walking', () => {
    const line = code.split('\n').find((l) => l.includes('wearsDisc') && l.includes('='));
    expect(line, 'no line computes wearsDisc -- did the disc condition get inlined again?').toBeTruthy();
    // The whole point: your own disc is conditional on NOT walking.
    expect(line!.replace(/\s+/g, ' ')).toMatch(/a\.kind === 'you' && !cam\.walking/);
  });

  it('is still drawn for people you have met', () => {
    const line = code.split('\n').find((l) => l.includes('wearsDisc') && l.includes('='))!;
    expect(line.replace(/\s+/g, ' ')).toMatch(/a\.kind === 'met'/);
    // ...and unconditionally: no walking test on that half.
    expect(line).not.toMatch(/'met' && /);
  });

  it('leaves no disc behind from the last frame', () => {
    // An InstancedMesh draws its first `count` instances with whatever matrices they
    // last held. The discs are packed -- written only for the people who wear one --
    // so the count has to be exactly how many were written THIS frame, or the disc you
    // had on the map stays standing where you left it when you start walking.
    const after = code.slice(code.indexOf('const wearsDisc'));
    expect(after.slice(0, 600)).toMatch(/discs\.setMatrixAt\(nd, dummy\.matrix\)/);
    expect(code).toMatch(/discs\.count = nd;/);
    expect(code).not.toMatch(/discs\.count = (used|slots)/);
  });
});
