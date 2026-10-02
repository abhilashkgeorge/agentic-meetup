/**
 * Where the two of you are on screen, sitting on a bench (the founder, 2026-10-03: "when
 * both of us sit ... on the pixel screen, the user characters are covered by the [cards]
 * and all the ui buttons").
 *
 * WHAT WAS WRONG. Seated, the camera stayed the walking one -- behind your head, aimed
 * well past you -- which puts the two of you in the lower half of the screen, under the
 * park's cards, its chat line and its voice buttons.
 *
 * WHAT IS GUARDED, through a real three.js lens the size of the phone's: the bench view
 * (camera.ts benchFrame) puts the pair BENCH_SCREEN_Y down the screen -- in the top third,
 * clear of everything the park draws over the bottom -- faces them from in front, and
 * fits both of them across a narrow phone. The walking view, for contrast, has them low.
 *
 * Negative control, run by hand and recorded in the commit: benchFrame looking at
 * WALK_EYE (the walking camera's height) -> "in the top third" fails.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BENCH_SCREEN_Y, BENCH_SUBJECT_Y, WALK_FOV, benchFrame, followPose,
} from '../src/features/world/camera';
import { SEAT } from '../src/features/world/bench';

/** Where a point lands on a phone-shaped screen through this pose: 0..1 from the top left. */
function onScreen(eye: [number, number, number], look: [number, number, number], p: [number, number, number], aspect = 412 / 892) {
  const cam = new THREE.PerspectiveCamera(WALK_FOV, aspect, 0.08, 60);
  cam.position.set(...eye);
  cam.lookAt(...look);
  cam.updateMatrixWorld();
  const v = new THREE.Vector3(...p).project(cam);
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inFront: v.z < 1 };
}

describe('the bench view', () => {
  for (const facing of [0, 1.1, -2.4]) {
    it(`puts the pair in the top third, facing them (bench facing ${facing})`, () => {
      const f = benchFrame(facing);
      const { eye, look } = followPose(10, -4, f.yaw, f.back, f.rise, f.aim, f.lookY);
      const pair = onScreen(eye, look, [10, BENCH_SUBJECT_Y, -4]);
      expect(pair.inFront).toBe(true);
      expect(pair.y, 'the pair sits under the cards and buttons').toBeGreaterThan(0.2);
      expect(pair.y, 'the pair sits under the cards and buttons').toBeLessThan(0.36);
      expect(pair.y).toBeCloseTo(BENCH_SCREEN_Y, 1);
      expect(pair.x).toBeCloseTo(0.5, 2);
      // In front of them: the lens is on the side they face.
      const front = [Math.sin(facing), Math.cos(facing)];
      expect((eye[0] - 10) * front[0]! + (eye[2] + 4) * front[1]!).toBeGreaterThan(0);
      // Both of them, side by side, across a narrow phone.
      const c = Math.cos(facing), s = Math.sin(facing);
      for (const side of [-1, 1]) {
        const seat = onScreen(eye, look, [10 + side * (SEAT + 0.05) * c, BENCH_SUBJECT_Y, -4 - side * (SEAT + 0.05) * s]);
        expect(seat.x).toBeGreaterThan(0.1);
        expect(seat.x).toBeLessThan(0.9);
      }
    });
  }

  it('where the walking view had them: low, under the cards', () => {
    const { eye, look } = followPose(10, -4, 0);
    expect(onScreen(eye, look, [10, BENCH_SUBJECT_Y, -4]).y).toBeGreaterThan(0.5);
  });
});

describe('the ring round the one you are with', () => {
  it('is a thin yellow outline, not a solid band, and is gone while they sit', async () => {
    const { RING_COLOR, ringShown } = await import('../src/features/world/park-live');
    expect(RING_COLOR).toBe('#ffee02');
    expect(ringShown({ ring: true, state: 'idle' })).toBe(true);
    expect(ringShown({ ring: true, state: 'walking' })).toBe(true);
    expect(ringShown({ ring: true, state: 'sitting' }), 'shown on the bench').toBe(false);
    expect(ringShown({ ring: false, state: 'idle' })).toBe(false);
    // SOURCE SHAPE (the canvas needs GL): a flat ring of a thin band, unlit, drawn by the rule.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const canvas = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(canvas).toContain('ring: new THREE.RingGeometry(0.5, 0.58, 48),');
    expect(canvas).toMatch(/new THREE\.InstancedMesh\(g\.ring, ringMat, slots\)/);
    expect(canvas).toMatch(/const ringMat = new THREE\.MeshBasicMaterial\(/);
    expect(canvas).toContain('if (ringShown(a)) {');
  });
});
