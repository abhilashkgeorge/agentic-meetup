/**
 * The emergency pickup's gear, drawn: the plane, its cable, and the parachute with its
 * lines (flight.ts says where each is, frame by frame, as `rig` on whoever is flying).
 *
 * As the founder asked for it (2026-10-04): "Use a fine rope, not the thick one ...
 * show a good aeroplane on the sky dropping the cable then attaching to the user and
 * dropping it to the partner's location". The plane is plane-mesh.ts's. THE CABLE IS A
 * HAIRLINE: a ribbon turned to face the camera and widened with distance, so it is
 * CABLE_DP wide on the screen wherever it is -- the rope before it was a solid six
 * centimetres round, drawn thick up close and lost far off. A small weight on its end
 * shows it falling; once it has you, it is hooked to your back, between the shoulder
 * blades (flight.ts HOOK) -- the point the body swings about while carried. THE CANOPY
 * RIDES ABOVE THE HANDS on the risers (flight.ts RISER), its lines coming down to them.
 *
 * A fixed handful of rigs, built once and hidden when nobody is flying: a park has a
 * few people in the air at a time, not dozens, and nothing at all is drawn otherwise.
 */
import * as THREE from 'three';
import { BODY_K, CANOPY_ABOVE, cableCurve, type FlightPose } from './flight';
import { PROP_HUBS, bladeGeometry, planeGeometry, propDiscGeometry } from './plane-mesh';

/** At most this many people's gear drawn at once; anybody past it flies bare. */
export const RIGS = 8;
/** The canopy: how wide when open, and how tall the dome. */
const CANOPY_R = 0.26;
const CANOPY_H = 0.11;
/** How far apart the hands hold the lines (flight.ts RISER). */
const HANDS = 0.11 * BODY_K;
/** The cable's width on the screen, in the screen's points, however near or far it is. */
export const CABLE_DP = 1.3;
/** Its points, plane to end: enough for the belly of a falling cable to curve. */
const CABLE_SEGMENTS = 14;
/** The weight on its end, while it falls. */
const WEIGHT_R = 0.016;
/** How fast the propellers turn, radians a second: quick enough to blur, slow enough to see. */
const PROP_SPIN = 31;

export interface Rigged {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly lift?: number;
  readonly rig?: FlightPose | undefined;
}

/** Where the camera is, how many world units one screen point covers at one unit away, and the time. */
export interface RigView {
  eye: readonly [number, number, number];
  unitsPerDp: number;
  time: number;
}

export interface BuiltRigs {
  group: THREE.Group;
  /** Draw the gear of whoever among the first `count` of `people` is flying. */
  update(people: readonly Rigged[], count: number, view?: RigView): void;
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

/** A strip of quads along the cable: two corners per point, set every frame to face the camera. */
function ribbon(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CABLE_SEGMENTS + 1) * 2 * 3), 3));
  const index: number[] = [];
  for (let i = 0; i < CABLE_SEGMENTS; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, b, c, b, d, c);
  }
  g.setIndex(index);
  return g;
}

/**
 * The cable's corners for this frame: each point pushed out either side, square to the
 * cable and to the line from the camera, by half the width that covers CABLE_DP there.
 * Without a camera, a fixed hair's width.
 */
export function cableRibbon(points: readonly (readonly [number, number, number])[], out: Float32Array, view?: RigView): void {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i]!, a = points[Math.max(0, i - 1)]!, b = points[Math.min(n - 1, i + 1)]!;
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const ex = view ? p[0] - view.eye[0] : 0, ey = view ? p[1] - view.eye[1] : 0, ez = view ? p[2] - view.eye[2] : 1;
    // Across: the cable's direction crossed with the line of sight.
    let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex;
    const len = Math.hypot(sx, sy, sz) || 1;
    const half = (view ? Math.hypot(ex, ey, ez) * view.unitsPerDp * CABLE_DP : 0.004) / 2;
    sx = (sx / len) * half; sy = (sy / len) * half; sz = (sz / len) * half;
    out.set([p[0] - sx, p[1] - sy, p[2] - sz, p[0] + sx, p[1] + sy, p[2] + sz], i * 6);
  }
}

export function buildRigs(chuteColor: string): BuiltRigs {
  const group = new THREE.Group();
  group.name = 'pickup-rigs';
  const canopyGeo = canopy(chuteColor);
  const planeGeo = planeGeometry(chuteColor);
  const bladeGeo = bladeGeometry();
  const discGeo = propDiscGeometry();
  const weightGeo = new THREE.SphereGeometry(WEIGHT_R, 8, 6);
  const cableMat = new THREE.MeshBasicMaterial({ color: '#2b2d33', side: THREE.DoubleSide });
  const weightMat = new THREE.MeshLambertMaterial({ color: chuteColor });
  const canopyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const lineMat = new THREE.LineBasicMaterial({ color: '#4a4a4a' });
  const quiet = (m: THREE.Object3D) => { m.visible = false; m.frustumCulled = false; m.raycast = () => {}; group.add(m); return m; };

  const rigs = Array.from({ length: RIGS }, () => {
    const planeMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });
    const discMat = new THREE.MeshBasicMaterial({ color: '#3a3f4a', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Group();
    plane.add(new THREE.Mesh(planeGeo, planeMat));
    const props = PROP_HUBS.map(([x, y, z]) => {
      const hub = new THREE.Group();
      hub.position.set(x, y, z + 0.015);
      const blades = new THREE.Mesh(bladeGeo, planeMat);
      hub.add(blades, new THREE.Mesh(discGeo, discMat));
      plane.add(hub);
      return blades;
    });
    plane.traverse((o) => { o.raycast = () => {}; });
    plane.rotation.order = 'YXZ';
    const cableGeo = ribbon();
    const cable = new THREE.Mesh(cableGeo, cableMat);
    const weight = new THREE.Mesh(weightGeo, weightMat);
    const chute = new THREE.Mesh(canopyGeo, canopyMat);
    const linesGeo = new THREE.BufferGeometry();
    linesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    const lines = new THREE.LineSegments(linesGeo, lineMat);
    for (const m of [plane, cable, weight, chute, lines]) quiet(m);
    return { plane, planeMat, discMat, props, cable, cableGeo, weight, chute, lines, linesGeo };
  });

  return {
    group,
    update(people, count, view) {
      let n = 0;
      for (let i = 0; i < count && n < RIGS; i++) {
        const rig = people[i]!.rig;
        if (!rig || (!rig.plane && !rig.cable && rig.chute <= 0)) continue;
        const r = rigs[n++]!;
        const hook = rig.anchor;
        // The plane, nose along its way, tipped up as it climbs.
        const pl = rig.plane;
        r.plane.visible = !!pl;
        if (pl) {
          r.plane.position.set(pl.x, pl.y, pl.z);
          r.plane.rotation.set(-pl.climb, pl.heading, pl.roll);
          r.planeMat.opacity = pl.alpha;
          r.discMat.opacity = 0.18 * pl.alpha;
          const spin = (view?.time ?? 0) * PROP_SPIN;
          r.props.forEach((p, k) => { p.rotation.z = spin + k; });
        }
        // The cable, from the back of the plane's belly down to its end -- your back, once it has you.
        const c = rig.cable;
        r.cable.visible = !!pl && !!c;
        r.weight.visible = !!pl && !!c && !rig.roped;
        if (pl && c) {
          const arr = r.cableGeo.getAttribute('position').array as Float32Array;
          cableRibbon(cableCurve(pl, c, rig.heading, CABLE_SEGMENTS), arr, view);
          r.cableGeo.getAttribute('position').needsUpdate = true;
          r.weight.position.set(c.x, c.y, c.z);
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
        r.plane.visible = false; r.cable.visible = false; r.weight.visible = false; r.chute.visible = false; r.lines.visible = false;
      }
    },
    dispose() {
      canopyGeo.dispose(); planeGeo.dispose(); bladeGeo.dispose(); discGeo.dispose(); weightGeo.dispose();
      cableMat.dispose(); weightMat.dispose(); canopyMat.dispose(); lineMat.dispose();
      for (const r of rigs) { r.planeMat.dispose(); r.discMat.dispose(); r.cableGeo.dispose(); r.linesGeo.dispose(); }
      group.clear();
    },
  };
}
