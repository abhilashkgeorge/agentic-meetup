/**
 * The little car that drives you to somebody who said yes (ride.ts).
 *
 * Simple shapes in one mesh with the colours in its vertices -- one draw call, built
 * once -- the size of a small hatchback beside a person 0.215 units tall: 4.4 m long,
 * 1.7 m wide, 1.5 m high at 8.1 m a unit. It points along +z, like everybody in the
 * sim at heading 0, and stands on the ground at y 0.
 *
 * Reached only through canvas.tsx (it imports three): LAZY_ONLY in
 * tests/native-imports.test.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CAR = { length: 0.54, width: 0.21, height: 0.185 };

function painted(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  flat.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = flat.attributes.position!.count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
  flat.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return flat;
}

const box = (w: number, h: number, l: number, x: number, y: number, z: number, hex: string) =>
  painted(new THREE.BoxGeometry(w, h, l).translate(x, y, z), hex);

/** The car, in the app's accent colour, with dark glass and black tyres. */
export function buildCar(body: string): THREE.BufferGeometry {
  const { length: L, width: W } = CAR;
  const glass = '#27303a';
  const trim = '#1b1d21';
  const parts: THREE.BufferGeometry[] = [
    // The body: a lower block, the bonnet a little lower at the front.
    box(W, 0.075, L * 0.94, 0, 0.078, 0, body),
    box(W * 0.98, 0.02, L * 0.3, 0, 0.123, L * 0.3, body),
    // The cabin, set back, and its glass on all four sides.
    box(W * 0.9, 0.07, L * 0.48, 0, 0.148, -L * 0.06, body),
    box(W * 0.92, 0.05, L * 0.02, 0, 0.15, L * 0.18, glass),       // windscreen
    box(W * 0.92, 0.05, L * 0.02, 0, 0.15, -L * 0.3, glass),       // back window
    box(W * 0.92 + 0.004, 0.045, L * 0.4, 0, 0.152, -L * 0.06, glass), // side windows, both sides
    // Bumpers, lights.
    box(W * 1.02, 0.03, 0.02, 0, 0.055, L * 0.475, trim),
    box(W * 1.02, 0.03, 0.02, 0, 0.055, -L * 0.475, trim),
    box(0.04, 0.02, 0.012, W * 0.33, 0.092, L * 0.47, '#fff4c2'),
    box(0.04, 0.02, 0.012, -W * 0.33, 0.092, L * 0.47, '#fff4c2'),
    box(0.04, 0.018, 0.012, W * 0.34, 0.09, -L * 0.47, '#c0392b'),
    box(0.04, 0.018, 0.012, -W * 0.34, 0.09, -L * 0.47, '#c0392b'),
  ];
  // Four wheels, their axles across the car.
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const wheel = new THREE.CylinderGeometry(0.043, 0.043, 0.032, 10);
    wheel.rotateZ(Math.PI / 2);
    parts.push(painted(wheel.translate(x * (W / 2 - 0.008), 0.043, z * L * 0.3), trim));
  }
  const car = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!car) throw new Error('the car did not merge');
  car.computeVertexNormals();
  return car;
}
