/**
 * The body on the emergency pickup: the poses (crowd-gpu.ts hangPose, joltPose,
 * chutePose, flarePose), the swing that picks among them (flight.ts), and the gear hung
 * on the body (rig-mesh.ts).
 *
 * WHAT WAS WRONG. The founder, 2026-10-03, of the first poses: "the animation still looks
 * bad. please research how to implement it right". They were loops played on a clock --
 * arms flapping and legs kicking under the balloon whatever the balloon did, a sway under
 * the parachute -- each pose cut straight into the next, and the rope drawn to a point
 * worked out apart from the body. (Since 2026-10-04 a plane's cable carries you, not a
 * balloon's rope: tests/pickup-plane.test.ts.)
 *
 * HOW GAMES DO IT, and what is guarded here, on the real model and the real bake:
 *   - THE BODY IS A PENDULUM ON ITS ANCHOR. Hanging is baked at every lean, turned about
 *     the hook between the shoulder blades, which stays put; the parachute at every lean,
 *     turned about the hands on the risers, which stay put -- so the cable and the lines
 *     always end on the body, however it swings;
 *   - THE LEGS LAG THE SWING, hanging nearer the vertical than the body, and stay
 *     straight (the first render of the swings folded every swung shin back at the knee);
 *   - hanging: arms out to the sides a little below level, feet well below the hips; the
 *     jolt: arms flung up, knees bent; the parachute: feet together; the flare: hands
 *     down at the chest, knees bent, feet forward;
 *   - A FLIGHT SWINGS LIKE A PENDULUM: trailing further as the plane speeds up on a long
 *     hop, swinging further ahead as it slows, thrown by the canopy's opening, dying away
 *     to land level; a short hop hardly swings while carried; the same on every phone;
 *   - THE FRAMES FOLLOW THE FLIGHT AND BLEND, never a cut: every joint moves smoothly
 *     through whole flights, 5 ms at a time; and the shader blends the two rows it is given;
 *   - the cable runs from the plane to the hook, the canopy's lines down to the hands.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - legsStanding taken after the lean, as the first swings did -> "the legs stay
 *     straight" fails;
 *   - leanAbout turning about the hips instead of the anchor -> "the hook stays put" and
 *     "the hands stay on the risers" fail;
 *   - RISER back at 2.0 -> "the hands stay on the risers" fails;
 *   - rigRows showing `to` from half way instead of blending -> "never a cut" fails;
 *   - swingOf without the plane's push -> "trails further as the plane speeds up" fails;
 *   - the cable drawn to the body's origin -> "the cable runs from the plane to the hook" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type * as Gpu from '../src/features/world/crowd-gpu';
import {
  BODY_K, CABLE, CANOPY_ABOVE, CHUTE_MS, HOOK, LEAN_MAX, RISER, SETTLE_MS, T_CARRY, T_HOOK,
  carryMs, flightAt, flightMs, type Flight, type FlightPose,
} from '../src/features/world/flight';
import { buildRigs } from '../src/features/world/rig-mesh';

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

/** A bone's skinning matrix in a row of the bake. */
const skinOf = (bone: string, row: number) =>
  new THREE.Matrix4().fromArray(bake.data, (row * bake.width + names.indexOf(bone) * 4) * 4);
/** Where `point`'s joint, as it stands bound, is carried by `by` in a row of the bake. */
const carried = (point: string, by: string, row: number) => {
  const bind = new THREE.Vector3().setFromMatrixPosition(inverses[names.indexOf(point)]!.clone().invert());
  return gpu.skinFromBake(bake, row, [names.indexOf(by), 0, 0, 0], [1, 0, 0, 0], bind);
};
/** Where a bone's joint is in a row of the bake. */
const joint = (bone: string, row: number) => carried(bone, bone, row);
/**
 * The bottom of the shin as the shin draws it: the ankle carried by the shin's bone. The
 * feet hang off the root in this rig, so the foot can be put at the ankle while the shin
 * points somewhere else -- the fold of the first swings, which the joints alone never showed.
 */
const shinEnd = (s: 'L' | 'R', row: number) => carried(`Foot${s}`, `LowerLeg${s}`, row);
/** How straight a leg is, as drawn: hip to the shin's end over thigh plus shin (1 is dead straight). */
const straight = (s: 'L' | 'R', row: number) => {
  const hip = joint(`UpperLeg${s}`, row), knee = joint(`LowerLeg${s}`, row), end = shinEnd(s, row);
  return hip.distanceTo(end) / (hip.distanceTo(knee) + knee.distanceTo(end));
};
/** The anchors in the model's own units, as the bake turns about them. */
const PIVOT_HOOK = new THREE.Vector3(0, HOOK.y / BODY_K, HOOK.z / BODY_K);
const PIVOT_RISER = new THREE.Vector3(0, RISER.y / BODY_K, RISER.z / BODY_K);
const frames = (b: { row: number; frames: number }) => Array.from({ length: b.frames }, (_, f) => ({ row: b.row + f, lean: gpu.leanOfFrame(f, b.frames) }));
const SIDES = ['L', 'R'] as const;

describe('the bake', () => {
  it('has the pickup\'s frames after the bicycle\'s: hanging at each lean, the jolt, the parachute at each lean, the flare', () => {
    expect(bake.hang).toEqual({ row: bake.ride.row + bake.ride.frames, frames: gpu.HANG_LEANS });
    expect(bake.jolt).toEqual({ row: bake.hang.row + bake.hang.frames, frames: 1 });
    expect(bake.chute).toEqual({ row: bake.jolt.row + 1, frames: gpu.CHUTE_LEANS });
    expect(bake.flare).toEqual({ row: bake.chute.row + bake.chute.frames, frames: 1 });
    expect(bake.rows).toBe(bake.flare.row + 1);
    // Odd counts, so upright is a frame of its own; the ends are as far as a flight swings.
    expect(gpu.leanOfFrame(0, gpu.HANG_LEANS)).toBeCloseTo(-LEAN_MAX, 9);
    expect(gpu.leanOfFrame((gpu.HANG_LEANS - 1) / 2, gpu.HANG_LEANS)).toBeCloseTo(0, 9);
    expect(gpu.leanOfFrame(gpu.CHUTE_LEANS - 1, gpu.CHUTE_LEANS)).toBeCloseTo(LEAN_MAX, 9);
  });
});

describe('hanging from the hook', () => {
  it('the body swings about the hook between the shoulder blades, which stays put', () => {
    // A point on the chest, at the hook in the upright frame, carried through every lean.
    const upright = bake.hang.row + (bake.hang.frames - 1) / 2;
    const onChest = PIVOT_HOOK.clone().applyMatrix4(skinOf('Chest', upright).invert());
    for (const { row, lean } of frames(bake.hang)) {
      const hook = onChest.clone().applyMatrix4(skinOf('Chest', row));
      expect(hook.distanceTo(PIVOT_HOOK), `the hook moved at lean ${lean.toFixed(2)}`).toBeLessThan(0.005);
    }
    // And it does swing: the head forward, the hips back, by the lean.
    const fore = joint('Head', bake.hang.row + bake.hang.frames - 1), aft = joint('Head', bake.hang.row);
    expect(fore.z - aft.z, 'the body does not swing').toBeGreaterThan(0.2);
    expect(joint('Hips', bake.hang.row + bake.hang.frames - 1).z).toBeLessThan(joint('Hips', bake.hang.row).z - 0.3);
  });

  it('the legs lag the swing, nearer the vertical than the body, and the feet trail', () => {
    const upright = bake.hang.row + (bake.hang.frames - 1) / 2;
    const spine = (row: number) => joint('Neck', row).sub(joint('Hips', row));
    const tilt = (v: THREE.Vector3) => Math.atan2(v.z, v.y);
    for (const { row, lean } of frames(bake.hang)) {
      // The body turns by the whole lean...
      expect(tilt(spine(row)) - tilt(spine(upright)), `the body at lean ${lean.toFixed(2)}`).toBeCloseTo(lean, 1);
      if (Math.abs(lean) < 0.3) continue;
      for (const s of SIDES) {
        // ...the legs by less: hip to ankle, + with the feet behind.
        const hip = joint(`UpperLeg${s}`, row), ankle = joint(`Foot${s}`, row);
        const legs = Math.atan2(hip.z - ankle.z, hip.y - ankle.y);
        expect(Math.sign(legs), `the ${s} foot does not trail at lean ${lean.toFixed(2)}`).toBe(Math.sign(lean));
        expect(Math.abs(legs), `the ${s} leg is stiff with the body at lean ${lean.toFixed(2)}`).toBeLessThan(0.75 * Math.abs(lean));
        expect(Math.abs(legs), `the ${s} leg hangs plumb at lean ${lean.toFixed(2)}`).toBeGreaterThan(0.25 * Math.abs(lean));
      }
    }
  });

  it('the arms are out to the sides a little below level; the feet well below the hips and a little apart', () => {
    for (const { row, lean } of frames(bake.hang)) {
      for (const s of SIDES) {
        const wrist = joint(`Wrist${s}`, row), shoulder = joint(`UpperArm${s}`, row);
        expect(Math.abs(wrist.x), `the ${s} arm is not out at lean ${lean.toFixed(2)}`).toBeGreaterThan(Math.abs(shoulder.x) + 0.3);
        expect(wrist.y, `the ${s} arm is up at lean ${lean.toFixed(2)}`).toBeLessThan(shoulder.y - 0.03);
        expect(wrist.y, `the ${s} arm hangs down at lean ${lean.toFixed(2)}`).toBeGreaterThan(shoulder.y - 0.25);
        expect(joint(`Foot${s}`, row).y).toBeLessThan(joint(`UpperLeg${s}`, row).y - 0.6);
      }
      const apart = joint('FootL', row).x - joint('FootR', row).x;
      expect(apart).toBeGreaterThan(0.2);
      expect(apart).toBeLessThan(0.6);
    }
  });
});

describe('the legs stay straight, at every lean', () => {
  it('hanging and under the parachute: hip to ankle all but the length of the leg', () => {
    for (const b of [bake.hang, bake.chute]) {
      for (const { row, lean } of frames(b)) {
        for (const s of SIDES) {
          expect(straight(s, row), `the ${s} knee folds at lean ${lean.toFixed(2)} (${b === bake.hang ? 'hanging' : 'parachute'})`).toBeGreaterThan(0.95);
        }
      }
    }
  });

  it('every shin ends where its foot is drawn, in every pose of the pickup', () => {
    for (const b of [bake.hang, bake.jolt, bake.chute, bake.flare]) {
      for (const { row, lean } of frames(b)) {
        for (const s of SIDES) {
          expect(shinEnd(s, row).distanceTo(joint(`Foot${s}`, row)), `the ${s} shin misses its foot at row ${row}, lean ${lean.toFixed(2)}`).toBeLessThan(0.01);
        }
      }
    }
  });
});

describe('the jolt and the flare', () => {
  it('the jolt: snatched up, the arms flung up and the knees bent, feet behind', () => {
    const row = bake.jolt.row;
    for (const s of SIDES) {
      expect(joint(`Wrist${s}`, row).y).toBeGreaterThan(joint(`UpperArm${s}`, row).y + 0.2);
      expect(straight(s, row)).toBeLessThan(0.85);
      expect(joint(`Foot${s}`, row).z).toBeLessThan(joint(`UpperLeg${s}`, row).z - 0.2);
    }
  });

  it('the flare: hands down in front of the chest, knees bent, feet forward and ready', () => {
    const row = bake.flare.row;
    for (const s of SIDES) {
      const wrist = joint(`Wrist${s}`, row);
      expect(wrist.y).toBeLessThan(joint(`UpperArm${s}`, row).y - 0.1);
      expect(wrist.z).toBeGreaterThan(joint('Chest', row).z + 0.15);
      expect(straight(s, row)).toBeLessThan(0.92);
      expect(joint(`Foot${s}`, row).z).toBeGreaterThan(joint(`UpperLeg${s}`, row).z + 0.1);
    }
  });
});

describe('under the parachute', () => {
  it('the hands stay on the risers, above the shoulders, at every lean -- where the lines come down', () => {
    for (const { row, lean } of frames(bake.chute)) {
      for (const s of SIDES) {
        const x = s === 'L' ? 1 : -1;
        const wrist = joint(`Wrist${s}`, row);
        expect(wrist.distanceTo(PIVOT_RISER.clone().setX(x * 0.11)), `the ${s} hand is off the riser at lean ${lean.toFixed(2)}`).toBeLessThan(0.02);
      }
    }
    const upright = bake.chute.row + (bake.chute.frames - 1) / 2;
    for (const s of SIDES) expect(joint(`Wrist${s}`, upright).y).toBeGreaterThan(joint(`UpperArm${s}`, upright).y + 0.3);
    // And the body swings under them.
    expect(joint('Hips', bake.chute.row).z - joint('Hips', bake.chute.row + bake.chute.frames - 1).z).toBeGreaterThan(0.8);
  });

  it('feet together, no further apart than the hips', () => {
    for (const { row } of frames(bake.chute)) {
      expect(joint('FootL', row).x - joint('FootR', row).x).toBeLessThan(joint('UpperLegL', row).x - joint('UpperLegR', row).x);
    }
  });
});

describe('a flight swings like a pendulum', () => {
  const along = (d: number): Flight => ({ fx: 0, fz: 0, tx: d, tz: 0 });
  const carry = (f: Flight) => [T_CARRY, T_CARRY + carryMs(f)] as const;
  const leans = (f: Flight, from: number, to: number) => {
    const out: number[] = [];
    for (let ms = from; ms <= to; ms += 5) out.push(flightAt(f, ms).lean);
    return out;
  };

  it('trails further as the plane speeds up on a long hop, and swings further ahead as it slows', () => {
    // Every carry starts trailing a little and swings on its own; what the plane's speeding
    // up and slowing down add is the difference from a hop it hardly speeds up for.
    const swing = (d: number) => {
      const f = along(d);
      const [a, b] = carry(f);
      return { back: Math.max(...leans(f, a, (a + b) / 2)), ahead: Math.min(...leans(f, (a + b) / 2, b)) };
    };
    const calm = swing(13);
    for (const d of [30, 80]) {
      expect(swing(d).back, `${d} units: no more trailing than a short hop`).toBeGreaterThan(calm.back + 0.1);
      expect(swing(d).ahead, `${d} units: no more swing ahead than a short hop`).toBeLessThan(calm.ahead - 0.1);
    }
  });

  it('a short hop hardly swings while carried', () => {
    const f = along(2);
    const [a, b] = carry(f);
    expect(Math.max(...leans(f, a, b).map(Math.abs))).toBeLessThan(0.05);
  });

  it('the canopy\'s opening throws the feet forward, the swing dies away, and they land level', () => {
    // A hop short enough to arrive hanging still: whatever swing there is, the opening made.
    for (const d of [2, 4]) {
      const f = along(d);
      const open = carry(f)[1];
      expect(Math.abs(flightAt(f, open).lean)).toBeLessThan(0.05);
      expect(Math.min(...leans(f, open, open + 400)), `${d} units: no swing as it opens`).toBeLessThan(-0.15);
    }
    for (const d of [2, 13, 30, 80]) {
      const f = along(d);
      const open = carry(f)[1];
      const down = flightMs(f) - SETTLE_MS;
      const early = Math.max(...leans(f, open, open + 600).map(Math.abs));
      const late = Math.max(...leans(f, down - 400, down).map(Math.abs));
      expect(late, `${d} units: the swing does not die away`).toBeLessThan(early / 2);
      expect(Math.abs(flightAt(f, down).lean), `${d} units: lands swinging`).toBeLessThan(0.01);
      expect(flightAt(f, down + SETTLE_MS / 2).lean).toBe(0);
    }
  });

  it('smoothly, inside the baked frames, and the same on every phone', () => {
    for (const d of [2, 13, 30, 80]) {
      const all = leans(along(d), 0, flightMs(along(d)));
      for (let i = 1; i < all.length; i++) {
        expect(Math.abs(all[i]! - all[i - 1]!), `${d} units: a jump at ${i * 5} ms`).toBeLessThan(0.03);
      }
      expect(Math.max(...all.map(Math.abs))).toBeLessThanOrEqual(LEAN_MAX);
      // Worked out afresh for another phone's copy of the same flight: the same swing.
      expect(leans(along(d), 0, flightMs(along(d)))).toEqual(all);
    }
  });
});

describe('where the anchors are', () => {
  const hop: Flight = { fx: 0, fz: 0, tx: 12, tz: 5 };
  const off = (p: FlightPose) => [p.anchor.x - p.x, p.anchor.y - p.y, p.anchor.z - p.z];
  const turned = (a: { y: number; z: number }, h: number) => [Math.sin(h) * a.z, a.y, Math.cos(h) * a.z];

  it('the hook behind the back while hanging, the hands in front under the canopy, as the body faces', () => {
    for (let ms = 10; ms < flightMs(hop) - SETTLE_MS; ms += 20) {
      const p = flightAt(hop, ms);
      const want = turned(p.phase === 'chute' ? RISER : HOOK, p.heading);
      off(p).forEach((v, i) => expect(v, `${p.phase} at ${ms} ms`).toBeCloseTo(want[i]!, 9));
    }
    expect(HOOK.z).toBeLessThan(0);
    expect(RISER.z).toBeGreaterThan(0);
  });

  it('carried, the hook hangs a cable\'s length below the plane, along the swing', () => {
    const [a, b] = [T_CARRY, T_CARRY + carryMs(hop)];
    for (let ms = a; ms < b; ms += 20) {
      const p = flightAt(hop, ms);
      const r = new THREE.Vector3(p.plane!.x - p.anchor.x, p.plane!.y - p.anchor.y, p.plane!.z - p.anchor.z);
      expect(r.length()).toBeCloseTo(CABLE, 9);
      expect(r.x * Math.sin(p.heading) + r.z * Math.cos(p.heading)).toBeCloseTo(Math.sin(p.lean) * CABLE, 9);
      expect(p.cable).toMatchObject({ x: p.anchor.x, y: p.anchor.y, z: p.anchor.z });
    }
  });

  it('coming and going, the anchor turns with the way they face', () => {
    for (const facing of [0, 1.2, -2.5]) {
      const drop = flightAt({ fx: 3, fz: 4, tx: 3, tz: 4, kind: 'drop', facing }, 300);
      expect(drop.heading).toBe(facing);
      off(drop).forEach((v, i) => expect(v).toBeCloseTo(turned(RISER, facing)[i]!, 9));
      const away = flightAt({ fx: 3, fz: 4, tx: 3, tz: 4, kind: 'away', facing }, 900);
      expect(away.heading).toBe(facing);
      off(away).forEach((v, i) => expect(v).toBeCloseTo(turned(HOOK, facing)[i]!, 9));
    }
  });
});

describe('the frames follow the flight', () => {
  const hop: Flight = { fx: 0, fz: 0, tx: 12, tz: 5 };
  const poseAt = (ms: number) => gpu.poseOf({ state: 'idle', rig: flightAt(hop, ms) });

  it('standing as the plane comes and its cable drops, the pickup\'s frames from the jolt to the last of the flare, standing once down', () => {
    expect(poseAt(100)).toBe(gpu.POSE.stand);
    expect(poseAt(T_HOOK - 30)).toBe(gpu.POSE.stand);
    expect(poseAt(T_HOOK + 30)).toBe(gpu.POSE.rig);
    expect(poseAt(T_CARRY + 100)).toBe(gpu.POSE.rig);
    expect(poseAt(flightMs(hop) - SETTLE_MS - CHUTE_MS / 2)).toBe(gpu.POSE.rig);
    expect(poseAt(flightMs(hop) - SETTLE_MS / 2)).toBe(gpu.POSE.rig);
    expect(poseAt(flightMs(hop) + 10)).toBe(gpu.POSE.stand);
    expect(gpu.poseOf({ state: 'sitting' })).toBe(gpu.POSE.sit);
    expect(gpu.poseOf({ state: 'walking', riding: true })).toBe(gpu.POSE.ride);
  });

  it('picks the swing\'s frames by the lean, the two nearest blended, and crossfades one act into the next', () => {
    const up = bake.hang.row + (bake.hang.frames - 1) / 2;
    const step = (2 * LEAN_MAX) / (bake.hang.frames - 1);
    const hang = { from: 'hang', to: 'hang', w: 1 } as const;
    expect(gpu.rigRows({ act: hang, lean: 0 }, bake)).toEqual({ a: up, b: up, w: 0 });
    const half = gpu.rigRows({ act: hang, lean: step / 2 }, bake);
    expect([half.a, half.b]).toEqual([up, up + 1]);
    expect(half.w).toBeCloseTo(0.5, 6);
    expect(gpu.rigRows({ act: hang, lean: 9 }, bake)).toEqual({ a: bake.hang.row + bake.hang.frames - 1, b: bake.hang.row + bake.hang.frames - 1, w: 0 });
    expect(gpu.rigRows({ act: hang, lean: -9 }, bake)).toEqual({ a: bake.hang.row, b: bake.hang.row, w: 0 });
    expect(gpu.rigRows({ act: { from: 'stand', to: 'jolt', w: 0.3 }, lean: 0 }, bake)).toEqual({ a: bake.idle.row, b: bake.jolt.row, w: 0.3 });
    expect(gpu.rigRows({ act: { from: 'chute', to: 'flare', w: 0.6 }, lean: 0 }, bake))
      .toEqual({ a: bake.chute.row + (bake.chute.frames - 1) / 2, b: bake.flare.row, w: 0.6 });
  });

  it('never a cut: every joint moves smoothly through whole flights, 5 ms at a time', () => {
    const watched = ['Head', 'WristL', 'WristR', 'FootL', 'FootR', 'Hips'];
    const at = (rig: FlightPose) => {
      const r = gpu.poseOf({ state: 'idle', rig }) === gpu.POSE.rig ? gpu.rigRows(rig, bake) : { a: bake.idle.row, b: bake.idle.row, w: 0 };
      return watched.map((b) => joint(b, r.a).multiplyScalar(1 - r.w).add(joint(b, r.b).multiplyScalar(r.w)));
    };
    for (const f of [{ fx: 0, fz: 0, tx: 2, tz: 0 }, hop, { fx: 0, fz: 0, tx: 30, tz: 0 }, { fx: 0, fz: 0, tx: 3, tz: 3, kind: 'drop' as const },
      { fx: 0, fz: 0, tx: 0, tz: 0, kind: 'away' as const }]) {
      let was = at(flightAt(f, 0));
      let worst = 0, when = 0;
      for (let ms = 5; ms <= flightMs(f) + 20; ms += 5) {
        const now = at(flightAt(f, ms));
        const moved = Math.max(...now.map((p, i) => p.distanceTo(was[i]!)));
        if (moved > worst) { worst = moved; when = ms; }
        was = now;
      }
      // The quickest move is the jolt -- the arms flung up in 140 ms -- about 0.08 of the
      // model's units in 5 ms; a cut from one pose to the next is the whole of it, 0.7.
      expect(worst, `${f.kind ?? 'pickup'} of ${Math.hypot(f.tx - f.fx, f.tz - f.fz).toFixed(0)} units: a cut at ${when} ms`).toBeLessThan(0.15);
    }
  });

  it('the shader blends the two rows it is given, and the crowd hands it rigRows (SOURCE SHAPE: it needs GL)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'crowd-gpu.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toContain('bool crowdFlying = abs(crowdKind - 3.0) < 0.5;');
    expect(src).toContain('mat4 crowdSkin = crowdFlying ? crowdPose(int(aAnim.x + 0.5)) * (1.0 - aAnim.z) + crowdPose(int(aAnim.y + 0.5)) * aAnim.z');
    expect(src).toContain('const rows = rigRows(a.rig, bake);');
    expect(src).toContain('arr[at + 4] = rows.a; arr[at + 5] = rows.b; arr[at + 6] = rows.w;');
    expect(gpu.animFlags(false, gpu.POSE.rig)).toBe(6);
  });
});

describe('the gear hangs on the body', () => {
  const hop: Flight = { fx: 0, fz: 0, tx: 12, tz: 5 };
  const draw = (rig: FlightPose) => {
    const rigs = buildRigs('#d94a3a');
    rigs.update([{ x: rig.x, z: rig.z, facing: rig.heading, lift: rig.y, rig }], 1);
    // Built in this order, a rig at a time.
    const [plane, cable, weight, chute, lines] = rigs.group.children as [THREE.Group, THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.LineSegments];
    return { plane, cable, weight, chute, lines };
  };
  /** The middle of the cable's ribbon at point `i` of its length (the ribbon is two corners a point). */
  const along = (cable: THREE.Mesh, i: number) => {
    const pos = cable.geometry.getAttribute('position');
    const k = i < 0 ? pos.count / 2 + i : i;
    return new THREE.Vector3().fromBufferAttribute(pos, k * 2).add(new THREE.Vector3().fromBufferAttribute(pos, k * 2 + 1)).multiplyScalar(0.5);
  };

  it('the cable runs from the plane to the hook on the back', () => {
    // Far enough to swing well out under the plane, and not along an axis.
    const far: Flight = { fx: 0, fz: 0, tx: 24, tz: -18 };
    const p = flightAt(far, T_CARRY + carryMs(far) * 0.45);
    expect(Math.abs(p.lean)).toBeGreaterThan(0.15);
    const { plane, cable, weight, chute } = draw(p);
    expect(plane.visible && cable.visible).toBe(true);
    expect(weight.visible, 'a weight on the end of a cable that has you').toBe(false);
    expect(chute.visible).toBe(false);
    expect(along(cable, 0).distanceTo(new THREE.Vector3(p.plane!.x, p.plane!.y, p.plane!.z))).toBeLessThan(1e-6);
    expect(along(cable, -1).distanceTo(new THREE.Vector3(p.anchor.x, p.anchor.y, p.anchor.z))).toBeLessThan(1e-6);
  });

  it('the canopy rides over the hands, its lines down to them', () => {
    const p = flightAt(hop, flightMs(hop) - SETTLE_MS - CHUTE_MS / 2);
    const { cable, chute, lines } = draw(p);
    expect(cable.visible).toBe(false);
    expect(chute.visible).toBe(true);
    expect(chute.position.x).toBeCloseTo(p.anchor.x, 9);
    expect(chute.position.z).toBeCloseTo(p.anchor.z, 9);
    expect(chute.position.y).toBeGreaterThan(p.anchor.y + CANOPY_ABOVE / 2);
    const pos = lines.geometry.getAttribute('position');
    for (let k = 1; k < pos.count; k += 2) {
      const hand = new THREE.Vector3().fromBufferAttribute(pos, k);
      expect(hand.y).toBeCloseTo(p.anchor.y, 5);
      expect(Math.hypot(hand.x - p.anchor.x, hand.z - p.anchor.z)).toBeLessThan(0.11 * BODY_K + 1e-5);
    }
  });
});
