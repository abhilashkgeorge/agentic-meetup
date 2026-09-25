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
export interface OrthographicBounds { left: number; right: number; top: number; bottom: number; zoom: number }
export type Band = 'city' | 'mid' | 'near';

/**
 * WALKING IT YOURSELF -- the camera just behind your agent's head.
 *
 * Everything else here is an orthographic map seen from a fixed compass bearing.
 * This is the other thing entirely: a perspective camera a step behind the shoulder,
 * turning with them, which is the view every third-person game uses and the one the
 * founder asked for by name (2026-09-22). The numbers are in scene units against an
 * agent drawn about 0.24 tall (PERSON in canvas.tsx). At this lens a person fills
 * about a seventh of the screen height, which is where a third-person game puts one:
 * close enough to read their character, far enough to see the street they are walking
 * down. The first cut sat 0.58 back and the agent filled half the frame with a
 * building wall behind it -- you were looking at the back of a head, not at a city.
 *
 * THE RISE IS SET BY THE ROOFS, not by taste. A block on this map is 550 metres
 * across and the gaps between them are narrower than the camera needs, so a lens at
 * shoulder height has a wall behind it nearly everywhere and spends its life being
 * pulled in. At 0.95 it is above the middle of the range of building heights, sees
 * over most of them, and only gives way to the genuinely tall ones -- which is both
 * the steadier picture and the one where you can see where you are going.
 */
export const WALK_BACK = 1.45;
export const WALK_RISE = 0.95;
export const WALK_AIM = 1.6;
export const WALK_EYE = 0.22;
export const WALK_FOV = 62;

export interface Follow { eye: [number, number, number]; look: [number, number, number] }

/**
 * Where that camera sits, and what it points at, for somebody at (x, z) facing `yaw`.
 *
 * `aim` is how far in front of them the camera looks. At full distance that is well
 * down the street, which is what puts them low in frame with the road ahead. Pulled
 * in against a wall it has to come back toward them, or the camera is a hand's width
 * behind somebody while staring at the building in front of them.
 */
export function followPose(x: number, z: number, yaw: number, back = WALK_BACK, rise = WALK_RISE, aim = WALK_AIM): Follow {
  const fx = Math.sin(yaw); const fz = Math.cos(yaw);
  return {
    eye: [x - fx * back, rise, z - fz * back],
    look: [x + fx * aim, WALK_EYE, z + fz * aim],
  };
}

/**
 * Where the stick points, in the world. `jx` is right and `jy` is DOWN, the way a
 * screen measures; up on the stick is away from the camera, which is what a thumb
 * expects and is why this needs the camera's bearing rather than the agent's.
 *
 * Screen right for a camera looking along (sin y, 0, cos y) is (-cos y, 0, sin y) --
 * three builds its basis from `cross(up, eye - target)`, so it is not the (cos, -sin)
 * that the right-hand rule suggests at a glance. Getting that backwards mirrors the
 * controls, which is the sort of thing a test is for.
 */
export function driveVector(jx: number, jy: number, camYaw: number): [number, number] {
  const s = Math.sin(camYaw); const c = Math.cos(camYaw);
  return [-s * jy - c * jx, -c * jy + s * jx];
}

/**
 * The shortest way round from one bearing to another, for turning the camera, kept
 * inside a single turn. Without the wrap the answer is still right to a sine and a
 * cosine but grows without bound -- it read 77 radians after half a minute of
 * walking, which is unreadable in a log and eventually loses precision.
 */
export function turnToward(from: number, to: number, t: number): number {
  const wrap = (a: number) => {
    const m = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return m - Math.PI;
  };
  let d = wrap(to - from);
  return wrap(from + d * Math.min(1, Math.max(0, t)));
}

/** What the HUD may ask of the camera without touching the lazy renderer. */
export interface WorldControl {
  /** Fly to a neighbourhood and stay there (the camera stops following your agent). */
  flyTo(areaId: string): void;
  /** Frame a point of interest before an explicit transition enters it. */
  flyToPoint(x: number, z: number, zoom?: number): void;
  /** Fly to your own neighbourhood and follow your agent again. */
  flyHome(): void;
  /** Pull out to the whole city. */
  flyCity(): void;
  /** Walk your agent yourself, with the camera behind its head. */
  setWalking(on: boolean): void;
}

const SQ2 = Math.SQRT2;

/**
 * A pixel-sized base frustum makes Three's orthographic `zoom` use the same contract
 * as every pure camera function here: one world unit covers `zoom` screen pixels.
 */
export function orthographicBounds(size: Size, zoom: number): OrthographicBounds {
  return {
    left: -size.width / 2,
    right: size.width / 2,
    top: size.height / 2,
    bottom: -size.height / 2,
    zoom,
  };
}

/**
 * HOW FAR ABOVE THE GROUND THE CAMERA SITS, in radians above the horizon.
 *
 * Zoomed out this is the classic isometric 35.26° -- eye at (1,1,1) -- which is what
 * a map wants: you see the shape of the city and very little of the sides of things.
 * Down in the streets that reads as a floor plan, and the founder said so: "why is it
 * a top view . give it a third person view of the world . from the side .like how most
 * of the video games look" (2026-09-22).
 *
 * 27° is where that lands. It is a three-quarter view: you see the fronts of the
 * buildings and the street between them, which is what the ask was, while still
 * seeing over the low ones to the people behind. 19° was tried first and is the
 * angle an actual third-person game uses -- but those put one character in the
 * foreground under a perspective lens, and an orthographic city at 19° is a wall of
 * facades with everybody hidden behind the first row.
 *
 * It eases between the two with the zoom, so pinching in tips the world toward you.
 */
export const CITY_ELEVATION = Math.atan(1 / SQ2);
export const STREET_ELEVATION = 0.47;

/**
 * How much of a ground step toward the horizon shows as screen height: sin(elevation)
 * over root two. At the isometric angle it is the familiar 1/root 6 = 0.408; flat on
 * would be 0. Every screen/ground conversion here takes it, so one number decides the
 * angle and nothing else has an opinion about it.
 */
export const verticalOf = (elevation: number): number => Math.sin(elevation) / SQ2;
export const ISO_VERTICAL = verticalOf(CITY_ELEVATION);

/** Closest the camera comes: a person fills about a tenth of the screen. */
export const ZOOM_MAX = 340;
/** At or past this, you are down in the streets rather than over the neighbourhood. */
export const ZOOM_NEAR = 70;
/** Above this multiple of the city zoom the labels go and the tiles are the unit. */
export const CITY_BAND = 1.3;
/** The fly, in seconds. */
export const FLY_SECS = 0.6;

/** Screen offset (pixels from the centre) of a ground offset (dx, dz) from the target. */
export function toScreenOffset(dx: number, dz: number, zoom: number, vert = ISO_VERTICAL): [number, number] {
  return [(zoom * (dx - dz)) / SQ2, zoom * (dx + dz) * vert];
}

/** Ground offset from the target of a screen offset (pixels from the centre). */
export function fromScreenOffset(sx: number, sy: number, zoom: number, vert = ISO_VERTICAL): [number, number] {
  const a = (sx * SQ2) / zoom; const b = sy / (zoom * vert);
  return [(a + b) / 2, (b - a) / 2];
}

export function toScreen(x: number, z: number, pose: Pose, size: Size, vert = ISO_VERTICAL): [number, number] {
  const [sx, sy] = toScreenOffset(x - pose.tx, z - pose.tz, pose.zoom, vert);
  return [size.width / 2 + sx, size.height / 2 + sy];
}

export function fromScreen(px: number, py: number, pose: Pose, size: Size, vert = ISO_VERTICAL): [number, number] {
  const [dx, dz] = fromScreenOffset(px - size.width / 2, py - size.height / 2, pose.zoom, vert);
  return [pose.tx + dx, pose.tz + dz];
}

/**
 * The angle for a zoom: the map's angle out at the city, a game's angle in the
 * streets, eased between on a log scale so a pinch tips the world smoothly.
 */
export function elevationFor(zoom: number, cityZoom: number): number {
  const top = Math.log(Math.max(cityZoom, 1e-3));
  const bottom = Math.log(ZOOM_NEAR);
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(zoom, 1e-3)) - top) / Math.max(1e-6, bottom - top)));
  return CITY_ELEVATION + (STREET_ELEVATION - CITY_ELEVATION) * t;
}

/** Where the camera sits relative to what it looks at, for a given angle and distance. */
export function eyeOffset(elevation: number, distance: number): [number, number, number] {
  const flat = (Math.cos(elevation) / SQ2) * distance;
  return [flat, Math.sin(elevation) * distance, flat];
}

/** Drag the ground by (dx, dy) pixels: whatever was under the finger stays under it. */
export function pan(pose: Pose, dx: number, dy: number, vert = ISO_VERTICAL): Pose {
  const [gx, gz] = fromScreenOffset(dx, dy, pose.zoom, vert);
  return { tx: pose.tx - gx, tz: pose.tz - gz, zoom: pose.zoom };
}

/** Scale the zoom about a screen point: the ground under the fingers' midpoint stays put. */
export function pinch(pose: Pose, mid: [number, number], scale: number, size: Size, zoomMin: number, zoomMax = ZOOM_MAX, vert = ISO_VERTICAL): Pose {
  const zoom = Math.min(zoomMax, Math.max(zoomMin, pose.zoom * scale));
  const [gx, gz] = fromScreen(mid[0], mid[1], pose, size, vert);
  const [ox, oz] = fromScreenOffset(mid[0] - size.width / 2, mid[1] - size.height / 2, zoom, vert);
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

/**
 * The zoom that fills the screen's shorter side with a tile of this radius, kept
 * tappable. Capped at 30, not 40: a small tile like MG Road wanted 50 and was clamped
 * to 40, which dropped the camera in among the buildings so you saw three of them and
 * none of the neighbourhood (on the phone, 2026-09-22). At 30 a person is about
 * forty-five pixels tall, which is still a comfortable thumb target.
 */
export function tileZoom(radius: number, size: Size): number {
  const fit = Math.min(size.width, size.height) / (2 * Math.max(0.5, radius));
  return Math.min(30, Math.max(18, fit));
}

export function bandOf(zoom: number, cityZoom: number): Band {
  if (zoom <= cityZoom * CITY_BAND) return 'city';
  if (zoom >= ZOOM_NEAR) return 'near';
  return 'mid';
}

/** How tall a person is on the ground, in world units: 1.5 x the 0.16 body scale. */
const PERSON_UNITS = 0.24;
/** Below this many pixels tall, a rig is indistinguishable from a capsule. */
const RIG_FLOOR_PX = 4;
/** ...and by this many it is worth every triangle. */
const RIG_FULL_PX = 18;

/**
 * How many people are worth drawing as real rigged characters at this zoom.
 *
 * A RIG IS NOT FREE AND IT IS NOT SMALL: one draw call and about five thousand
 * triangles each, plus a walk up its whole bone tree every frame, because a person
 * with bones cannot be instanced. Twenty-four of them is a hundred and twenty thousand
 * triangles and twenty-four draw calls -- and on expo-gl a draw call is not a GPU cost
 * at all, it is a pile of commands marshalled across the JS/native bridge. That is why
 * the city view sat at 29 fps with a p95 of 38 ms and 14% of frames janky while
 * `dumpsys gfxinfo` had the UI thread idle at 11 ms: the phone was not drawing, it was
 * talking (Pixel 6a, 2026-09-23 -- 89 draw calls, 242 K triangles).
 *
 * THE MEASURE IS HOW BIG A PERSON IS ON THE SCREEN, not which zoom band we are in.
 * Bands are three steps and the step landed in the wrong place: the default street
 * view sits at zoom 55, which is `mid`, so a banded budget quietly halved the quality
 * of the view people actually use. Pixels are the thing that decides whether a rig can
 * be told from a capsule, so pixels are what this counts. Pulled out to the whole city
 * a person is a pixel and a half and gets nothing.
 *
 * Everyone is still there whatever this returns: the instanced capsules draw all
 * sixty-four in one call, and the discs, rings and bubbles never stopped.
 */
export function rigsFor(zoom: number, max = 24): number {
  const px = PERSON_UNITS * zoom;
  if (px < RIG_FLOOR_PX) return 0;
  const t = (px - RIG_FLOOR_PX) / (RIG_FULL_PX - RIG_FLOOR_PX);
  return Math.max(1, Math.min(max, Math.round(max * t)));
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

/** type.label: 11 px medium with 1.1 px tracking is about 8 px a character. */
const LABEL_CHAR = 8;
const LABEL_H = 16;

/**
 * Names that do not print on top of each other: the bigger tile wins its spot and a
 * smaller neighbour whose name would cross it stays quiet. The six small tiles round
 * MG Road printed six names in one place (on the Seeker, 2026-09-21); tapping a tile
 * still flies there and the chip still says where you are.
 */
export function placeLabels<T extends { name: string; radius: number; at: readonly [number, number] }>(all: readonly T[]): T[] {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const out: T[] = [];
  for (const l of [...all].sort((a, b) => b.radius - a.radius)) {
    const w = l.name.length * LABEL_CHAR;
    const box = { x0: l.at[0] - w / 2, x1: l.at[0] + w / 2, y0: l.at[1] - LABEL_H / 2, y1: l.at[1] + LABEL_H / 2 };
    if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
    placed.push(box); out.push(l);
  }
  return out;
}
