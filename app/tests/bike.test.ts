/**
 * A rider on a bicycle: sat on its saddle, hands on its grips, feet going round on its
 * pedals -- the pose (crowd-gpu.ts ridePose) held to the bike's own points (bike.ts), on
 * the real rig, through the baked animation the phone draws.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "get bicycles that the couples can ride on ...
 * bicycles should also be used for travel around the park".
 *
 * WHAT IS PINNED, for every frame of a turn of the cranks:
 *   - each ankle over its pedal, within 2 cm, and the soles with it (the rig's feet hang
 *     off the root, so a foot not moved stays on the ground where the standing foot was);
 *   - the seat of the trousers on the saddle: not sunk into it, not floating over it;
 *   - each wrist where a hand on its grip puts it;
 *   - the hips square to the front;
 * and the frames differ -- the cranks turn -- while the first is the still one.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - ridePose without moving the feet to the ankles -> "ankles over the pedals" fails
 *   - without lifting the body onto the saddle       -> "on the saddle" fails
 *   - without the hands' reach                       -> "on the grips" fails
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ANKLE_ABOVE_PEDAL, BIKE, RIDE_FRAMES, WRIST_ON_GRIP, ankleOn } from '../src/features/world/bike';
import type * as Gpu from '../src/features/world/crowd-gpu';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

let gpu: typeof Gpu;
let bake: Gpu.Bake;
let names: string[];
let inverses: THREE.Matrix4[];
let meshes: THREE.SkinnedMesh[];

beforeAll(async () => {
  gpu = await import('../src/features/world/crowd-gpu');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(join(import.meta.dirname, '..', 'assets', 'characters', 'people.glb'));
  const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
  meshes = [];
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
const rows = () => Array.from({ length: bake.ride.frames }, (_, f) => ({ f, row: bake.ride.row + f, phase: f / RIDE_FRAMES }));

/** A mesh's vertices in a row, with the bone each follows most. */
function skinnedPoints(name: string, row: number): { p: THREE.Vector3; bone: string }[] {
  const m = meshes.find((x) => x.name === name)!;
  const pos = m.geometry.attributes.position!, si = m.geometry.attributes.skinIndex!, sw = m.geometry.attributes.skinWeight!;
  return Array.from({ length: pos.count }, (_, v) => {
    const ix = [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)], w = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)];
    return {
      p: gpu.skinFromBake(bake, row, ix, w, new THREE.Vector3().fromBufferAttribute(pos as THREE.BufferAttribute, v)),
      bone: names[ix[w.indexOf(Math.max(...w))]!]!,
    };
  });
}

describe('a rider on a bicycle', () => {
  it('has a turn of the cranks baked, the first frame the still one', () => {
    expect(bake.ride.frames).toBe(RIDE_FRAMES);
    expect(bake.rows).toBe(bake.walk.frames + bake.idle.frames + bake.sit.frames + bake.ride.frames + bake.hang.frames + bake.chute.frames);
    const a = joint('FootL', bake.ride.row), b = joint('FootL', bake.ride.row + RIDE_FRAMES / 2);
    expect(a.distanceTo(b), 'the cranks do not turn').toBeGreaterThan(BIKE.crank);
  });

  it('keeps each ankle over its pedal, all the way round, and the soles with it', () => {
    for (const { row, phase } of rows()) {
      for (const s of ['L', 'R'] as const) {
        const want = new THREE.Vector3(...ankleOn(s, phase));
        expect(joint(`Foot${s}`, row).distanceTo(want), `the ${s} ankle is off its pedal at ${phase}`).toBeLessThan(0.02);
      }
      // The shoes' soles, not only the joint: the lowest of the shoes is on the lower pedal.
      const soles = skinnedPoints('m_casual_2_b1', row).map((q) => q.p);
      const low = Math.min(...soles.map((q) => q.y));
      const pedal = Math.min(...(['L', 'R'] as const).map((s) => ankleOn(s, phase)[1])) - ANKLE_ABOVE_PEDAL[1];
      expect(Math.abs(low - pedal), `the soles are not on the pedals at ${phase}`).toBeLessThan(0.05);
    }
  });

  it('sits on the saddle: not in it, not above it', () => {
    for (const { row, phase } of rows().filter((r) => r.f % 9 === 0)) {
      const seat = ['m_casual_2_b3', 'm_casual_2_b4', 'm_casual_2_b5'].flatMap((n) => skinnedPoints(n, row))
        .filter((q) => (q.bone === 'Hips' || q.bone === 'Body') && Math.abs(q.p.x) < 0.1)
        .map((q) => q.p.y);
      const bottom = Math.min(...seat);
      expect(bottom - BIKE.saddle[1], `the seat is ${(bottom - BIKE.saddle[1]).toFixed(3)} off the saddle at ${phase}`).toBeGreaterThan(-0.03);
      expect(bottom - BIKE.saddle[1], `floating over the saddle at ${phase}`).toBeLessThan(0.05);
    }
  });

  it('holds the grips, with its hips square to the front', () => {
    for (const { row } of rows().filter((r) => r.f % 6 === 0)) {
      for (const s of ['L', 'R'] as const) {
        const x = s === 'L' ? 1 : -1;
        const want = new THREE.Vector3(BIKE.grip[0] * x + WRIST_ON_GRIP[0], BIKE.grip[1] + WRIST_ON_GRIP[1], BIKE.grip[2] + WRIST_ON_GRIP[2]);
        expect(joint(`Wrist${s}`, row).distanceTo(want), `the ${s} hand is off its grip`).toBeLessThan(0.02);
      }
      expect(Math.abs(joint('UpperLegL', row).z - joint('UpperLegR', row).z), 'the hips are turned').toBeLessThan(0.02);
    }
  });
});
