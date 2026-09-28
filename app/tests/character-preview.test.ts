/**
 * Your character, up close: the builder's stage and the You tab's card.
 *
 * THE BUGS THIS EXISTS FOR (the founder, 2026-09-29):
 *   - "when you click build your character, the character is shown as a capsule and
 *     after some seconds the rig is shown": the preview read the model and built a
 *     rigged body of its own every time it opened, with a capsule standing in;
 *   - "after the character is saved, it goes back but the build your character card
 *     doesn't show the created character rather a capsule is shown": the card was a
 *     flat drawing.
 * Both now draw the town's own prepared body (crowd-gpu.ts), which is built once per
 * app run, so there is nothing to wait for and nothing to stand in.
 *
 * WHAT IS PINNED:
 *   - every framing, held to a real camera: the part it is for is on screen, and the
 *     card's framing fills the well with the whole person;
 *   - the preview and the card use that body, and nothing in them draws a capsule
 *     (SOURCE SHAPE, comments stripped: these are GL components with no phone here).
 *
 * Negative controls, run 2026-09-29 in a git worktree (the phone was attached) and
 * restored: the head framing aimed at the chest -> "puts the part on screen" fails;
 * the card back on CharacterAvatar -> "draws the real body" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { FRAMING, type Focus } from '../src/features/world/framing';

const code = (rel: string) => readFileSync(join(import.meta.dirname, '..', 'src', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** How much of [lo, hi] (heights on the person, at x = z = 0) a framing shows, as screen y. */
function onScreen(f: (typeof FRAMING)[Focus], lo: number, hi: number, aspect: number) {
  const cam = new THREE.PerspectiveCamera(32, aspect, 0.05, 50);
  cam.position.set(...f.eye);
  cam.lookAt(new THREE.Vector3(...f.at));
  cam.updateMatrixWorld();
  const y = (h: number) => new THREE.Vector3(0, h, 0).project(cam).y;
  return { lo: y(lo), hi: y(hi) };
}

describe('where the camera goes', () => {
  // Heights on the model at full size (1.35 tall): see FRAMING.
  const PARTS: Record<string, [number, number]> = {
    head: [1.08, 1.36], top: [0.7, 1.12], legs: [0.08, 0.72], feet: [0, 0.14], body: [0, 1.36],
  };

  it('puts the part being chosen on screen, on a tall stage and a square one', () => {
    for (const aspect of [0.55, 1]) {
      for (const [focus, [lo, hi]] of Object.entries(PARTS)) {
        const s = onScreen(FRAMING[focus as Focus], lo, hi, aspect);
        expect(s.lo, `${focus} bottom at aspect ${aspect}`).toBeGreaterThan(-1);
        expect(s.hi, `${focus} top at aspect ${aspect}`).toBeLessThan(1);
      }
    }
    // ...and a close-up is a close-up: the head fills most of the screen's height.
    const head = onScreen(FRAMING.head, 1.08, 1.36, 0.55);
    expect(head.hi - head.lo).toBeGreaterThan(0.8);
  });

  it('fills the card with the whole person', () => {
    const s = onScreen(FRAMING.card, 0, 1.36, 112 / 150);
    expect(s.lo).toBeGreaterThan(-1);
    expect(s.hi).toBeLessThan(1);
    expect(s.hi - s.lo, 'the person is a small figure in a big well').toBeGreaterThan(1.5);
  });
});

describe('the body it draws', () => {
  it("is the town's prepared body, never a capsule or a rig of its own", () => {
    const canvas = code('features/world/character-canvas.tsx');
    expect(canvas).toContain('loadGpuCrowd()');
    expect(canvas).not.toMatch(/loadCrowd\(|poseAgent|buildParts/);
    expect(code('features/world/canvas.tsx')).not.toMatch(/loadCrowd\(/);
  });

  it('draws the real body on the You tab card', () => {
    const profile = code('features/profile/profile-screen.tsx');
    expect(profile).toContain('<Preview height={150} focus="card"');
    expect(profile).not.toContain('CharacterAvatar');
  });
});
