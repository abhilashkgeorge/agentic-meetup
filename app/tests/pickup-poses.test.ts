/**
 * The body on the emergency pickup (the founder, 2026-10-03: "the rope should be hooked to
 * a person's back and you can give actions to hands and legs (animate it) like he is
 * being pulled and dropped").
 *
 * WHAT WAS WRONG. Hanging under the balloon and coming down by parachute, the person was
 * the standing idle -- arms at the sides, feet together -- lifted off the ground, and the
 * rope came out of the middle of their chest.
 *
 * WHAT IS GUARDED, on the real model and the real bake (crowd-gpu.ts hangPose, chutePose):
 *   - hanging: a loop of frames in which the arms are flung up and out above the
 *     shoulders and flap, and the legs kick -- each foot swings forward and back, the
 *     two out of step;
 *   - under the parachute: both hands up above the head, on the lines;
 *   - the pose a body takes follows the flight: hanging while yanked up and carried,
 *     the parachute coming down, standing otherwise; and the shader picks those frames;
 *   - the rope is hooked behind the body, between the shoulder blades.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - hangPose without the kick (legs straight down) -> "the legs kick" fails;
 *   - poseOf ignoring the flight -> "follows the flight" fails;
 *   - hookOf at the body's middle -> "hooked to the back" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type * as Gpu from '../src/features/world/crowd-gpu';
import { hookOf } from '../src/features/world/rig-mesh';
import { flightAt, flightMs } from '../src/features/world/flight';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

let gpu: typeof Gpu;
let bake: Gpu.Bake;
let names: string[];
let inverses: THREE.Matrix4[];

beforeAll(async () => {
  gpu = await import('../src/features/world/crowd-gpu');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(join(import.meta.dirname, '..', 'assets', 'characters', 'people.glb'));
  const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  names = meshes[0]!.skeleton.bones.map((b) => b.name);
  inverses = meshes[0]!.skeleton.boneInverses;
  bake = gpu.bakeClips(gltf.scene, names, inverses, new Map(gltf.animations.map((c) => [c.name, c])));
});

/** Where a bone's joint is in a row of the bake. */
const joint = (bone: string, row: number) => {
  const i = names.indexOf(bone);
  const bind = new THREE.Vector3().setFromMatrixPosition(inverses[i]!.clone().invert());
  return gpu.skinFromBake(bake, row, [i, 0, 0, 0], [1, 0, 0, 0], bind);
};

describe('hanging from the pickup\'s rope', () => {
  it('is its own loop of frames in the bake, after the bicycle\'s', () => {
    expect(bake.hang.frames).toBe(gpu.HANG_FRAMES);
    expect(bake.chute.frames).toBe(gpu.CHUTE_FRAMES);
    expect(bake.hang.row).toBe(bake.ride.row + bake.ride.frames);
    expect(bake.chute.row).toBe(bake.hang.row + bake.hang.frames);
    expect(bake.rows).toBe(bake.chute.row + bake.chute.frames);
  });

  it('flings the arms up and out above the shoulders, and they flap', () => {
    const lifts: number[] = [];
    for (let f = 0; f < bake.hang.frames; f += 6) {
      const row = bake.hang.row + f;
      for (const s of ['L', 'R'] as const) {
        const wrist = joint(`Wrist${s}`, row), shoulder = joint(`UpperArm${s}`, row);
        expect(wrist.y, `the ${s} hand hangs down at frame ${f}`).toBeGreaterThan(shoulder.y);
        expect(Math.abs(wrist.x), `the ${s} arm is not out to the side at frame ${f}`).toBeGreaterThan(Math.abs(shoulder.x) + 0.25);
        if (s === 'L') lifts.push(wrist.y);
      }
    }
    expect(Math.max(...lifts) - Math.min(...lifts), 'the arms do not flap').toBeGreaterThan(0.08);
  });

  it('the legs kick: each foot swings forward and back, the two out of step', () => {
    const zs = (s: 'L' | 'R') => Array.from({ length: bake.hang.frames }, (_, f) => joint(`Foot${s}`, bake.hang.row + f).z);
    const l = zs('L'), r = zs('R');
    expect(Math.max(...l) - Math.min(...l), 'the left leg does not kick').toBeGreaterThan(0.25);
    expect(Math.max(...r) - Math.min(...r), 'the right leg does not kick').toBeGreaterThan(0.25);
    // Out of step: when the left is furthest forward, the right is behind it.
    const f = l.indexOf(Math.max(...l));
    expect(r[f]!, 'both legs kick together').toBeLessThan(l[f]! - 0.2);
    // And off the ground: the feet hang below the hips, nowhere near the floor plane.
    for (let k = 0; k < bake.hang.frames; k += 8) {
      expect(joint('FootL', bake.hang.row + k).y).toBeLessThan(joint('UpperLegL', bake.hang.row + k).y - 0.4);
    }
  });
});

describe('under the parachute', () => {
  it('both hands are up above the head, on the lines', () => {
    for (let f = 0; f < bake.chute.frames; f += 12) {
      const row = bake.chute.row + f;
      const head = joint('Head', row);
      for (const s of ['L', 'R'] as const) {
        expect(joint(`Wrist${s}`, row).y, `the ${s} hand is not up at frame ${f}`).toBeGreaterThan(head.y);
      }
    }
  });
});

describe('the pose follows the flight', () => {
  const hop = { fx: 0, fz: 0, tx: 12, tz: 5 };
  const poseAt = (ms: number) => gpu.poseOf({ state: 'idle', rig: flightAt(hop, ms) });

  it('standing as the balloon rises, hanging while yanked up and carried, the parachute coming down, standing once down', () => {
    expect(poseAt(100)).toBe(gpu.POSE.stand);
    expect(poseAt(700)).toBe(gpu.POSE.hang);
    expect(poseAt(1300)).toBe(gpu.POSE.hang);
    expect(poseAt(flightMs(hop) - 600)).toBe(gpu.POSE.chute);
    expect(poseAt(flightMs(hop) + 10)).toBe(gpu.POSE.stand);
    expect(gpu.poseOf({ state: 'sitting' })).toBe(gpu.POSE.sit);
    expect(gpu.poseOf({ state: 'walking', riding: true })).toBe(gpu.POSE.ride);
  });

  it('carries the pose and the lift in aAnim.w, exactly, and the shader picks the frames by it', () => {
    for (const pose of Object.values(gpu.POSE)) {
      for (const ghost of [false, true]) {
        const w = gpu.animFlags(ghost, pose, 4.73);
        expect(w % 2).toBe(ghost ? 1 : 0);
        expect(Math.floor((w % 16) / 2)).toBe(pose);
        expect(Math.floor(w / 16) / 100).toBeCloseTo(4.73, 5);
        expect(Math.fround(w)).toBe(w);
      }
    }
    // Sitting is still 2 and riding 4, as before the pickup's two.
    expect(gpu.animFlags(false, gpu.POSE.sit)).toBe(2);
    expect(gpu.animFlags(false, gpu.POSE.ride)).toBe(4);
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'crowd-gpu.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toContain('float crowdKind = floor(crowdFlags / 2.0);');
    expect(src).toContain('mat4 crowdSkin = crowdHanging ? crowdPose(crowdHangRow) : crowdChute ? crowdPose(crowdChuteRow)');
    expect(src).toContain('arr[at + 7] = animFlags(a.ghost, poseOf(a), a.lift);');
  });
});

describe('the rope', () => {
  it('is hooked to the back, between the shoulder blades, whichever way they face', () => {
    for (const facing of [0, 1.2, -2.5]) {
      const [hx, hy, hz] = hookOf(3, 4, 5, facing);
      const ahead = [Math.sin(facing), Math.cos(facing)];
      // Behind the middle: against the way they face.
      expect((hx - 3) * ahead[0]! + (hz - 5) * ahead[1]!, `in front of them facing ${facing}`).toBeLessThan(-0.01);
      expect(hy).toBeGreaterThan(4.15);
    }
  });
});
