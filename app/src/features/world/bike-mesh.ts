/**
 * A bicycle, drawn from the points the rider's pose is made from (bike.ts BIKE): its
 * saddle is where the rider sits, its grips where their hands are, its cranks turn
 * round the circle their feet go round. In the character model's units, facing +z,
 * wheels on y 0; the canvas scales it with the rider (MODEL_SCALE x PERSON x their
 * build), so a taller rider has a taller bike.
 *
 * A Bengaluru hire bike: a step-through frame in teal, black tyres, a basket on the
 * front. One geometry, its colours in its vertices; no cranks or pedals, which the
 * rider's feet already draw as they go round.
 *
 * Reached only through canvas.tsx, like the other files that import three.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BIKE } from './bike';

type V3 = readonly [number, number, number];

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

/** A round tube from a to b. */
function tube(a: V3, b: V3, r: number, hex: string, sides = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, sides);
  // A cylinder stands along y: turned onto a-b and moved to its middle.
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return painted(g, hex);
}

/** A wheel at `axle`: tyre, rim, hub and spokes, turning about x. */
function wheel(axle: V3): THREE.BufferGeometry[] {
  const R = BIKE.wheelR;
  const tyre = new THREE.TorusGeometry(R - 0.025, 0.028, 5, 22);
  tyre.rotateY(Math.PI / 2);
  tyre.translate(axle[0], axle[1], axle[2]);
  const parts = [painted(tyre, '#16181b'), tube([axle[0] - 0.05, axle[1], axle[2]], [axle[0] + 0.05, axle[1], axle[2]], 0.03, '#9aa1a8')];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    parts.push(tube(axle, [axle[0], axle[1] + Math.cos(a) * (R - 0.05), axle[2] + Math.sin(a) * (R - 0.05)], 0.006, '#b8bec4', 3));
  }
  return parts;
}

/** The bicycle, in `frame`'s colour. */
export function buildBike(frame = '#12A39A'): THREE.BufferGeometry {
  const { bottomBracket: bb, rearAxle: rear, frontAxle: front, saddle, grip, headTop, headBottom } = BIKE;
  const seatPost: V3 = [0, saddle[1] - 0.06, saddle[2] + 0.02];
  const bar: V3 = [0, grip[1], grip[2]];
  const R = 0.02;
  const parts: THREE.BufferGeometry[] = [
    ...wheel(rear), ...wheel(front),
    // A step-through frame: a low, curved-looking down tube in two runs, no top tube.
    tube(bb, seatPost, R, frame),
    tube(bb, [0, 0.42, 0.25], R, frame),
    tube([0, 0.42, 0.25], headBottom, R, frame),
    tube(bb, rear, R * 0.8, frame),
    tube(seatPost, rear, R * 0.8, frame),
    tube(headBottom, headTop, R * 1.2, frame),
    tube(headBottom, front, R * 0.9, frame),
    // Stem and swept-back bars, grips at the ends.
    tube(headTop, bar, R, '#3b3f44'),
    tube([-grip[0] - 0.03, grip[1], grip[2]], [grip[0] + 0.03, grip[1], grip[2]], 0.015, '#3b3f44'),
    tube([grip[0] - 0.05, grip[1], grip[2]], [grip[0] + 0.03, grip[1], grip[2]], 0.024, '#111111'),
    tube([-grip[0] + 0.05, grip[1], grip[2]], [-grip[0] - 0.03, grip[1], grip[2]], 0.024, '#111111'),
    // The saddle, its top where the rider sits.
    painted(new THREE.BoxGeometry(0.11, 0.045, 0.24).translate(saddle[0], saddle[1] - 0.0225, saddle[2]), '#111111'),
    // The basket, on the front, on a bracket off the head tube.
    tube(headTop, [0, headTop[1] - 0.1, headTop[2] + 0.12], 0.012, '#3b3f44'),
    painted(new THREE.BoxGeometry(0.26, 0.15, 0.2).translate(0, headTop[1] - 0.12, headTop[2] + 0.2), '#2d3136'),
  ];
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('the bicycle did not merge');
  g.computeVertexNormals();
  return g;
}
