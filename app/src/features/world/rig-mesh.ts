/**
 * The emergency pickup's gear, drawn: the balloon, its rope, and the parachute with its
 * lines (flight.ts says where each is, frame by frame, as `rig` on whoever is flying).
 *
 * As PUBG draws it (the founder, 2026-10-03, with a screenshot of two players hanging
 * from a pickup's line high over the map): a pale balloon on a dark line, the person
 * hanging from it by the back, and a striped canopy when they let go and come down.
 *
 * THE ROPE IS HOOKED TO THE BACK, between the shoulder blades (flight.ts HOOK) -- the
 * point the body swings about while carried, so it stays put while the body swings and
 * the rope never seems to run through them. THE CANOPY RIDES ABOVE THE HANDS on the
 * risers (flight.ts RISER), its lines coming down to them.
 *
 * A fixed handful of rigs, built once and hidden when nobody is flying: a park has a
 * few people in the air at a time, not dozens, and nothing at all is drawn otherwise.
 */
import * as THREE from 'three';
import { BALLOON_R, BODY_K, CANOPY_ABOVE, type FlightPose } from './flight';

/** At most this many people's gear drawn at once; anybody past it flies bare. */
export const RIGS = 8;
/** The canopy: how wide when open, and how tall the dome. */
const CANOPY_R = 0.26;
const CANOPY_H = 0.11;
/** The rope's thickness, and how far apart the hands hold the lines (flight.ts RISER). */
const ROPE_R = 0.006;
const HANDS = 0.11 * BODY_K;

export interface Rigged {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly lift?: number;
  readonly rig?: FlightPose | undefined;
}

export interface BuiltRigs {
  group: THREE.Group;
  /** Draw the gear of whoever among the first `count` of `people` is flying. */
  update(people: readonly Rigged[], count: number): void;
  dispose(): void;
}

/** A shallow dome, open underneath, in stripes of the canopy colour and white. */
function canopy(color: string): THREE.BufferGeometry {
  const dome = new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2.3).toNonIndexed();
  const pos = dome.getAttribute('position');
  const a = new THREE.Color(color), b = new THREE.Color('#ffffff');
  const shade = new Float32Array(pos.count * 3);
  // One colour per triangle, by where its middle is round the dome: crisp stripes.
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const c = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8) % 2 ? a : b;
    for (let k = 0; k < 3; k++) shade.set([c.r, c.g, c.b], (i + k) * 3);
  }
  dome.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  return dome;
}

export function buildRigs(chuteColor: string): BuiltRigs {
  const group = new THREE.Group();
  group.name = 'pickup-rigs';
  const balloonGeo = new THREE.SphereGeometry(1, 18, 12);
  const ropeGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  ropeGeo.translate(0, 0.5, 0); // from its foot up, so it can be stood on the hook
  const canopyGeo = canopy(chuteColor);
  const ropeMat = new THREE.MeshBasicMaterial({ color: '#3d3d3d' });
  const canopyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const lineMat = new THREE.LineBasicMaterial({ color: '#4a4a4a' });
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();

  const rigs = Array.from({ length: RIGS }, () => {
    const balloonMat = new THREE.MeshLambertMaterial({ color: '#f3efe6', transparent: true });
    const balloon = new THREE.Mesh(balloonGeo, balloonMat);
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    const chute = new THREE.Mesh(canopyGeo, canopyMat);
    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    const lines = new THREE.LineSegments(linesGeo, lineMat);
    for (const m of [balloon, rope, chute, lines]) {
      m.visible = false;
      m.frustumCulled = false;
      m.raycast = () => {};
      group.add(m);
    }
    return { balloon, balloonMat, rope, chute, lines, linesGeo };
  });

  return {
    group,
    update(people, count) {
      let n = 0;
      for (let i = 0; i < count && n < RIGS; i++) {
        const rig = people[i]!.rig;
        if (!rig || (!rig.balloon && rig.chute <= 0)) continue;
        const r = rigs[n++]!;
        const b = rig.balloon;
        const hook = rig.anchor;
        // The balloon, a little taller than it is wide.
        r.balloon.visible = !!b && b.alpha > 0.01;
        if (b) {
          r.balloon.position.set(b.x, b.y, b.z);
          r.balloon.scale.set(BALLOON_R * b.size, BALLOON_R * b.size * 1.18, BALLOON_R * b.size);
          r.balloonMat.opacity = b.alpha;
        }
        // The rope, from the hook on their back to the bottom of the balloon.
        r.rope.visible = rig.roped && !!b;
        if (rig.roped && b) {
          dir.set(b.x - hook.x, b.y - BALLOON_R * b.size * 1.1 - hook.y, b.z - hook.z);
          const len = dir.length();
          r.rope.position.set(hook.x, hook.y, hook.z);
          r.rope.quaternion.setFromUnitVectors(up, len > 1e-6 ? dir.divideScalar(len) : up);
          r.rope.scale.set(ROPE_R, len, ROPE_R);
        }
        // The canopy over the hands, opening wide from a furled column, its lines down to them.
        const open = Math.min(1, Math.max(0, rig.chute));
        r.chute.visible = open > 0.01;
        r.lines.visible = open > 0.01;
        if (open > 0.01) {
          const top = hook.y + CANOPY_ABOVE;
          const w = CANOPY_R * (0.25 + 0.75 * open);
          r.chute.position.set(hook.x, top - CANOPY_H * 0.5, hook.z);
          r.chute.scale.set(w, CANOPY_H, w);
          const arr = r.linesGeo.getAttribute('position').array as Float32Array;
          const rim = top - CANOPY_H * 0.45;
          // Across the body, which way is left: the hands are either side of the anchor.
          const sx = Math.cos(rig.heading), sz = -Math.sin(rig.heading);
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
            const side = Math.cos(a) * sx + Math.sin(a) * sz > 0 ? 1 : -1;
            arr.set([hook.x + Math.cos(a) * w, rim, hook.z + Math.sin(a) * w,
              hook.x + sx * HANDS * side, hook.y, hook.z + sz * HANDS * side], k * 6);
          }
          r.linesGeo.getAttribute('position').needsUpdate = true;
        }
      }
      for (let i = n; i < RIGS; i++) {
        const r = rigs[i]!;
        r.balloon.visible = false; r.rope.visible = false; r.chute.visible = false; r.lines.visible = false;
      }
    },
    dispose() {
      balloonGeo.dispose(); ropeGeo.dispose(); canopyGeo.dispose();
      ropeMat.dispose(); canopyMat.dispose(); lineMat.dispose();
      for (const r of rigs) { r.balloonMat.dispose(); r.linesGeo.dispose(); }
      group.clear();
    },
  };
}
