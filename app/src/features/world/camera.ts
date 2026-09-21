/**
 * The camera over the city -- the pure half.
 *
 * An orthographic camera on the isometric diagonal (eye = target + (E, E, E)) never
 * turns, so where a ground point lands on the screen is a fixed linear map of its
 * offset from the target, scaled by the zoom: this file is that map and its inverse,
 * and the pan, pinch, clamp and fly built on them. No three, no react-native, so the
 * tests run the same maths the phone does. canvas.tsx owns the state and calls in.
 *
 *   screen-right on the ground  R = ( 1, -1) / √2
 *   up the screen on the ground F = (-1, -1) / √2, foreshortened by 2/√12 = 0.577
 *
 * One world unit along R is `zoom` pixels; one along F is 0.577·zoom pixels.
 */

export interface Size { width: number; height: number }
export interface Pose { tx: number; tz: number; zoom: number }
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export type Band = 'city' | 'mid' | 'near';

/** What the HUD may ask of the camera without touching the lazy renderer. */
export interface WorldControl {
  /** Fly to a neighbourhood and stay there (the camera stops following your agent). */
  flyTo(areaId: string): void;
  /** Fly to your own neighbourhood and follow your agent again. */
  flyHome(): void;
  /** Pull out to the whole city. */
  flyCity(): void;
}

const SQ2 = Math.SQRT2;
const SQ6 = Math.sqrt(6);

/** Closest the camera comes: an agent is about fifty pixels tall. */
export const ZOOM_MAX = 44;
/** The band a tile is looked at in. */
export const ZOOM_NEAR = 22;
/** Above this multiple of the city zoom the labels go and the tiles are the unit. */
export const CITY_BAND = 1.3;
/** The fly, in seconds. */
export const FLY_SECS = 0.6;

/** Screen offset (pixels from the centre) of a ground offset (dx, dz) from the target. */
export function toScreenOffset(dx: number, dz: number, zoom: number): [number, number] {
  return [(zoom * (dx - dz)) / SQ2, (zoom * (dx + dz)) / SQ6];
}

/** Ground offset from the target of a screen offset (pixels from the centre). */
export function fromScreenOffset(sx: number, sy: number, zoom: number): [number, number] {
  const a = (sx * SQ2) / zoom; const b = (sy * SQ6) / zoom;
  return [(a + b) / 2, (b - a) / 2];
}

export function toScreen(x: number, z: number, pose: Pose, size: Size): [number, number] {
  const [sx, sy] = toScreenOffset(x - pose.tx, z - pose.tz, pose.zoom);
  return [size.width / 2 + sx, size.height / 2 + sy];
}

export function fromScreen(px: number, py: number, pose: Pose, size: Size): [number, number] {
  const [dx, dz] = fromScreenOffset(px - size.width / 2, py - size.height / 2, pose.zoom);
  return [pose.tx + dx, pose.tz + dz];
}

/** Drag the ground by (dx, dy) pixels: whatever was under the finger stays under it. */
export function pan(pose: Pose, dx: number, dy: number): Pose {
  const [gx, gz] = fromScreenOffset(dx, dy, pose.zoom);
  return { tx: pose.tx - gx, tz: pose.tz - gz, zoom: pose.zoom };
}

/** Scale the zoom about a screen point: the ground under the fingers' midpoint stays put. */
export function pinch(pose: Pose, mid: [number, number], scale: number, size: Size, zoomMin: number, zoomMax = ZOOM_MAX): Pose {
  const zoom = Math.min(zoomMax, Math.max(zoomMin, pose.zoom * scale));
  const [gx, gz] = fromScreen(mid[0], mid[1], pose, size);
  const [ox, oz] = fromScreenOffset(mid[0] - size.width / 2, mid[1] - size.height / 2, zoom);
  return { tx: gx - ox, tz: gz - oz, zoom };
}

/** Keep the target over the city: nothing to see past its edge. */
export function clampTarget(pose: Pose, bounds: Bounds): Pose {
  return {
    tx: Math.min(bounds.maxX, Math.max(bounds.minX, pose.tx)),
    tz: Math.min(bounds.maxZ, Math.max(bounds.minZ, pose.tz)),
    zoom: pose.zoom,
  };
}

/**
 * The pose that shows the whole outline between the HUD's top and bottom insets:
 * the zoom that fits it, and the target that centres it in the free band.
 */
export function cityPose(outline: readonly (readonly [number, number])[], size: Size, insets: { top: number; bottom: number; side: number }): Pose {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [x, z] of outline) {
    const [u, v] = toScreenOffset(x, z, 1);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const freeW = Math.max(1, size.width - 2 * insets.side);
  const freeH = Math.max(1, size.height - insets.top - insets.bottom);
  const zoom = Math.min(freeW / Math.max(1e-6, maxU - minU), freeH / Math.max(1e-6, maxV - minV));
  // The ground point at the middle of the outline's screen extent...
  const [gx, gz] = fromScreenOffset((minU + maxU) / 2, (minV + maxV) / 2, 1);
  // ...should land at the middle of the free band, not the middle of the screen.
  const cy = (insets.top + size.height - insets.bottom) / 2;
  const [ox, oz] = fromScreenOffset(0, cy - size.height / 2, zoom);
  return { tx: gx - ox, tz: gz - oz, zoom };
}

/** The zoom that fills the screen's shorter side with a tile of this radius, kept tappable. */
export function tileZoom(radius: number, size: Size): number {
  const fit = Math.min(size.width, size.height) / (2 * Math.max(0.5, radius));
  return Math.min(40, Math.max(24, fit));
}

export function bandOf(zoom: number, cityZoom: number): Band {
  if (zoom <= cityZoom * CITY_BAND) return 'city';
  if (zoom >= ZOOM_NEAR) return 'near';
  return 'mid';
}

export interface Fly { from: Pose; to: Pose; start: number; secs: number }

/** Ease-out cubic on the target and on log(zoom), so a zoom feels even. */
export function flyAt(fly: Fly, now: number): { pose: Pose; done: boolean } {
  const s = Math.min(1, Math.max(0, (now - fly.start) / fly.secs));
  const e = 1 - (1 - s) ** 3;
  const lz = Math.log(fly.from.zoom) + (Math.log(fly.to.zoom) - Math.log(fly.from.zoom)) * e;
  const pose = s >= 1 ? { ...fly.to } : s <= 0 ? { ...fly.from }
    : { tx: fly.from.tx + (fly.to.tx - fly.from.tx) * e, tz: fly.from.tz + (fly.to.tz - fly.from.tz) * e, zoom: Math.exp(lz) };
  return { pose, done: s >= 1 };
}
