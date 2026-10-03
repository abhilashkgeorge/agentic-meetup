/**
 * THE PLANE that comes for you (flight.ts): a little four-engined cargo plane -- high
 * wing, upswept tail, as the pickup planes in games are drawn -- built from a handful of
 * flat-shaded pieces, white with the theme's colour on its tail, wing tips and spinners.
 *
 * Its origin is where the cable comes out, under the back of its belly (flight.ts says
 * where that is, frame by frame); it faces +z, wings along x. About eleven metres long
 * and fourteen across in the park's units (one is 8.1 m): smaller than a real one, so
 * that a phone held upright shows all of it with you under it.
 *
 * PURE: geometry only, no GL (rig-mesh.ts draws it; scripts/film-pickup.mts films it).
 */
import * as THREE from 'three';

/** Nose to tail and tip to tip, in units. */
export const PLANE_LENGTH = 1.4;
export const PLANE_SPAN = 1.7;
/** The four propellers: where their hubs are, off the origin, and how long a blade is. */
export const PROP_R = 0.11;

const WHITE = new THREE.Color('#f4f5f8');
const BELLY = new THREE.Color('#d5d9e2');
const GLASS = new THREE.Color('#27303f');
const ENGINE = new THREE.Color('#8b919c');
const DARK = new THREE.Color('#4a505b');

/** Fuselage cross-sections, nose to tail: where along it, how round, how high its middle is. */
const SECTIONS: [z: number, r: number, y: number][] = [
  [0.7, 0.0, -0.01], [0.67, 0.04, -0.008], [0.62, 0.068, -0.004], [0.54, 0.088, 0], [0.42, 0.098, 0],
  [-0.2, 0.098, 0], [-0.36, 0.088, 0.02], [-0.5, 0.068, 0.045], [-0.62, 0.046, 0.066], [-0.7, 0.026, 0.08],
];
const SIDES = 10;
/** Where the cable comes out: under the belly, behind the wing, at the top of the ramp. */
const EXIT: [number, number, number] = [0, -0.098, -0.24];

class Builder {
  pos: number[] = [];
  col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
  /** A closed slab between two outlines (top and bottom), each four corners round. */
  slab(top: THREE.Vector3[], bottom: THREE.Vector3[], color: THREE.Color): void {
    this.quad(top[0]!, top[1]!, top[2]!, top[3]!, color);
    this.quad(bottom[3]!, bottom[2]!, bottom[1]!, bottom[0]!, color);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(bottom[i]!, bottom[j]!, top[j]!, top[i]!, color);
    }
  }
  /** A tapered round pod along z, from z0 (radius r0) to z1 (radius r1), closed at both ends. */
  pod(cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, color: THREE.Color, n = 8): void {
    const ring = (z: number, r: number) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    });
    const a = ring(z0, r0), b = ring(z1, r1);
    const ca = new THREE.Vector3(cx, cy, z0), cb = new THREE.Vector3(cx, cy, z1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(a[i]!, b[i]!, b[j]!, a[j]!, color);
      if (r0 > 0) this.tri(ca, a[j]!, a[i]!, color);
      if (r1 > 0) this.tri(cb, b[i]!, b[j]!, color);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    // Each triangle its own corners: computed normals are flat, as the park is drawn.
    g.computeVertexNormals();
    return g;
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x - EXIT[0], y - EXIT[1], z - EXIT[2]);

/** The engines' hubs, off the origin: two each side, under the leading edge of the wing. */
export const PROP_HUBS: [number, number, number][] = [-0.5, -0.26, 0.26, 0.5].map((x) => [x - EXIT[0], 0.062 - EXIT[1], 0.36 - EXIT[2]]);

/** The plane's body, wings, engines and tail, in the theme's colour where it is not white. */
export function planeGeometry(accent: string): THREE.BufferGeometry {
  const b = new Builder();
  const tint = new THREE.Color(accent);

  // The fuselage: rings round each section, the cockpit glass dark across the top of the nose.
  for (let s = 0; s + 1 < SECTIONS.length; s++) {
    const [z0, r0, y0] = SECTIONS[s]!;
    const [z1, r1, y1] = SECTIONS[s + 1]!;
    for (let i = 0; i < SIDES; i++) {
      const a0 = (i / SIDES) * Math.PI * 2, a1 = ((i + 1) / SIDES) * Math.PI * 2;
      const p = (z: number, r: number, y: number, a: number) => v(Math.cos(a) * r * 1.02, y + Math.sin(a) * r, z);
      const up = Math.sin((a0 + a1) / 2);
      const glass = s === 1 && up > 0.2;
      const color = glass ? GLASS : up < -0.3 ? BELLY : WHITE;
      b.quad(p(z0, r0, y0, a0), p(z1, r1, y1, a0), p(z1, r1, y1, a1), p(z0, r0, y0, a1), color);
    }
  }

  // The wing, high on the body, a little dihedral; the tips in the theme's colour.
  const wing = (side: 1 | -1) => {
    const root = 0.04, tip = PLANE_SPAN / 2, y0 = 0.1, y1 = 0.125, tipFrom = tip - 0.12;
    const at = (x: number) => {
      const k = (x - root) / (tip - root);
      return { lead: 0.26 - 0.04 * k, trail: 0.0 + 0.1 * k, y: y0 + (y1 - y0) * k, t: 0.03 - 0.014 * k };
    };
    const piece = (x0: number, x1: number, color: THREE.Color) => {
      const a = at(x0), c = at(x1);
      b.slab(
        [v(side * x0, a.y + a.t / 2, a.lead), v(side * x1, c.y + c.t / 2, c.lead), v(side * x1, c.y + c.t / 2, c.trail), v(side * x0, a.y + a.t / 2, a.trail)],
        [v(side * x0, a.y - a.t / 2, a.lead), v(side * x1, c.y - c.t / 2, c.lead), v(side * x1, c.y - c.t / 2, c.trail), v(side * x0, a.y - a.t / 2, a.trail)],
        color,
      );
    };
    piece(root, tipFrom, WHITE);
    piece(tipFrom, tip, tint);
  };
  wing(1);
  wing(-1);

  // Four engines under the leading edge, their spinners in the theme's colour.
  for (const [x, y, z] of PROP_HUBS) {
    b.pod(x, y, z - 0.36, z - 0.02, 0.026, 0.038, ENGINE);
    b.pod(x, y, z - 0.02, z, 0.038, 0.034, DARK);
    b.pod(x, y, z, z + 0.05, 0.022, 0, tint, 6);
  }

  // The tail: a tall fin in the theme's colour, and the tailplane either side.
  b.slab(
    [v(0.008, 0.11, -0.4), v(0.008, 0.38, -0.6), v(0.008, 0.38, -0.7), v(0.008, 0.1, -0.7)],
    [v(-0.008, 0.11, -0.4), v(-0.008, 0.38, -0.6), v(-0.008, 0.38, -0.7), v(-0.008, 0.1, -0.7)],
    tint,
  );
  for (const side of [1, -1] as const) {
    b.slab(
      [v(side * 0.03, 0.082, -0.5), v(side * 0.34, 0.09, -0.6), v(side * 0.34, 0.09, -0.68), v(side * 0.03, 0.082, -0.7)],
      [v(side * 0.03, 0.068, -0.5), v(side * 0.34, 0.078, -0.6), v(side * 0.34, 0.078, -0.68), v(side * 0.03, 0.068, -0.7)],
      WHITE,
    );
  }
  return b.geometry();
}

/** One propeller's two blades, round its hub at the origin, turning in the x-y plane. */
export function bladeGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  const w = 0.016, t = 0.004;
  const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  b.slab([p(-PROP_R, w, t), p(PROP_R, w, t), p(PROP_R, -w, t), p(-PROP_R, -w, t)],
    [p(-PROP_R, w, -t), p(PROP_R, w, -t), p(PROP_R, -w, -t), p(-PROP_R, -w, -t)], DARK);
  return b.geometry();
}

/** The blur of a turning propeller: a faint disc. */
export function propDiscGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(PROP_R * 1.02, 20);
}
