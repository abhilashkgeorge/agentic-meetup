/**
 * Only drawing who is on screen.
 *
 * A real camera, a real frustum, no phone. The thing being checked is the one that
 * used to be wrong for everybody: the town drew sixty-four people slots every frame
 * regardless of where anyone stood, so somebody behind you cost exactly as much as
 * somebody in front of you.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop `camera.updateMatrixWorld()` from Viewport.update -> "follows the camera
 *     when it moves" fails, because the frustum is built from a stale matrix.
 *   - drop the `out.length = limit` truncation -> "never asks for more slots than
 *     there are" fails.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Viewport, nearestFirst, pickAlong, visible, type Placed } from '../src/features/world/visible';

/** A person, as this module sees one. */
const at = (x: number, z: number, ref = `${x},${z}`) => ({ x, z, ref });

/** The walking camera's lens, roughly: a normal lens on somebody's shoulder. */
function walkCamera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(62, 9 / 16, 0.08, 90);
  c.position.set(0, 1, 0);
  c.lookAt(0, 1, -10);          // looking down -Z
  c.updateMatrixWorld();
  return c;
}

const RADIUS = 0.4;

describe('drawing only who is on screen', () => {
  it('sees what is in front and not what is behind', () => {
    const view = new Viewport().update(walkCamera());
    expect(view.sees(0, -5, RADIUS), 'straight ahead').toBe(true);
    expect(view.sees(0, -30, RADIUS), 'far ahead, still inside the far plane').toBe(true);
    expect(view.sees(0, 5, RADIUS), 'directly behind the camera').toBe(false);
    expect(view.sees(0, 300, RADIUS), 'on the other side of the city').toBe(false);
    expect(view.sees(0, -200, RADIUS), 'past the far plane').toBe(false);
  });

  it('sees what is off to the side only until it leaves the edge', () => {
    const view = new Viewport().update(walkCamera());
    // At ten units ahead a 62-degree lens is about six units wide each way.
    expect(view.sees(2, -10, RADIUS), 'well inside the edge').toBe(true);
    expect(view.sees(40, -10, RADIUS), 'far outside the edge').toBe(false);
  });

  it('gives somebody walking in from the side a margin, so they do not pop', () => {
    const view = new Viewport().update(walkCamera());
    // Somewhere just past the edge: a point is out, but a person's worth of radius
    // around that point reaches in. That margin is the whole reason radius exists.
    let edge = 0;
    for (let x = 0; x < 40; x += 0.05) {
      if (!view.sees(x, -10, 0.001)) { edge = x; break; }
    }
    expect(edge, 'never found the edge of the screen').toBeGreaterThan(1);
    expect(view.sees(edge + 0.2, -10, RADIUS), 'a person straddling the edge is drawn').toBe(true);
  });

  it('follows the camera when it moves', () => {
    const camera = walkCamera();
    const view = new Viewport();
    view.update(camera);
    expect(view.sees(0, -5, RADIUS)).toBe(true);
    expect(view.sees(0, 5, RADIUS)).toBe(false);
    // Turn round. Without updateMatrixWorld inside update(), this keeps the old answer.
    camera.lookAt(0, 1, 10);
    view.update(camera);
    expect(view.sees(0, 5, RADIUS), 'turned to face them and still cannot see them').toBe(true);
    expect(view.sees(0, -5, RADIUS), 'turned away and still drawing them').toBe(false);
  });

  it('draws everybody it can see when they fit', () => {
    const view = new Viewport().update(walkCamera());
    const people = [at(0, -5), at(1, -6), at(-1, -7), at(0, 8)];   // the last is behind
    const out: (typeof people)[number][] = [];
    const n = visible(people, view, out, { limit: 64, radius: RADIUS, fx: 0, fz: -5 });
    expect(n).toBe(3);
    expect(out.map((p) => p.ref)).not.toContain('0,8');
  });

  it('never asks for more slots than there are, and keeps the nearest', () => {
    const view = new Viewport().update(walkCamera());
    // Twenty people in a line ahead, all on screen.
    const people = Array.from({ length: 20 }, (_, i) => at(0, -2 - i * 0.5, `p${i}`));
    const out: (typeof people)[number][] = [];
    const n = visible(people, view, out, { limit: 5, radius: RADIUS, fx: 0, fz: -2 });
    expect(n).toBe(5);
    expect(out).toHaveLength(5);
    // The five closest to what the screen is centred on, not the first five in the list.
    expect(out.map((p) => p.ref)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    // ...and centring somewhere else picks a different five.
    visible(people, view, out, { limit: 5, radius: RADIUS, fx: 0, fz: -10 });
    expect(out.map((p) => p.ref)).toEqual(['p16', 'p15', 'p17', 'p14', 'p18']);
  });

  it('is the big win it was built for: two hundred people, a handful drawn', () => {
    // THE CASE THIS IS FOR. A park with two hundred people in it, spread over a
    // hundred units. Only the ones the camera is pointed at should cost anything.
    const view = new Viewport().update(walkCamera());
    const people: Placed[] = [];
    for (let i = 0; i < 200; i++) {
      const angle = (i / 200) * Math.PI * 2;
      people.push({ x: Math.cos(angle) * 50, z: Math.sin(angle) * 50 });
    }
    const out: Placed[] = [];
    const n = visible(people, view, out, { limit: 64, radius: RADIUS, fx: 0, fz: -10 });
    expect(n, 'a ring of two hundred, only the arc ahead is drawn').toBeLessThan(40);
    expect(n, 'and it is not drawing nobody').toBeGreaterThan(0);
  });

  it('can be told to ignore somebody entirely', () => {
    const view = new Viewport().update(walkCamera());
    const people = [at(0, -5, 'here'), at(1, -5, 'gone')];
    const out: (typeof people)[number][] = [];
    const n = visible(people, view, out, {
      limit: 64, radius: RADIUS, fx: 0, fz: -5, keep: (p) => p.ref !== 'gone',
    });
    expect(n).toBe(1);
    expect(out[0]!.ref).toBe('here');
  });

  it('asks for nothing when there are no slots', () => {
    const view = new Viewport().update(walkCamera());
    const out: Placed[] = [];
    expect(visible([at(0, -5)], view, out, { limit: 0, radius: RADIUS, fx: 0, fz: 0 })).toBe(0);
    expect(out).toHaveLength(0);
  });
});

/**
 * A tap on somebody drawn by the graphics chip.
 *
 * THE BUG THIS EXISTS FOR. The crowd is placed in the vertex shader (crowd-gpu.ts), so
 * there is no mesh where anybody stands and three's raycast finds nobody: every person
 * in the town would be untappable, and tapping somebody is how you open their card.
 *
 * Negative control, run 2026-09-28 and restored byte-identical: keep the first ball
 * the ray crosses instead of the nearest -> "the one in front" fails.
 */
describe('tapping somebody', () => {
  const H = 0.215;
  const tap = (camera: THREE.Camera, x: number, y: number) => {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(x, y), camera);
    return r.ray;
  };
  const hit = new THREE.Vector3();

  it('lands on the person under the finger', () => {
    const c = walkCamera();
    c.position.set(0, H / 2, 0); c.lookAt(0, H / 2, -10); c.updateMatrixWorld();
    const people = [at(3, -6), at(0, -4), at(-3, -6)];
    expect(pickAlong(tap(c, 0, 0), people, people.length, H, hit)).toBe(1);
    expect(hit.z).toBeGreaterThan(-4.2);
    expect(hit.z).toBeLessThan(-3.8);
  });

  it('lands on the one in front when two stand in a line', () => {
    const c = walkCamera();
    c.position.set(0, H / 2, 0); c.lookAt(0, H / 2, -10); c.updateMatrixWorld();
    const people = [at(0, -9), at(0, -5), at(0, -7)];
    expect(pickAlong(tap(c, 0, 0), people, people.length, H, hit)).toBe(1);
  });

  it('lands on nobody when the finger is on the grass', () => {
    const c = walkCamera();
    const people = [at(3, -6), at(-3, -6)];
    expect(pickAlong(tap(c, 0, -0.9), people, people.length, H, hit)).toBe(-1);
  });

  it('never lands on somebody who was not drawn', () => {
    // Only people[0..count) have a body this frame; the rest are past the last
    // level's cap, and a tap must not open the card of somebody you cannot see.
    const c = walkCamera();
    c.position.set(0, H / 2, 0); c.lookAt(0, H / 2, -10); c.updateMatrixWorld();
    const people = [at(5, -6), at(0, -4)];
    expect(pickAlong(tap(c, 0, 0), people, 1, H, hit)).toBe(-1);
  });
});

/**
 * Nearest first, without a comparator.
 *
 * THE BUG THIS EXISTS FOR. Sorting the people on screen with Array.sort and a
 * comparator was most of a 6.7 ms step with the city's test crowd zoomed out (1,042
 * people, the Seeker, 2026-09-29). nearestFirst packs each distance and place into one
 * number and lets a Float64Array sort them natively. Same order, ties kept in place.
 *
 * Negative control, run 2026-09-29 and restored byte-identical: pack the place first
 * and the distance second -> "the same order a comparator gives" fails.
 */
describe('nearest first', () => {
  const people = Array.from({ length: 500 }, (_, i) => at(((i * 7919) % 211) - 105, ((i * 104729) % 197) - 98, `p${i}`));

  it('gives the same order a comparator gives, ties kept in place', () => {
    const ours = people.slice();
    nearestFirst(ours, ours.length, 3, -4, { keys: new Float64Array(0), people: [] });
    const d = (p: Placed) => Math.floor(((p.x - 3) ** 2 + (p.z + 4) ** 2) * 16);
    const theirs = people.slice().sort((a, b) => d(a) - d(b));   // Array.sort is stable
    expect(ours.map((p) => p.ref)).toEqual(theirs.map((p) => p.ref));
  });

  it('orders only the first n, and reuses its scratch', () => {
    const ours = people.slice();
    const scratch = { keys: new Float64Array(0), people: [] as typeof people };
    nearestFirst(ours, 100, 0, 0, scratch);
    expect(ours.slice(100)).toEqual(people.slice(100));
    const keys = scratch.keys;
    nearestFirst(ours, 50, 0, 0, scratch);
    expect(scratch.keys).toBe(keys);
    const dist = (p: Placed) => p.x ** 2 + p.z ** 2;
    for (let i = 1; i < 100; i++) expect(dist(ours[i]!)).toBeGreaterThanOrEqual(dist(ours[i - 1]!) - 0.07);
  });

  it('still orders a crowd too big to pack', () => {
    const many = Array.from({ length: 5000 }, (_, i) => at(5000 - i, 0, `m${i}`));
    nearestFirst(many, many.length, 0, 0, { keys: new Float64Array(0), people: [] });
    expect(many[0]!.ref).toBe('m4999');
    expect(many[4999]!.ref).toBe('m0');
  });
});
