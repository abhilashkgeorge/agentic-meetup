/**
 * Who is worth drawing this frame.
 *
 * THE BUG THIS EXISTS FOR, measured on a Pixel 6a on 2026-09-22. The town allocated
 * sixty-four people slots and drew all sixty-four every single frame, whether those
 * people existed, stood behind the camera, or were on the far side of Bengaluru.
 * Culling was explicitly switched off on every one of them. The proof was in the
 * benchmark: running it with forty-eight people and with sixty-four produced identical
 * numbers to the digit -- 45 draw calls, 205,044 triangles, both times.
 *
 * Of those 205,044 triangles, the city was 41,972. The other 163,072 -- eighty percent
 * of the frame -- was people slots, most of them empty.
 *
 * That is what this fixes. It answers one question, "can the camera see somebody
 * standing here?", and the renderer uses the answer to draw only those people and to
 * tell the graphics card how many slots are really in use. With two hundred people in
 * a park and fifteen on screen, fifteen get drawn.
 *
 * It imports three but nothing else, so it is exercised by a real test with a real
 * camera and no phone in the room. See tests/visible.test.ts.
 */
import * as THREE from 'three';

export interface Placed {
  readonly x: number;
  readonly z: number;
}

/**
 * What the camera can see, recomputed once a frame.
 *
 * Kept as an object with reusable scratch so the frame loop allocates nothing, which
 * is the rule the rest of the renderer already follows.
 */
export class Viewport {
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  /**
   * Point this at the camera. MUST be called after the camera has been moved for the
   * frame and before anything is asked of it.
   *
   * `updateMatrixWorld` is not optional: react-three-fiber updates the camera during
   * the render, which happens AFTER the frame callback, so without this the frustum
   * is built from where the camera was last frame. Behind-the-camera people then
   * survive a turn longer than they should, which is exactly the sort of thing that
   * looks like nothing at all until somebody spins on the spot.
   */
  update(camera: THREE.Camera): this {
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    return this;
  }

  /**
   * Can the camera see a person standing here?
   *
   * `radius` is deliberately bigger than a person: it has to cover what they carry --
   * the disc at their feet, the speech bubble over their head -- and it buys a margin
   * so somebody walking in from the side is already drawn by the time their shoulder
   * would appear, rather than popping into existence at the screen edge.
   */
  sees(x: number, z: number, radius: number): boolean {
    this.sphere.center.set(x, radius * 0.5, z);
    this.sphere.radius = radius;
    return this.frustum.intersectsSphere(this.sphere);
  }
}

/**
 * Fill `out` with the people the camera can see, nearest to the middle of the screen
 * first when there are more of them than there are slots to draw them in.
 *
 * Returns how many were written. `out` is reused between frames and is only ever
 * truncated, never reallocated.
 */
export function visible<T extends Placed>(
  people: readonly T[],
  view: Viewport,
  out: T[],
  opts: { limit: number; radius: number; fx: number; fz: number; keep?: (p: T) => boolean },
): number {
  const { limit, radius, fx, fz, keep } = opts;
  out.length = 0;
  if (limit <= 0) return 0;
  for (const p of people) {
    if (keep && !keep(p)) continue;
    if (!view.sees(p.x, p.z, radius)) continue;
    out.push(p);
  }
  if (out.length > limit) {
    // Only when there are too many, because sorting every frame for a crowd that fits
    // is work for nothing. Nearest to what the screen is centred on wins: those are
    // the people somebody is actually looking at.
    out.sort((a, b) =>
      ((a.x - fx) ** 2 + (a.z - fz) ** 2) - ((b.x - fx) ** 2 + (b.z - fz) ** 2));
    out.length = limit;
  }
  return out.length;
}
