/**
 * The plane that comes for you (flight.ts, plane-mesh.ts, rig-mesh.ts, canvas.tsx).
 *
 * WHAT THE FOUNDER ASKED (2026-10-04): "Use a fine rope, not the thick one that you have
 * now. Before the rope gets attached show a good aeroplane on the sky dropping the cable
 * then attaching to the user and dropping it to the partner's location. Only drop to the
 * partner if the partner is far away ... or else the user can walk to the partner's
 * location."
 *
 * WHAT WAS THERE: a balloon rising out of a pack on your back on a rope drawn as a solid
 * six centimetres round, no plane at all; a pickup for anybody eight metres off or more,
 * a stroll for anybody nearer; and the walking camera, which sits behind your head
 * looking down the path -- nothing forty metres up is ever in its picture.
 *
 * WHAT IS GUARDED:
 *   - A PLANE COMES FIRST: in from behind you, up in the sky, slowing, never jumping;
 *     you stand until its cable has you;
 *   - ITS CABLE DROPS TO YOUR BACK: falling from the plane, a weight on its end, down to
 *     the hook between your shoulder blades -- and only then are you on it;
 *   - A FINE CABLE: CABLE_DP wide on the screen however near or far, not a rope that is
 *     thick up close;
 *   - THE CAMERA SHOWS IT IN SHOTS, CUT, NOT PANNED (the founder, the same day: "you
 *     don't have to pan the camera from the user to the aeroplane. It will be better to
 *     show the animation of the plane dropping the cable, then show it being attached to
 *     the user and the user being dropped"): a still shot of the plane coming in and its
 *     cable falling; cut to you, and the plane and you in one picture -- you above the
 *     park's cards and buttons, the plane below the top -- from the moment the cable has
 *     you until you let go; then eased back to the walking camera as you come down;
 *   - NOT FOR A FEW STEPS: nearer than FLY_MIN you go on foot, at a run if need be, and
 *     are there no later than the plane would have you there; a short hop's plane never
 *     carries you past them;
 *   - the plane drawn is the size it says, its cable coming out of its belly.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the cable's corners a fixed width apart -> "CABLE_DP wide however far" fails;
 *   - flightShot's weight held at 0 (the walking camera only) -> "the plane and you in one
 *     picture" fails;
 *   - the first shot's camera turned after the plane (a pan) -> "holds still" fails;
 *   - the cable's end at the hook from the start of its fall -> "falls from the plane" fails;
 *   - walkTo back at a brisk walk -> "never slower than the plane would be" fails;
 *   - passOf without the short hop's nearer, slower pass -> "never carries you past" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  AWAY_MS, CABLE_MS, FLY_MIN, PASS_Y, SHOT_CUT_MS, T_CABLE, T_CARRY, T_HOOK,
  carryMs, flightAt, flightMs, flightShot, planeAt, type Flight, type FlightPose,
} from '../src/features/world/flight';
import { PLANE_LENGTH, PLANE_SPAN, planeGeometry } from '../src/features/world/plane-mesh';
import { CABLE_DP, buildRigs, cableRibbon } from '../src/features/world/rig-mesh';
import { WALK_AIM, WALK_BACK, WALK_EYE, WALK_FOV, WALK_RISE, followPose } from '../src/features/world/camera';
import { BENCH_SECS, WorldSim } from '../src/features/world/sim';

const hop: Flight = { fx: 2, fz: -1, tx: 20, tz: 11 };
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/** How far along the way a point is, from where they stood. */
const alongOf = (f: Flight, x: number, z: number) => {
  const d = Math.hypot(f.tx - f.fx, f.tz - f.fz);
  return ((x - f.fx) * (f.tx - f.fx) + (z - f.fz) * (f.tz - f.fz)) / d;
};
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('a plane comes first', () => {
  it('in from behind you, up in the sky, slowing as it comes -- and you stand until its cable has you', () => {
    const start = planeAt(hop, 0);
    expect(alongOf(hop, start.x, start.z), 'not from behind you').toBeLessThan(-3);
    let was = -Infinity, speedWas = Infinity;
    // From the moment it has faded in out of the distance.
    for (let ms = 150; ms < T_HOOK; ms += 50) {
      const p = flightAt(hop, ms);
      expect(p.plane, `no plane at ${ms} ms`).not.toBeNull();
      expect(p.plane!.y).toBeGreaterThanOrEqual(PASS_Y);
      expect(p.y, `off the ground at ${ms} ms`).toBe(0);
      expect(p.roped).toBe(false);
      const s = alongOf(hop, p.plane!.x, p.plane!.z);
      expect(s, 'the plane went backwards').toBeGreaterThan(was);
      if (ms > 0 && ms < T_CABLE) expect(s - was, 'not slowing as it comes').toBeLessThanOrEqual(speedWas + 1e-9);
      speedWas = s - was;
      was = s;
    }
  });

  it('never jumps: the plane and you go smoothly from each part of the flight into the next', () => {
    for (const f of [hop, { fx: 0, fz: 0, tx: FLY_MIN, tz: 0 }, { fx: 0, fz: 0, tx: 0, tz: 90 }]) {
      const release = T_CARRY + carryMs(f);
      for (const at of [T_CABLE, T_HOOK, T_CARRY, release]) {
        const a = flightAt(f, at - 0.05), b = flightAt(f, at + 0.05);
        expect(dist(a.plane!, b.plane!), `the plane jumped at ${at} ms`).toBeLessThan(0.02);
        expect(dist(a, b), `you jumped at ${at} ms`).toBeLessThan(0.02);
      }
    }
  });
});

describe('its cable drops to your back', () => {
  it('falls from the plane, a weight on its end, down to the hook between your shoulder blades', () => {
    const first = flightAt(hop, T_CABLE + 1);
    expect(dist(first.cable!, first.plane!), 'the cable starts at the hook, not falling from the plane').toBeLessThan(0.05);
    let was = Infinity;
    for (let ms = T_CABLE + 1; ms < T_HOOK; ms += 20) {
      const p = flightAt(hop, ms);
      expect(p.phase).toBe('cable');
      expect(p.cable!.y, `the cable's end rose at ${ms} ms`).toBeLessThan(was);
      expect(p.cable!.slack).toBe(1);
      expect(p.roped).toBe(false);
      was = p.cable!.y;
    }
    const caught = flightAt(hop, T_HOOK);
    expect(dist(caught.cable!, caught.anchor), 'the cable ends short of your back').toBeLessThan(1e-6);
    expect(caught.roped).toBe(true);
    expect(CABLE_MS).toBeGreaterThanOrEqual(400);
  });

  it('is drawn with a weight while it falls, and none once it has you', () => {
    const rigs = buildRigs('#6D5DFC');
    const shown = (p: FlightPose) => {
      rigs.update([{ x: p.x, z: p.z, facing: p.heading, lift: p.y, rig: p }], 1);
      const [plane, cable, weight] = rigs.group.children as THREE.Object3D[];
      return { plane: plane!.visible, cable: cable!.visible, weight: weight!.visible };
    };
    expect(shown(flightAt(hop, T_CABLE / 2))).toEqual({ plane: true, cable: false, weight: false });
    expect(shown(flightAt(hop, (T_CABLE + T_HOOK) / 2))).toEqual({ plane: true, cable: true, weight: true });
    expect(shown(flightAt(hop, T_CARRY + 50))).toEqual({ plane: true, cable: true, weight: false });
  });
});

describe('a fine cable', () => {
  it(`is ${CABLE_DP} points wide on the screen however near or far, not thick up close`, () => {
    const height = 840; // the Pixel's park, in points
    const camera = new THREE.PerspectiveCamera(WALK_FOV, 1080 / 2196, 0.08, 60);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateMatrixWorld();
    const view = { eye: [0, 0, 0] as const, unitsPerDp: (2 * Math.tan((WALK_FOV * Math.PI) / 360)) / height, time: 0 };
    for (const far of [1.5, 4, 12, 30]) {
      const pts: [number, number, number][] = [[-0.5, -0.4, -far], [0, 0, -far], [0.5, 0.4, -far]];
      const out = new Float32Array(pts.length * 6);
      cableRibbon(pts, out, view);
      const a = new THREE.Vector3(out[6], out[7], out[8]).project(camera);
      const b = new THREE.Vector3(out[9], out[10], out[11]).project(camera);
      const wide = Math.hypot((a.x - b.x) * camera.aspect, a.y - b.y) / 2 * height;
      expect(wide, `${far} units away`).toBeCloseTo(CABLE_DP, 1);
    }
    expect(CABLE_DP).toBeLessThanOrEqual(1.5);
  });
});

describe('the camera shows it', () => {
  const ASPECT = 1080 / 2196; // the Pixel's park, above the tab bar
  /** Where the canvas puts the camera: the walking one, eased into the pickup's shot. */
  const cameraAt = (f: Flight, ms: number) => {
    const p = flightAt(f, ms);
    const walk = followPose(p.x, p.z, p.heading, WALK_BACK, WALK_RISE + p.y, WALK_AIM, WALK_EYE + p.y);
    const shot = flightShot(f, ms);
    const w = shot?.w ?? 0;
    const mix = (a: readonly number[], b: readonly number[] | undefined) => a.map((v, i) => v + ((b?.[i] ?? v) - v) * w);
    const camera = new THREE.PerspectiveCamera(WALK_FOV, ASPECT, 0.08, 80);
    const [ex, ey, ez] = mix(walk.eye, shot?.eye), [lx, ly, lz] = mix(walk.look, shot?.look);
    camera.position.set(ex!, ey!, ez!);
    camera.lookAt(lx!, ly!, lz!);
    camera.updateMatrixWorld();
    return { camera, p, eye: new THREE.Vector3(ex, ey, ez), look: new THREE.Vector3(lx, ly, lz) };
  };
  /** Where on the picture a point is: 0,0 the top left, 1,1 the bottom right; null behind the lens. */
  const onScreen = (camera: THREE.PerspectiveCamera, x: number, y: number, z: number) => {
    const local = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    if (local.z > -0.1) return null;
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  };
  const middleOf = (p: FlightPose) => ({ x: p.anchor.x, y: p.anchor.y - 0.05, z: p.anchor.z });

  it('then the plane and you in one picture, from just before its cable has you until you let go', () => {
    for (const f of [hop, { fx: 0, fz: 0, tx: 0, tz: 60 }, { fx: 0, fz: 0, tx: -FLY_MIN - 1, tz: 0 }]) {
      for (let ms = SHOT_CUT_MS; ms < T_CARRY + carryMs(f); ms += 25) {
        const { camera, p } = cameraAt(f, ms);
        const you = onScreen(camera, middleOf(p).x, middleOf(p).y, middleOf(p).z);
        const plane = onScreen(camera, p.plane!.x, p.plane!.y + 0.1, p.plane!.z);
        expect(you, `you behind the camera at ${ms} ms`).not.toBeNull();
        expect(plane, `the plane behind the camera at ${ms} ms`).not.toBeNull();
        expect(you!.x, `you off the side at ${ms} ms`).toBeGreaterThan(0.05);
        expect(you!.x).toBeLessThan(0.95);
        expect(you!.y, `you under the park's cards and buttons at ${ms} ms`).toBeLessThan(0.71);
        expect(you!.y, `you off the top at ${ms} ms`).toBeGreaterThan(0.2);
        expect(plane!.y, `the plane off the top at ${ms} ms`).toBeGreaterThan(0.02);
        expect(plane!.y, `the plane below you at ${ms} ms`).toBeLessThan(you!.y);
        expect(plane!.x, `the plane off the side at ${ms} ms`).toBeGreaterThan(0);
        expect(plane!.x).toBeLessThan(1);
      }
    }
  });

  it('first, a shot of the plane: held still -- no pan -- the plane coming in it, and its cable falling', () => {
    for (const f of [hop, { fx: 0, fz: 0, tx: 0, tz: 60 }, { fx: 0, fz: 0, tx: FLY_MIN, tz: 0 }]) {
      const first = cameraAt(f, 0);
      let seen = 0, falling = 0;
      for (let ms = 0; ms < SHOT_CUT_MS; ms += 10) {
        const { camera, p, eye, look } = cameraAt(f, ms);
        expect(eye.distanceTo(first.eye), `the camera moved at ${ms} ms`).toBeLessThan(1e-9);
        expect(look.distanceTo(first.look), `the camera turned at ${ms} ms`).toBeLessThan(1e-9);
        if (!p.plane) continue;
        const at = onScreen(camera, p.plane.x, p.plane.y + 0.1, p.plane.z);
        const inside = !!at && at.x > 0 && at.x < 1 && at.y > 0.02 && at.y < 0.71;
        if (inside) seen += 10;
        if (inside && p.cable) falling += 10;
      }
      expect(seen, 'the plane hardly in its own shot').toBeGreaterThanOrEqual(500);
      expect(falling, 'its cable never seen falling from it').toBeGreaterThan(0);
    }
  });

  it('cut to you just before the cable has you; from there it follows you, never jumping; eased back to walking as you come down', () => {
    expect(SHOT_CUT_MS).toBeGreaterThan(T_CABLE);
    expect(SHOT_CUT_MS).toBeLessThan(T_HOOK);
    for (const f of [hop, { fx: 0, fz: 0, tx: 0, tz: 120 }]) {
      // A cut from the very first frame -- no ease from the walking camera -- and none left by the time you are down.
      expect(flightShot(f, 0)!.w).toBe(1);
      expect(flightShot(f, flightMs(f) - 200)!.w).toBe(0);
      const before = cameraAt(f, SHOT_CUT_MS - 1), after = cameraAt(f, SHOT_CUT_MS);
      expect(before.eye.distanceTo(after.eye), 'no cut to you').toBeGreaterThan(1);
      let was = after;
      for (let ms = SHOT_CUT_MS + 5; ms <= flightMs(f); ms += 5) {
        const now = cameraAt(f, ms);
        // Bolted to you as you are snatched up and carried, the camera moves as you do;
        // what it must never do is jump about you.
        const you = (c: typeof was) => new THREE.Vector3(c.p.x, c.p.y, c.p.z);
        const eyeOff = now.eye.clone().sub(you(now)).distanceTo(was.eye.clone().sub(you(was)));
        const lookOff = now.look.clone().sub(you(now)).distanceTo(was.look.clone().sub(you(was)));
        expect(eyeOff, `the camera jumped at ${ms} ms`).toBeLessThan(0.12);
        expect(lookOff, `the camera swung at ${ms} ms`).toBeLessThan(0.25);
        was = now;
      }
    }
    expect(flightShot({ fx: 0, fz: 0, tx: 0, tz: 0, kind: 'drop' }, 100), 'a shot for somebody else\'s coming in').toBeNull();
  });

  it('the canvas eases its camera into the shot on your own flight (SOURCE SHAPE: it needs GL)', () => {
    const canvas = strip(readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8'));
    expect(canvas).toContain('const shot = flying && you.fly ? flightShot(you.fly.f, you.fly.ms) : null;');
    expect(canvas).toContain('eye[k] = eye[k]! + (shot.eye[k]! - eye[k]!) * shot.w;');
    expect(canvas).toContain('look[k] = look[k]! + (shot.look[k]! - look[k]!) * shot.w;');
    expect(canvas.indexOf('look[k] = look[k]!')).toBeLessThan(canvas.indexOf('camera.position.set(eye[0], eye[1], eye[2]);'));
  });
});

describe('not for a few steps', () => {
  it(`nearer than ${FLY_MIN} units you go on foot -- at a run if need be, never slower than the plane would be`, () => {
    const byPlane = flightMs({ fx: 0, fz: 0, tx: FLY_MIN, tz: 0 }) / 1000;
    for (const d of [0.6, FLY_MIN * 0.5, FLY_MIN * 0.99]) {
      const s = new WorldSim(5);
      s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
      s.place('you', 0, 0);
      expect(s.walkTo('you', d, 0)).toBe(true);
      let t = 0;
      for (; t < 10 && Math.hypot(s.get('you')!.x - d, s.get('you')!.z) > 0.12; t += 1 / 60) s.step(1 / 60);
      expect(s.get('you')!.fly).toBeUndefined();
      expect(t, `${d.toFixed(2)} units: slower on foot than by plane`).toBeLessThanOrEqual(byPlane);
      expect(t, `${d.toFixed(2)} units`).toBeLessThanOrEqual(BENCH_SECS + 1);
    }
  });

  it('a yes while you are still coming down into the park: the plane comes as soon as you land, or you walk', () => {
    // On the Pixel, 2026-10-04: "Find someone" the moment the park opened, the bot's yes
    // came while the arrival parachute was still coming down -- the second flight was
    // ignored, and the two were "talking" sixteen units apart.
    const s = new WorldSim(5);
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    expect(s.dropIn('you', 0, 0)).toBe(true);
    let landed = 0;
    expect(s.flyTo('you', 12, 0, () => { landed++; }), 'turned down while coming down').toBe(true);
    let picked = false;
    for (let i = 0; i < 60 * 8 && !landed; i++) {
      s.step(1 / 60);
      picked ||= s.get('you')!.fly?.f.kind === 'pickup';
    }
    expect(picked, 'no plane after landing').toBe(true);
    expect(landed).toBe(1);
    expect(Math.hypot(s.get('you')!.x - 12, s.get('you')!.z)).toBeLessThan(1e-6);

    const w = new WorldSim(5);
    w.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    w.dropIn('you', 0, 0);
    expect(w.walkTo('you', 1.5, 0)).toBe(true);
    for (let i = 0; i < 60 * 8; i++) w.step(1 / 60);
    expect(Math.hypot(w.get('you')!.x - 1.5, w.get('you')!.z), 'never walked over after landing').toBeLessThan(0.12);
  });

  it('a short hop\'s plane never carries you past them', () => {
    for (const d of [FLY_MIN, 4, 6, 9, 12, 20]) {
      const f: Flight = { fx: 0, fz: 0, tx: d, tz: 0 };
      let furthest = -Infinity;
      for (let ms = 0; ms <= flightMs(f); ms += 10) furthest = Math.max(furthest, flightAt(f, ms).x);
      expect(furthest - d, `${d} units: carried past them`).toBeLessThan(0.2);
    }
  });

  it('the plane drawn is the size it says, the cable coming out of its belly', () => {
    const g = planeGeometry('#6D5DFC');
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(PLANE_SPAN, 1);
    expect(box.max.z - box.min.z).toBeGreaterThan(PLANE_LENGTH * 0.95);
    expect(box.max.z - box.min.z).toBeLessThan(PLANE_LENGTH * 1.1);
    expect(box.min.y, 'something of the plane hangs below where its cable comes out').toBeGreaterThan(-0.02);
  });

  it('taken away: the plane comes, its cable has you, and it takes you up and out of sight', () => {
    const f: Flight = { fx: 1, fz: 1, tx: 1, tz: 1, kind: 'away', facing: 0.7 };
    expect(flightAt(f, T_CABLE / 2).plane).not.toBeNull();
    expect(flightAt(f, T_HOOK + 10).roped).toBe(true);
    const end = flightAt(f, AWAY_MS);
    expect(end.y, 'still low as it goes').toBeGreaterThan(6);
    expect(end.plane, 'the plane still in sight at the end').toBeNull();
  });
});
