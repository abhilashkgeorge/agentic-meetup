/**
 * Bengaluru's traffic, as shapes: a two-wheeler with its rider, an auto, a car and a
 * BMTC bus, for the road round Cubbon Park (traffic.ts moves them, city-mesh.ts draws
 * them).
 *
 * Each is one geometry with its colours in its vertices, pointing along +z and standing
 * on the ground at y 0, at its real size at 8.1 m a unit (tests/park-scale.test.ts
 * holds them to it). The parts that differ from one vehicle to the next -- a car's
 * paint, a bus's livery, a rider's shirt and helmet -- are white here and take the
 * instance's colour; everything else is its own colour and an instance colour of white
 * leaves it be. (An instance colour multiplies: white times red is red, black times
 * red is still black.)
 *
 * Reached only through canvas.tsx, like the other files that import three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCar } from './car-mesh';
import type { VehicleKind } from './traffic';

const M = 1 / 8.1;
/** The part an instance colours. */
export const TINT = '#ffffff';

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

/** A box in metres: width (x), height (y), length (z), at its middle (x, y, z). */
const box = (w: number, h: number, l: number, x: number, y: number, z: number, hex: string) =>
  painted(new THREE.BoxGeometry(w * M, h * M, l * M).translate(x * M, y * M, z * M), hex);

/** A wheel in metres, its axle across (x). */
function wheel(r: number, t: number, x: number, z: number, hex = '#1b1d21'): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * M, r * M, t * M, 10);
  g.rotateZ(Math.PI / 2);
  return painted(g.translate(x * M, r * M, z * M), hex);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('a vehicle did not merge');
  g.computeVertexNormals();
  return g;
}

/**
 * A two-wheeler and the person on it: 1.9 m long, the rider's helmet at 1.5 m. The
 * rider's shirt and helmet take the instance's colour.
 */
export function buildTwoWheeler(): THREE.BufferGeometry {
  const dark = '#2a2c30', skin = '#8a5a3c', jeans = '#2f3b52';
  return merged([
    wheel(0.28, 0.1, 0, 0.66), wheel(0.28, 0.1, 0, -0.66),
    box(0.3, 0.32, 1.1, 0, 0.5, -0.05, dark),               // the body, over the wheels
    box(0.28, 0.1, 0.6, 0, 0.72, -0.2, '#111111'),          // the seat
    box(0.26, 0.5, 0.12, 0, 0.72, 0.55, dark),              // the front, up to the bars
    box(0.62, 0.04, 0.05, 0, 1.0, 0.52, '#111111'),         // handlebars
    box(0.12, 0.08, 0.04, 0, 0.9, 0.64, '#fff4c2'),         // headlamp
    // The rider: legs on the footboard, back straight, hands on the bars.
    box(0.36, 0.14, 0.42, 0, 0.8, -0.05, jeans),            // thighs
    box(0.3, 0.42, 0.14, 0, 0.5, 0.2, jeans),               // shins
    box(0.4, 0.55, 0.24, 0, 1.1, -0.2, TINT),               // shirt
    box(0.08, 0.08, 0.5, 0.2, 1.1, 0.12, TINT),             // arms to the bars
    box(0.08, 0.08, 0.5, -0.2, 1.1, 0.12, TINT),
    box(0.1, 0.1, 0.1, 0, 1.4, -0.18, skin),                // neck
    painted(new THREE.SphereGeometry(0.15 * M, 8, 6).translate(0, 1.52 * M, -0.18 * M), TINT), // helmet
  ]);
}

/**
 * An autorickshaw: three wheels, 2.7 m long, 1.3 m wide, the canopy at 1.75 m. Its
 * body takes its livery from `body` -- green or black, under the yellow canopy.
 */
export function buildAuto(body: string): THREE.BufferGeometry {
  const yellow = '#F3C316', black = '#141414', glass = '#27303a';
  return merged([
    wheel(0.2, 0.12, 0, 1.0), wheel(0.2, 0.12, 0.55, -0.75), wheel(0.2, 0.12, -0.55, -0.75),
    box(1.2, 0.5, 2.3, 0, 0.55, -0.05, body),                // the tub
    box(0.5, 0.6, 0.5, 0, 0.75, 0.95, body),                 // the nose, over the front wheel
    box(1.3, 0.08, 2.2, 0, 1.72, -0.1, yellow),              // the canopy
    box(1.28, 0.18, 2.1, 0, 1.6, -0.1, black),               // its black trim
    box(1.1, 0.5, 0.04, 0, 1.3, 0.72, glass),                // windscreen
    box(0.05, 0.9, 0.05, 0.6, 1.15, 0.7, black),             // the frame posts
    box(0.05, 0.9, 0.05, -0.6, 1.15, 0.7, black),
    box(1.25, 0.9, 0.05, 0, 1.15, -1.18, black),             // the back
    box(0.1, 0.1, 0.04, 0, 0.9, 1.21, '#fff4c2'),            // headlamp
  ]);
}

/** A BMTC bus: 11 m long, 2.5 m wide, 3.1 m tall. Its livery takes the instance's colour. */
export function buildBus(): THREE.BufferGeometry {
  const glass = '#1e2830', trim = '#1b1d21', board = '#FF8A1F';
  const parts = [
    box(2.5, 2.6, 11, 0, 1.75, 0, TINT),                     // the body
    box(2.52, 0.9, 9.6, 0, 2.3, -0.4, glass),                // windows, both sides
    box(2.3, 1.2, 0.05, 0, 2.2, 5.51, glass),                // windscreen
    box(1.6, 0.25, 0.05, 0, 2.95, 5.52, board),              // the destination board
    box(2.55, 0.25, 11.05, 0, 0.55, 0, trim),                // the skirt
    box(0.3, 0.15, 0.05, 0.9, 0.9, 5.52, '#fff4c2'),         // lamps
    box(0.3, 0.15, 0.05, -0.9, 0.9, 5.52, '#fff4c2'),
  ];
  for (const z of [3.6, -3.4]) for (const x of [1.15, -1.15]) parts.push(wheel(0.5, 0.3, x, z));
  return merged(parts);
}

/** Each kind's geometry, and the colours its instances take. */
export function vehicleGeometry(kind: VehicleKind | 'auto-black'): THREE.BufferGeometry {
  switch (kind) {
    case 'bike': return buildTwoWheeler();
    case 'auto': return buildAuto('#2E7D32');
    case 'auto-black': return buildAuto('#1a1a1a');
    case 'bus': return buildBus();
    case 'car': return buildCar(TINT);
  }
}

/** What an instance of each kind is painted, by its seed. */
export const LIVERIES: Record<VehicleKind, readonly string[]> = {
  // Shirts and helmets.
  bike: ['#D64545', '#2F6FB2', '#F2F2F2', '#F2B632', '#3E8E5E', '#222222', '#8E44AD'],
  auto: ['#ffffff'],
  // White and silver most of all, as Bengaluru's cars are.
  car: ['#F4F4F4', '#F4F4F4', '#C9CDD2', '#C9CDD2', '#7B8189', '#1F2226', '#A61E22', '#2A4C8C', '#F4F4F4'],
  // BMTC: the blue of Vayu Vajra, the red of Vajra, and the ordinary green.
  bus: ['#1D4E9E', '#B3261E', '#2E7D4F'],
};
