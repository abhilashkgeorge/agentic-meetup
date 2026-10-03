/**
 * The town, drawn.
 *
 * THIS IS THE ONLY FILE THAT IMPORTS three AND r3f AT THE TOP, and it is only ever
 * reached through `loadWorldRenderer()` in ./r3f.ts. Import it statically from a screen
 * and tests/native-imports.test.ts fails the build, on purpose.
 *
 * Budget, and why it is shaped like this: draw calls are what a phone pays for (on
 * expo-gl each one is a pile of commands carried across to native), so everything
 * that repeats is instanced. No textures, no shadows, Lambert lighting. The modernised
 * city (./map-mesh.ts) is seventeen meshes and 42–48 K triangles, built once and never
 * touched per frame except the water's opacity; the bench (features/dev/gl-bench.tsx)
 * is what says whether a change holds.
 *
 * PEOPLE ARE REAL BODIES, NOT CAPSULES. Everybody the camera can see is a walking body
 * drawn by the graphics chip (./crowd-gpu.ts): four draw calls for the whole crowd at
 * four levels of detail, animation baked, outfits picked in the shader, a few numbers
 * a person written per frame. The capsules below -- one instanced mesh per body part,
 * a translucent twin for practice profiles -- are only the fallback for a phone that
 * cannot read the model. Everything that says who somebody IS -- the disc at their
 * feet, the speech bubble, the ring -- is drawn for the people it is true of, packed,
 * so a crowd of strangers costs nothing there.
 *
 * In the park a mist hides everything past VIEW (./camera.ts), and past it nothing is
 * drawn: people, trees, benches.
 *
 * The camera follows your agent, softly, so a walk to Whitefield is a walk you watch,
 * until a finger takes over: drag to pan, pinch to zoom, tap a tile to fly there, and
 * the HUD's Home to come back and follow again. The gestures live on a View wrapped
 * round the GL canvas that captures a touch once it moves (or has two fingers), so
 * r3f still gets the taps -- its own responder yields on request and calls a touch
 * under twenty pixels a click. The maths is in ./camera.ts, pure and tested.
 *
 * The frame loop touches no React state. The spike's lesson, verbatim: "touching React
 * state per frame would measure React, not the renderer."
 */
import { Canvas, advance, useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { LogBox, PanResponder, View, type LayoutChangeEvent } from 'react-native';
import * as THREE from 'three';
import { CENTRAL_AREA, HAIR_HEX, HEIGHT_SCALE, OUTFIT_HEX, PARK_SIGHTS, SKIN_HEX, pointInPolygon, type Look } from '@clone/shared';
import {
  CITY_BAND, FLY_SECS, MIST_NEAR, PERSON, VIEW, WALK_AIM, WALK_BACK, WALK_EYE, WALK_FOV, WALK_RISE, ZOOM_MAX, bandOf, benchFrame, cityPose, clampTarget,
  driveVector, groundReach, mapDistance,
  elevationFor, eyeOffset, flyAt, followPose, orthographicBounds, pan, pinch, tileZoom, turnToward, verticalOf,
  type Band, type Bounds, type Fly, type Pose, type Size, type WorldControl,
} from './camera';
import { MODEL_SCALE } from './character-mesh';
import { startVsync, stopVsync } from './vsync-clock';
import { loadGpuCrowd, type CrowdFrame, type GpuCrowd } from './crowd-gpu';
import { honourSubDataRanges } from './gl-subdata';
import { hairOf, skirtOf, topOf } from '../look/silhouette';
import { buildGarden, skyFollow } from './garden-mesh';

import { MAP, type Frame } from './map';
import { buildMap } from './map-mesh';
import type { SimAgent, WorldSim } from './sim';
import { Viewport, nearestFirst, pickAlong, visible } from './visible';
import { buildRigs } from './rig-mesh';
import { flightShot } from './flight';
import { BIKE_PACE } from './bike';
import { buildBike } from './bike-mesh';
import { buildScale } from './character';
import { RING_COLOR, ringShown, sightsToMark, useParkLive } from './park-live';
import type { CityPlan } from './city-plan';
import { buildCity, type BuiltCity } from './city-mesh';
import { CUBBON_PARK, venueGarden, type Venue } from './venue';
import { loadVenueFurniture, type BuiltVenueFurniture } from './venue-mesh';

/** The middle of a person, off their feet, in world units (a person is 0.215 tall). */
const SIGHT_MIDDLE = 0.11;

/**
 * Two warnings three.js prints for every canvas, about itself, that nothing here can act on:
 * @react-three/fiber still makes a THREE.Clock (deprecated upstream), and expo-gl offers no
 * WEBGL_lose_context to give the context back with. In a debug build each start put "Open
 * debugger to view warnings" over the Send button and the tabs (on the Pixel, 2026-09-30).
 * Only the toast goes: the lines still reach the terminal.
 */
export const THREE_NOISE = [/THREE\.Clock: This module has been deprecated/, /WEBGL_lose_context extension not supported/];
LogBox.ignoreLogs(THREE_NOISE);

export interface WorldColors {
  bg: string;
  ground: string;
  /** The highlight white: roads and blocks on the map. */
  light: string;
  prop: string;
  you: string;
  stranger: string;
  met: string;
  practice: string;
  success: string;
  danger: string;
  warning: string;
  accent: string;
  /** Evening: the map lights its lamps and windows. */
  night: boolean;
}

export interface WorldStats {
  fps: number;
  p50: number;
  p95: number;
  worst: number;
  drawCalls: number;
  triangles: number;
  elapsed: number;
  /** fps over the first 5 s vs the most recent 5 s. A gap is thermal throttling. */
  earlyFps: number;
  lateFps: number;
}

export interface WorldCanvasProps {
  sim: WorldSim;
  colors: WorldColors;
  /** Render at 30 Hz on demand instead of every vsync. */
  cap30?: boolean;
  /** False when the tab is not on screen: the loop stops and the GPU rests. */
  active?: boolean;
  onStats?: (s: WorldStats) => void;
  onTapAgent?: (ref: string) => void;
  /** Called once, on the first drawn frame. The fuse in storage is cleared on it. */
  onFirstFrame?: () => void;
  /** The HUD's handle on the camera. Filled while mounted, null otherwise. */
  control?: MutableRefObject<WorldControl | null>;
  /** The zoom band changed, after any fly has landed: city (labels on), mid, near. */
  onBand?: (band: Band) => void;
  /** What the HUD covers at the top and bottom: the whole city is centred between. */
  frame?: Frame;
  /**
   * The on-screen stick, written by the HUD and read once a frame: x right, y DOWN,
   * each -1..1. A ref, not a prop, because a thumb moves sixty times a second and
   * none of those should render anything.
   */
  stick?: MutableRefObject<{ x: number; y: number }>;
  /** Told when walking starts and stops, so the HUD can show the stick. */
  onWalking?: (on: boolean) => void;
  /** Controlled realm state, so a GL remount returns to the venue it was showing. */
  inVenue?: boolean;
  /** A real date-place marker was tapped on the overview map. */
  onTapVenue?: (venueId: string) => void;
  /**
   * The other world. The map is the city -- who is where, and where to send your
   * agent; entering a real venue opens its own local world.
   * Given both, the frame loop steps whichever one you are actually in.
   */
  venueSim?: WorldSim;
  /** The real place represented by the local walkable world. */
  venue?: Venue;
  /**
   * How many people can be on screen at once (SLOTS, 64, by default). Only the park's
   * crowd test raises it: every slot is a row in the markers' buffers, so the everyday
   * town keeps the small number.
   */
  slots?: number;
}

/**
 * How fast your own agent walks with the stick all the way over. A shade brisker than
 * the strollers around you, because you are the one going somewhere -- but still a
 * walk: at 0.62 it was sixteen kilometres an hour.
 */
/**
 * How fast the stick moves you, in a 26-unit garden.
 *
 * SCALED BY THE PLACE. Cubbon Park is 170 units corner to corner, and at this speed
 * that is eleven minutes of holding a thumb down -- which is about what the real walk
 * takes and is nobody's idea of a good time. `walkSpeedFor` gives the real park a
 * brisk walk instead, so crossing it is about five minutes and the landmarks are one
 * to two minutes apart. The seeded gardens are unchanged.
 */
const WALK_SPEED = 0.26;
const walkSpeedFor = (radius: number) => WALK_SPEED * Math.min(2.2, Math.max(1, radius / 26));
/** How quickly the camera swings round behind them: 1 - e^(-k·dt) a frame. */
const TURN = 5;
/** Radians of camera swing per pixel dragged sideways while walking. */
const ORBIT_PER_PX = 0.006;
/**
 * Closest the walking camera is ever pulled in when a wall is behind you: near enough
 * to be over their shoulder. The first cut used 0.3 as the floor AND as the first
 * sample, so it never asked whether 0.3 itself was clear -- stand with your back to a
 * building and the camera sat inside it, drawing one flat grey wall over the whole
 * screen (on the phone, 2026-09-22).
 */
const WALK_MIN_BACK = 0.07;
/** How wide the lens is treated as being, so it keeps off the corners of buildings. */
const CAM_PAD = 0.16;
/**
 * How fast the camera closes on a wall and how slowly it opens out again.
 *
 * It has to come in NOW -- a frame spent inside a building is a frame of grey -- and
 * go back out gently, or every doorway and gap it passes snaps it in and out and the
 * whole picture shakes. That asymmetry is the difference between a camera and a
 * jitter, and without it walking the streets was unwatchable (the founder's word:
 * "very gittery", 2026-09-22).
 */
const BACK_IN = 20;
const BACK_OUT = 3.2;
/**
 * How closely the lens tracks the agent's own position. Not rigidly: sliding along a
 * wall moves them one axis at a time, and a camera bolted to that stutters sideways
 * with every step. A little lag turns that into a follow.
 */
const TRACK = 14;
/** How quickly the camera swings round to the bench view on sitting down, and back. */
const SEAT_SWING = 2.5;
/** How far the stick has to go to get you up off a bench, or off the way to one: half. */
const STAND_PUSH = 0.5;

/** The one you are talking with, as this frame has them: the sim's ring is theirs alone (park-live.ts). */
function shownPartner(sim: WorldSim): SimAgent | undefined {
  for (const a of sim.agents()) if (a.ring && a.kind === 'live') return a;
  return undefined;
}

/**
 * How far behind somebody the camera can sit without being inside a building.
 *
 * Nothing stops an orthographic map camera, but a camera on somebody's shoulder walks
 * into walls: standing in a doorway in MG Road it sat inside the building behind and
 * drew the inside of its wall across the whole screen (on the phone, 2026-09-22).
 * Every game solves this the same way, by pulling the camera in until the line back
 * to the player is clear.
 */
function clearBack(sim: WorldSim, x: number, z: number, yaw: number, want: number): number {
  const fx = Math.sin(yaw); const fz = Math.cos(yaw);
  let ok = WALK_MIN_BACK;
  for (let i = 0; i <= 12; i++) {
    const d = WALK_MIN_BACK + ((want - WALK_MIN_BACK) * i) / 12;
    // At the lens's own height, and dry: a roof below it is not in the way and a lake
    // never is. Asking the walking question instead -- "could somebody stand here?" --
    // pulled the camera in for every bungalow in a city built of them, which is most
    // of what made the picture shake.
    if (!sim.seeThrough(x - fx * d, z - fz * d, WALK_RISE, CAM_PAD)) break;
    ok = d;
  }
  return ok;
}

/**
 * How high the camera rides. Pulled in by a wall it goes UP, not down: from a step
 * behind the shoulder it is at head height, and from right on top of them it is
 * looking over the roofs -- which is the only view left when they are backed into a
 * corner. It used to do the opposite and drop as it came in, which put the lens at
 * ground level inside whatever was behind them.
 */
const riseFor = (back: number): number => WALK_RISE * (1 + 1.1 * (1 - back / WALK_BACK));
/** ...and looks nearer to them, so they stay in frame rather than a wall filling it. */
const aimFor = (back: number): number => WALK_AIM * (0.25 + 0.75 * (back / WALK_BACK));

const DEFAULT_FRAME: Frame = { top: 160, bottom: 100, side: 12 };
const BOUNDS: Bounds = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of MAP.outline) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, maxX, minZ, maxZ };
})();
/**
 * Where the camera starts: in the streets, about a dozen buildings across the screen.
 * At 150 you could see four of them and could not find your own agent; at 85 standing
 * next to a tall one filled the whole screen with its wall. Pinch out for the
 * neighbourhood, and out again for the whole city.
 */
const ZOOM_START = 55;

/**
 * The camera, as a plain mutable object shared by the gesture handlers (on the
 * wrapping View) and the frame loop (inside the canvas). No React state: a drag is
 * sixty updates a second and none of them should render anything.
 */
interface CamState {
  pose: Pose;
  /** Walking it yourself: the stick moves the agent and the camera sits behind its head. */
  walking: boolean;
  /** How far behind the shoulder the lens actually is, eased, never jumped. */
  back: number;
  /** The point the walking lens is tracking: the agent, a fraction of a step behind. */
  at: [number, number] | null;
  /**
   * The camera's own bearing while walking. It is ITS OWN STATE, not an offset from
   * the agent's, and that distinction is the whole thing: the stick steers in the
   * camera's frame and the agent turns to face where it is pushed, so a camera that
   * chases "the agent's facing plus an offset" is chasing a number derived from
   * itself. With any offset at all the two spin round each other for ever -- held
   * forward, the agent turned through 160° and the camera ended up in front of it,
   * filming a wall (on the phone, 2026-09-22). A drag moves this directly; walking
   * eases it back behind them, where the two agree and it settles.
   */
  yaw: number;
  fly: Fly | null;
  /** Follow your agent when nothing else is asked. Off after a drag or a fly elsewhere. */
  follow: boolean;
  followAfterFly: boolean;
  band: Band | null;
  size: Size;
  city: Pose;
  /** Seconds of sim time, so a fly started from a tap has a clock. */
  clock: number;
  lastDx: number; lastDy: number; pinchDist: number | null;
  /** The camera being drawn through, set by the frame loop: what `headOnScreen` projects with. */
  camera?: THREE.Camera;
  /**
   * How far the camera has come round to the bench view, 0 walking to 1 seated
   * (camera.ts benchFrame): eased, so sitting down swings it round rather than cutting.
   */
  seated: number;
  /** The bench view last aimed at: where it eases back from on getting up. */
  bench: { x: number; z: number; facing: number } | null;
  /** Up in the sky drop last frame: on landing the camera turns with you to face them. */
  wasFlying: boolean;
}

function startFly(cam: CamState, to: Pose, followAfter: boolean): void {
  cam.fly = { from: { ...cam.pose }, to: clampTarget(to, BOUNDS), start: cam.clock, secs: FLY_SECS };
  cam.follow = false;
  cam.followAfterFly = followAfter;
}

function flyToArea(cam: CamState, id: string | null, followAfter: boolean): void {
  const area = MAP.areas.find((a) => a.id === id) ?? MAP.areas.find((a) => a.id === 'mg-road') ?? MAP.areas[0]!;
  startFly(cam, { tx: area.home[0], tz: area.home[1], zoom: tileZoom(area.radius, cam.size) }, followAfter);
}

const SLOTS = 64;
const DOTS_PER = 3;

// ── the parts ────────────────────────────────────────────────────────────────

/** Geometry shared by the solid and the ghost sets. Built once per canvas. */
function buildGeometry() {
  return {
    body: new THREE.CapsuleGeometry(0.28, 0.55, 3, 8),
    head: new THREE.SphereGeometry(0.22, 8, 6),
    cap: new THREE.SphereGeometry(0.235, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    back: new THREE.CylinderGeometry(0.2, 0.26, 0.45, 8, 1, true),
    knob: new THREE.SphereGeometry(0.1, 6, 4),
    eye: new THREE.SphereGeometry(0.035, 5, 4),
    brow: new THREE.BoxGeometry(0.09, 0.02, 0.02),
    collar: new THREE.TorusGeometry(0.2, 0.05, 6, 12),
    skirt: new THREE.CylinderGeometry(0.28, 0.42, 0.35, 10, 1),
    trim: new THREE.BoxGeometry(0.08, 0.3, 0.02),
    glass: new THREE.TorusGeometry(0.06, 0.012, 5, 10),
    hat: new THREE.CylinderGeometry(0.24, 0.24, 0.1, 8),
    stud: new THREE.SphereGeometry(0.03, 5, 4),
    disc: new THREE.CylinderGeometry(0.45, 0.45, 0.04, 16),
    dot: new THREE.SphereGeometry(0.07, 6, 4),
    // A thin flat outline on the ground, not a tube: it read as a solid blue band
    // (the founder, 2026-10-03: "make it a hollow type instead of a solid shape").
    ring: new THREE.RingGeometry(0.5, 0.58, 48),
  };
}


type Geometry = ReturnType<typeof buildGeometry>;

/** One instanced mesh per part; `per` instances per slot for the paired ones. */
interface Part { mesh: THREE.InstancedMesh; per: number }
interface PartSet {
  body: Part; head: Part; cap: Part; back: Part; knob: Part;
  eyes: Part; brows: Part; collar: Part; skirt: Part; trim: Part;
  glasses: Part; hat: Part; studs: Part;
  all: Part[];
}

/**
 * A sphere big enough to hold any world we draw, pinned onto every instanced mesh.
 *
 * THE BUG THIS EXISTS FOR. three computes an InstancedMesh's bounding sphere lazily,
 * ONCE, from instances 0..count-1, and never invalidates it -- not when the matrices
 * change, not when `count` does. `raycast()` then rejects any ray that misses it. That
 * was harmless while count was always 64 and the slots spanned the whole city, but
 * `setCounts` now makes count follow what is on screen, so the first touch anywhere
 * would freeze the sphere around whatever was visible at that instant and every later
 * tap outside it would miss. Worse, a first touch while `solids === 0` -- routine in a
 * town where forty of forty-one people are practice ghosts -- freezes an EMPTY sphere
 * with radius -1, and those meshes are untappable for the life of the canvas.
 *
 * Setting it up front stops three ever computing one. Nothing is lost: these meshes
 * have `frustumCulled = false`, so the sphere is only ever used to decide whether a
 * ray is worth testing, and a ray that gets tested still honours `count`.
 */
const worldSphere = () => new THREE.Sphere(new THREE.Vector3(0, 0, 0), 500);

function buildParts(g: Geometry, material: THREE.Material, slots = SLOTS): PartSet {
  const mk = (geo: THREE.BufferGeometry, per = 1): Part => {
    const mesh = new THREE.InstancedMesh(geo, material, slots * per);
    mesh.count = slots * per;
    mesh.frustumCulled = false;
    mesh.boundingSphere = worldSphere();
    return { mesh, per };
  };
  const set = {
    body: mk(g.body), head: mk(g.head), cap: mk(g.cap), back: mk(g.back), knob: mk(g.knob),
    eyes: mk(g.eye, 2), brows: mk(g.brow, 2), collar: mk(g.collar, 2), skirt: mk(g.skirt), trim: mk(g.trim),
    glasses: mk(g.glass, 2), hat: mk(g.hat), studs: mk(g.stud, 2),
  };
  return { ...set, all: Object.values(set) };
}

/**
 * Eye spacing, size and tilt. ONE FACE, not six.
 *
 * There used to be a face preset in the catalog -- Calm, Bright, Sleepy and three more
 * at thirty points each -- and this table had a row per preset. It moved the eyes on
 * the capsule and on the flat avatar and did NOTHING on the rigged body, which is what
 * the town actually draws: these heads carry no morph targets and their eyes are a
 * twenty-four-triangle mesh baked in. So it was sold and it changed nothing, and it is
 * gone. This is the old "Calm" row, which everybody had by default.
 */
const FACE = { gap: 0.14, eye: 1, dy: 0.02, tilt: 0 } as const;
const BODY_SCALE = [[0.85, 1, 0.85], [1, 1, 1], [1.2, 1, 1.15]] as const;

/** Colour tables, built once so the frame loop allocates nothing. */
function buildColours(colors: WorldColors) {
  const c = (h: string) => new THREE.Color(h);
  const dim = (h: string, f: number) => new THREE.Color(h).multiplyScalar(f);
  return {
    skin: SKIN_HEX.map(c), hair: HAIR_HEX.map(c), hairDim: HAIR_HEX.map((h) => dim(h, 0.6)),
    outfit: OUTFIT_HEX.map(c), outfitDim: OUTFIT_HEX.map((h) => dim(h, 0.72)),
    you: c(colors.you), met: c(colors.met), prop: c(colors.prop), success: c(colors.success),
    danger: c(colors.danger), warning: c(colors.warning), accent: c(colors.accent),
    grey: c(colors.stranger), eye: c('#262626'), white: c('#f4f4f4'),
  };
}
type Colours = ReturnType<typeof buildColours>;

interface Posed { x: number; z: number; facing: number; look: Look }

/**
 * Write one agent's parts into slot `i` of `set`. Pure geometry: position, facing,
 * bob, and the look. Everything not worn gets the hidden matrix.
 */
function poseAgent(set: PartSet, i: number, a: Posed, bob: number, dummy: THREE.Object3D, hidden: THREE.Matrix4, col: Colours, scale = 1) {
  const { look } = a;
  const f = a.facing;
  const fx = Math.sin(f), fz = Math.cos(f);       // forward
  const rx = Math.cos(f), rz = -Math.sin(f);      // right
  const headY = 1.12 + bob;
  // Every part is built at human size and placed about the agent's feet, so one
  // multiply here is the whole figure's scale: the town draws people small enough to
  // walk between buildings, the builder's preview draws the same body at full size.
  const place = (p: Part, k: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rxr = 0, ryr = f, rzr = 0) => {
    dummy.position.set(a.x + (x - a.x) * scale, y * scale, a.z + (z - a.z) * scale);
    dummy.rotation.set(rxr, ryr, rzr);
    dummy.scale.set(sx * scale, sy * scale, sz * scale);
    dummy.updateMatrix();
    p.mesh.setMatrixAt(i * p.per + k, dummy.matrix);
  };
  const hide = (p: Part, k = 0) => p.mesh.setMatrixAt(i * p.per + k, hidden);
  const tint = (p: Part, k: number, c: THREE.Color) => p.mesh.setColorAt(i * p.per + k, c);

  // body and head
  const [bx, by, bz] = BODY_SCALE[look.body] ?? BODY_SCALE[1];
  place(set.body, 0, a.x, 0.56 + bob, a.z, bx, by, bz);
  tint(set.body, 0, col.outfit[look.outfitColor] ?? col.outfit[0]!);
  place(set.head, 0, a.x, headY, a.z);
  tint(set.head, 0, col.skin[look.skin] ?? col.skin[3]!);

  // hair
  const hair = col.hair[look.hairColor] ?? col.hair[0]!;
  const h = hairOf(look);
  if (h === 'bald') hide(set.cap);
  else {
    const sy = h === 'buzz' ? 0.45 : h === 'curly' ? 1.25 : 0.95;
    const sxz = h === 'curly' ? 1.2 : 1;
    place(set.cap, 0, a.x, headY + 0.02, a.z, sxz, sy, sxz);
    tint(set.cap, 0, hair);
  }
  if (h === 'long' || h === 'ponytail') {
    const narrow = h === 'ponytail' ? 0.5 : 1;
    place(set.back, 0, a.x - fx * 0.12, headY - 0.2, a.z - fz * 0.12, narrow, 1, narrow);
    tint(set.back, 0, hair);
  } else hide(set.back);
  if (h === 'bun') { place(set.knob, 0, a.x - fx * 0.08, headY + 0.26, a.z - fz * 0.08, 1.1, 1.1, 1.1); tint(set.knob, 0, hair); }
  else if (h === 'ponytail') { place(set.knob, 0, a.x - fx * 0.24, headY - 0.1, a.z - fz * 0.24); tint(set.knob, 0, hair); }
  else if (h === 'mohawk') { place(set.knob, 0, a.x, headY + 0.24, a.z, 0.35, 2.2, 1.1); tint(set.knob, 0, hair); }
  else hide(set.knob);

  // face
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    const ex = a.x + fx * 0.19 + rx * FACE.gap * 0.5 * side;
    const ez = a.z + fz * 0.19 + rz * FACE.gap * 0.5 * side;
    place(set.eyes, k, ex, headY + FACE.dy, ez, FACE.eye, FACE.eye, FACE.eye);
    tint(set.eyes, k, col.eye);
    place(set.brows, k, ex, headY + FACE.dy + 0.07, ez, 1, 1, 1, 0, f, k === 0 ? FACE.tilt : -FACE.tilt);
    tint(set.brows, k, col.hairDim[look.hairColor] ?? col.hairDim[0]!);
  }

  // what they are wearing: the neck comes off the top they picked, the skirt off
  // their legs, which since the wardrobe was split are two separate answers.
  const o = topOf(look);
  const outfitDim = col.outfitDim[look.outfitColor] ?? col.outfitDim[0]!;
  if (o === 'collar') {
    place(set.collar, 0, a.x, 0.9 + bob, a.z, 1, 1, 1, Math.PI / 2, f, 0);
    tint(set.collar, 0, outfitDim);
  } else hide(set.collar, 0);
  if (skirtOf(look)) {
    place(set.skirt, 0, a.x, 0.22 + bob, a.z, bx, 1, bz);
    tint(set.skirt, 0, col.outfit[look.outfitColor] ?? col.outfit[0]!);
  } else hide(set.skirt);
  if (o === 'straps') { place(set.trim, 0, a.x + fx * 0.29, 0.72 + bob, a.z + fz * 0.29, 1, 1.6, 1, 0, f, 0.7); tint(set.trim, 0, outfitDim); }
  else if (o === 'open') { place(set.trim, 0, a.x + fx * 0.29, 0.68 + bob, a.z + fz * 0.29, 0.5, 1, 1, 0, f, 0); tint(set.trim, 0, col.eye); }
  else hide(set.trim);

  // what they wear on top: the capsule has a shape for four of the extras
  const n = col.outfit.length;
  if (look.glasses > 0) {
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      place(set.glasses, k, a.x + fx * 0.21 + rx * FACE.gap * 0.5 * side, headY + FACE.dy, a.z + fz * 0.21 + rz * FACE.gap * 0.5 * side, 1, 1, 1, 0, f, 0);
      tint(set.glasses, k, col.prop);
    }
  } else { hide(set.glasses, 0); hide(set.glasses, 1); }
  if (look.hat > 0) { place(set.hat, 0, a.x, headY + 0.22, a.z); tint(set.hat, 0, col.outfitDim[(look.outfitColor + 3) % n]!); } else hide(set.hat);
  if (look.earrings > 0) {
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      place(set.studs, k, a.x + rx * 0.22 * side, headY - 0.04, a.z + rz * 0.22 * side);
      tint(set.studs, k, col.warning);
    }
  } else { hide(set.studs, 0); hide(set.studs, 1); }
  if (look.neck === 1) { place(set.collar, 1, a.x, 0.88 + bob, a.z, 1.15, 1.15, 1.3, Math.PI / 2, f, 0); tint(set.collar, 1, col.outfit[(look.outfitColor + 6) % n]!); }
  else hide(set.collar, 1);
}

/** The capsule crowd: only ever built when the real bodies cannot be. */
interface Capsules { solid: PartSet; ghost: PartSet }

/**
 * Tell every capsule mesh how many slots are actually in use this frame.
 *
 * WITHOUT THIS, THE WHOLE THING IS POINTLESS. An InstancedMesh draws `count`
 * instances whatever their matrices say, so hiding somebody by scaling them to zero
 * still costs a full pass over their vertices. The town drew sixty-four people every
 * frame no matter how many there were: benchmarked at forty-eight people and at
 * sixty-four, the numbers came out identical to the digit.
 */
function setCounts(m: Capsules, used: number, solids: number) {
  // An instanced mesh draws slots 0..count-1, so the smaller of the two crowds is
  // packed at the front and only has to reach as far as its own last member. The
  // other one still has to span everybody, but that is one set spanning the crowd
  // instead of two. In the founder's town forty of forty-one people are practice
  // profiles, so this is very nearly a halving.
  for (const p of m.solid.all) p.mesh.count = solids * p.per;
  for (const p of m.ghost.all) p.mesh.count = used * p.per;
}

/**
 * Send the GPU the first `count` instances of a marker mesh and nothing past them,
 * and draw nothing at all when there are none. The buffers are sized for the whole
 * crowd test; a frame uses a handful of rows (gl-subdata.ts is why a range works on
 * a phone).
 */
function upload(m: THREE.InstancedMesh) {
  m.visible = m.count > 0;
  if (!m.count) return;
  m.instanceMatrix.clearUpdateRanges();
  m.instanceMatrix.addUpdateRange(0, m.count * 16);
  m.instanceMatrix.needsUpdate = true;
  if (!m.instanceColor) return;
  m.instanceColor.clearUpdateRanges();
  m.instanceColor.addUpdateRange(0, m.count * 3);
  m.instanceColor.needsUpdate = true;
}

function hideAgent(set: PartSet, i: number, hidden: THREE.Matrix4) {
  for (const p of set.all) for (let k = 0; k < p.per; k++) p.mesh.setMatrixAt(i * p.per + k, hidden);
}

function flag(parts: PartSet) {
  for (const p of parts.all) {
    p.mesh.instanceMatrix.needsUpdate = true;
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }
}

// ── the town ─────────────────────────────────────────────────────────────────

export function WorldCanvas(props: WorldCanvasProps) {
  const { cap30 = false, active = true, sim, venueSim, control, frame = DEFAULT_FRAME } = props;
  const cam = useRef<CamState | null>(null);
  if (!cam.current) {
    const [hx, hz] = sim.homeOf('you');
    const size = { width: 390, height: 800 };
    cam.current = {
      pose: { tx: hx, tz: hz, zoom: ZOOM_START }, walking: false, back: WALK_BACK, at: null, yaw: 0,
      fly: null, follow: true, followAfterFly: true, band: null,
      size, city: cityPose(MAP.outline, size, frame), clock: 0, lastDx: 0, lastDy: 0, pinchDist: null,
      seated: 0, bench: null, wasFlying: false,
    };
  }
  const c = cam.current;
  useEffect(() => { c.city = cityPose(MAP.outline, c.size, frame); }, [c, frame]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) { c.size = { width, height }; c.city = cityPose(MAP.outline, c.size, frame); }
  };

  // Drags and pinches are ours; taps stay with r3f. A touch becomes ours the moment
  // it moves eight pixels or a second finger lands, and we do not give it back.
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_e, g) => g.numberActiveTouches >= 2 || Math.hypot(g.dx, g.dy) > 8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_e, g) => { c.fly = null; if (!c.walking) c.follow = false; c.lastDx = g.dx; c.lastDy = g.dy; c.pinchDist = null; },
    onPanResponderMove: (e, g) => {
      // Walking: a drag looks around rather than moving the map, which has no meaning
      // when the camera is tied to somebody's shoulders.
      if (c.walking) {
        c.yaw -= (g.dx - c.lastDx) * ORBIT_PER_PX;
        c.lastDx = g.dx; c.lastDy = g.dy;
        return;
      }
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        const a = t[0]!; const b = t[1]!;
        const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        const mid: [number, number] = [(a.locationX + b.locationX) / 2, (a.locationY + b.locationY) / 2];
        const vert = verticalOf(elevationFor(c.pose.zoom, c.city.zoom));
        if (c.pinchDist && d > 0) c.pose = clampTarget(pinch(c.pose, mid, d / c.pinchDist, c.size, c.city.zoom, ZOOM_MAX, vert), BOUNDS);
        c.pinchDist = d; c.lastDx = g.dx; c.lastDy = g.dy;
        return;
      }
      c.pinchDist = null;
      const dx = g.dx - c.lastDx; const dy = g.dy - c.lastDy;
      c.lastDx = g.dx; c.lastDy = g.dy;
      c.pose = clampTarget(pan(c.pose, dx, dy, verticalOf(elevationFor(c.pose.zoom, c.city.zoom))), BOUNDS);
    },
    onPanResponderRelease: () => {
      c.pinchDist = null;
      // Let go near the city zoom: settle on the whole city, so the labels line up.
      if (c.pose.zoom <= c.city.zoom * CITY_BAND) startFly(c, c.city, false);
    },
    onPanResponderTerminate: () => { c.pinchDist = null; },
  }), [c]);

  useEffect(() => {
    if (!control) return;
    control.current = {
      // A tile tap shows the neighbourhood from above; Home goes back down to your
      // own agent, in the street, and follows it again.
      setWalking: (on) => {
        c.walking = on;
        c.fly = null;
        if (on) {
          const me = (venueSim ?? sim).get('you');
          c.yaw = me?.facing ?? 0; c.back = WALK_BACK;
          c.at = me ? [me.x, me.z] : null;
          c.follow = false;
        }
        else {
          c.follow = true; c.at = null;
          sim.drive('you', 0, 0);
          venueSim?.drive('you', 0, 0);
        }
      },
      flyTo: (id) => { c.walking = false; sim.drive('you', 0, 0); flyToArea(c, id, false); },
      flyToPoint: (x, z, zoom = 42) => {
        c.walking = false;
        sim.drive('you', 0, 0);
        startFly(c, { tx: x, tz: z, zoom }, false);
      },
      flyHome: () => {
        c.walking = false; sim.drive('you', 0, 0);
        const you = sim.get('you');
        const [hx, hz] = you ? [you.x, you.z] : sim.homeOf('you');
        startFly(c, { tx: hx, tz: hz, zoom: ZOOM_START }, true);
      },
      flyCity: () => { c.walking = false; sim.drive('you', 0, 0); startFly(c, c.city, false); },
      headOnScreen: (ref) => {
        const a = (c.walking ? venueSim ?? sim : sim).get(ref);
        if (!a || !c.camera) return null;
        head.set(a.x, (a.lift ?? 0) + BODY_H * (HEIGHT_SCALE[a.look.height] ?? 1) * 1.12, a.z).project(c.camera);
        // Behind the lens, or off the screen by more than a bubble's width.
        if (head.z > 1 || head.x < -1.3 || head.x > 1.3 || head.y < -1.3 || head.y > 1.3) return null;
        return [(head.x + 1) / 2 * c.size.width, (1 - head.y) / 2 * c.size.height];
      },
    };
    return () => { control.current = null; };
  }, [control, c, sim, venueSim]);

  // App backgrounding remounts the GL canvas. The screen owns the realm, so restore
  // it instead of silently returning to the city with a venue HUD over it.
  useEffect(() => {
    if (props.inVenue === undefined || c.walking === props.inVenue) return;
    c.walking = props.inVenue;
    c.fly = null;
    if (props.inVenue) {
      const me = (venueSim ?? sim).get('you');
      c.yaw = me?.facing ?? 0;
      c.back = WALK_BACK;
      c.at = me ? [me.x, me.z] : null;
      c.follow = false;
    } else {
      c.at = null;
      c.follow = true;
      venueSim?.drive('you', 0, 0);
    }
  }, [props.inVenue, c, sim, venueSim]);

  return (
    <View style={{ flex: 1 }} onLayout={onLayout} {...responder.panHandlers}>
      <Canvas
        // No dpr prop: expo-gl renders at the phone's native pixel ratio and nothing
        // else, and the native Canvas type says so by leaving it out.
        gl={{ antialias: false }}
        // Never r3f's own loop: RefreshTicker draws each frame, on the UI thread's clock.
        frameloop="never"
      >
        <Town {...props} cam={c} />
        <RefreshTicker active={active} cap30={cap30} />
      </Canvas>
    </View>
  );
}

/**
 * Draws the town once per screen refresh while it is in front, or once per two with the
 * "30 fps" setting. The canvas's frameloop is 'never' and this advances it: r3f's own loop
 * runs on React Native's requestAnimationFrame, which on the Pixel 6a settled at every
 * second or fourth refresh after about half of the returns to the town (vsync-clock.ts).
 * Time is continuous across a pause: a gap longer than 100 ms counts as 100 ms.
 */
function RefreshTicker({ active, cap30 }: { active: boolean; cap30: boolean }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    startVsync((now) => {
      const state = get();
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      advance(state.clock.elapsedTime + dt, true, state);
    }, cap30);
    return () => stopVsync();
  }, [active, cap30, get]);
  return null;
}

/** Reused for every head the bubbles ask about. */
const head = new THREE.Vector3();
/** How tall a body stands in the town: the model is 1.87 units (character-mesh.ts). */
const BODY_H = 1.87 * MODEL_SCALE * PERSON;
/** The most bicycles drawn at once: the nearest riders. */
const BIKES_DRAWN = 48;
/** How high a sight's marker floats: over the trees, 20 m up. */
const SIGHT_MARK_Y = 2.5;
/**
 * Where the walking camera stops drawing: just past the end of the mist, so nothing
 * is clipped while it can still be seen. It was 90, drawing forty-five units of
 * ground the mist had already painted over.
 */
const WALK_FAR = VIEW + 6;
/**
 * How big a bubble around somebody counts as "on screen".
 *
 * Bigger than a person on purpose: it has to cover the disc at their feet and the
 * speech bubble over their head, and the slack is what stops somebody popping into
 * existence at the edge of the screen as they walk in.
 */
const SEEN_R = 0.4;

/**
 * How far the camera stands from what it looks at. Orthographic, so the distance
 * changes nothing but the clipping -- and at 12 it clipped: zoomed out, the southern
 * half of the city was behind the camera and the plate ended in a straight line
 * across Whitefield (seen on the Seeker, 2026-09-21). WHICH WAY it stands comes from
 * the zoom (elevationFor in ./camera.ts), so this only has to be further out than the
 * city is wide, at any angle.
 */
const EYE = 220;

/**
 * Two worlds, two real lenses. The Canvas declares no camera prop, so r3f has nothing
 * to re-apply over these on a React render; Town owns both and swaps the active one
 * only at a realm boundary.
 */
/** How fast the camera catches up with your agent: 1 - e^(-k·dt) per frame. */
const FOLLOW = 3;

function Town({
  sim, colors, cap30, onStats, onTapAgent, onTapVenue, onFirstFrame, onBand, onWalking,
  stick, venueSim, venue = CUBBON_PARK, cam, slots = SLOTS,
}: WorldCanvasProps & { cam: CamState }) {
  const { gl, scene, size, set, get } = useThree();
  const mapCamera = useMemo(() => new THREE.OrthographicCamera(), []);
  const walkCamera = useMemo(() => new THREE.PerspectiveCamera(WALK_FOV, 1, 0.08, WALK_FAR), []);

  const mode = useRef<'map' | 'walk' | null>(null);
  /** The last projection each camera was given, so it is rebuilt only when needed. */
  const lens = useRef('');

  useEffect(() => {
    scene.background = new THREE.Color(colors.bg);
  }, [scene, colors.bg]);
  // The crowd and the markers send the GPU only the rows they wrote, and Expo's GL
  // needs this to honour that (gl-subdata.ts). Their first upload is whole anyway.
  useEffect(() => honourSubDataRanges(gl.getContext()), [gl]);
  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = colors.night ? 0.92 : 1.05;
  }, [gl, colors.night]);

  // The city, built once per palette; the theme toggle rebuilds it (lamps, windows).
  const map = useMemo(() => buildMap(MAP, colors), [colors]);
  useEffect(() => () => map.dispose(), [map]);

  // The real venue's local layout. Its coordinates never leak onto the city map.
  const layout = useMemo(() => venueGarden(venue), [venue]);
  const garden = useMemo(
    () => buildGarden(layout, { night: colors.night, accent: colors.accent }, { assetFurniture: true, city: venue.id === CUBBON_PARK.id }),
    [layout, colors.night, colors.accent, venue.id],
  );
  useEffect(() => () => garden.dispose(), [garden]);
  // THE CITY ROUND THE PARK (city-mesh.ts): its road, buildings and traffic, beyond the
  // fence. Planned once, offline (scripts/build-city.mts); only Cubbon Park has one.
  const city = useMemo<BuiltCity | null>(
    () => (venue.id === CUBBON_PARK.id
      ? buildCity(require('../../../assets/venues/cubbon-park/city.json') as CityPlan, { night: colors.night })
      : null),
    [venue.id, colors.night],
  );
  useEffect(() => () => city?.dispose(), [city]);

  // Detailed CC0 furniture loads after the world is already visible: the models near
  // the camera, plain stand-ins further out (venue-mesh.ts). If the bundle ever fails,
  // terrain and people remain usable; only the benches, lamps and bins are absent.
  const furnitureHolder = useMemo(() => new THREE.Group(), []);
  // The emergency pickup's gear (rig-mesh.ts): planes, cables, and parachutes striped
  // in the accent colour.
  const rigs = useMemo(() => buildRigs(colors.accent), [colors.accent]);
  useEffect(() => () => rigs.dispose(), [rigs]);
  // THE SIGHTS STILL TO SEE, marked (park-live.ts sightsToMark): a diamond in the accent
  // colour high over each, bobbing, drawn through the mist and over the trees so it can
  // be steered by from anywhere in the park -- "see the sights" is no use if you cannot
  // find them. Only while you are with somebody and have not seen three today.
  const marks = useMemo(() => {
    const group = new THREE.Group();
    group.name = 'sight-marks';
    const geo = new THREE.OctahedronGeometry(0.22);
    geo.scale(1, 1.6, 1);
    const mat = new THREE.MeshBasicMaterial({ color: colors.accent, fog: false, depthTest: false, transparent: true, opacity: 0.9 });
    for (const s of PARK_SIGHTS) {
      const m = new THREE.Mesh(geo, mat);
      m.name = s.id;
      m.renderOrder = 10;
      m.visible = false;
      m.raycast = () => {};
      m.position.set(s.x, SIGHT_MARK_Y, s.z);
      group.add(m);
    }
    return { group, geo, mat };
  }, [colors.accent]);
  useEffect(() => () => { marks.geo.dispose(); marks.mat.dispose(); }, [marks]);
  const marked = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const apply = (s: ReturnType<typeof useParkLive.getState>) => {
      marked.current = new Set(sightsToMark(s.quests, !!s.partner).map((x) => x.id));
    };
    apply(useParkLive.getState());
    return useParkLive.subscribe(apply);
  }, []);
  // The bicycles under whoever is riding one (bike.ts): one mesh, a bike per rider drawn.
  const bikes = useMemo(() => {
    const m = new THREE.InstancedMesh(buildBike(), new THREE.MeshLambertMaterial({ vertexColors: true }), BIKES_DRAWN);
    m.name = 'bikes';
    m.count = 0;
    m.frustumCulled = false;
    m.raycast = () => {};
    // Its count changes every frame (tests/canvas-size.test.ts).
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    return m;
  }, []);
  useEffect(() => () => { bikes.geometry.dispose(); (bikes.material as THREE.Material).dispose(); }, [bikes]);
  const furniture = useRef<BuiltVenueFurniture | null>(null);
  useEffect(() => {
    let alive = true;
    let made: BuiltVenueFurniture | null = null;
    loadVenueFurniture(layout).then((built) => {
      if (!alive) { built.dispose(); return; }
      made = built;
      furniture.current = built;
      furnitureHolder.add(built.group);
    }).catch((e: unknown) => {
      console.warn('[world] no venue furniture: the park has no benches or lamps this visit:', e);
    });
    return () => {
      alive = false;
      furniture.current = null;
      furnitureHolder.clear();
      made?.dispose();
    };
  }, [layout, furnitureHolder]);

  /**
   * EVERYBODY AS A REAL BODY, drawn by the graphics chip (./crowd-gpu.ts), read off
   * disk after the canvas is already up.
   *
   * Until it arrives NOBODY is drawn -- a moment of an empty park -- rather than
   * capsules that then turn into people one at a time, which is what the founder
   * watched and asked about (2026-09-28). The capsules come back only if the model
   * cannot be read at all: the town must never depend on a 3.5 MB file having loaded.
   */
  const crowdHolder = useMemo(() => new THREE.Group(), []);
  const people = useRef<GpuCrowd | null>(null);
  const [fallback, setFallback] = useState(false);
  /** This frame's camera and clock for the crowd, rewritten rather than rebuilt. */
  const crowdFrame = useMemo<CrowdFrame>(() => ({ eyeX: 0, eyeZ: 0, flat: 0, time: 0, dt: 0, scale: PERSON }), []);
  /** What the camera can see, and the people it can see, both reused every frame. */
  const view = useMemo(() => new Viewport(), []);
  const stepNear = useMemo(() => ({ x: 0, z: 0, r: VIEW, fx: 0, fz: 0, every: 1 }), []);
  const lookDir = useMemo(() => new THREE.Vector3(), []);
  const shown = useMemo<SimAgent[]>(() => [], []);
  /** Scratch for nearestFirst, reused every frame. */
  const order = useMemo(() => ({ keys: new Float64Array(0), people: [] as SimAgent[] }), []);
  /** How many of `shown` have a body this frame: shown[0..bodied). What a tap can hit. */
  const bodied = useRef(0);
  /**
   * The point on the ground the screen is centred on, which is NOT where the camera
   * is. On the map the camera sits 1,600 units away behind a 6-degree lens, so sorting
   * people by distance to it ranks them by how far up the screen they are rather than
   * how central, and the dozen who got a real body were scattered off the edges. This
   * is what the camera is LOOKING AT, which is what the person holding the phone means.
   */
  const focus = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    let alive = true;
    let made: GpuCrowd | null = null;
    loadGpuCrowd()
      .then((c) => {
        if (!alive) { c.dispose(); return; }
        made = c;
        people.current = c;
        crowdHolder.add(c.group);
      })
      .catch((e: unknown) => {
        console.warn('[world] no bodies for the crowd, falling back to capsules:', e);
        if (alive) setFallback(true);
      });
    return () => { alive = false; people.current = null; crowdHolder.clear(); made?.dispose(); };
  }, [crowdHolder]);
  // Null, not false: the first frame has to apply the choice, not skip it as a no-op.
  const inGarden = useRef<boolean | null>(null);
  const appliedGarden = useRef<unknown>(null);
  useEffect(() => {
    const was = scene.fog;
    return () => { scene.fog = was; };
  }, [scene]);
  const yourArea = useRef<string | null | undefined>(undefined);

  const meshes = useMemo(() => {
    const g = buildGeometry();
    const solid = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const ghost = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 });
    // White, and the yellow given per ring (setColorAt): instance colours multiply.
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, depthWrite: false });
    const mk = (geo: THREE.BufferGeometry, n: number) => {
      const im = new THREE.InstancedMesh(geo, solid, n);
      im.count = 0;
      im.visible = false;
      im.frustumCulled = false;
      im.boundingSphere = worldSphere();   // see worldSphere: count now varies
      im.raycast = () => {};               // a tap on a marker is a tap on its person
      return im;
    };
    return {
      capsules: fallback ? { solid: buildParts(g, solid, slots), ghost: buildParts(g, ghost, slots) } : null,
      discs: mk(g.disc, slots),
      dots: mk(g.dot, slots * DOTS_PER),
      rings: (() => {
        const im = new THREE.InstancedMesh(g.ring, ringMat, slots);
        im.count = 0;
        im.visible = false;
        im.frustumCulled = false;
        im.boundingSphere = worldSphere();
        im.raycast = () => {};
        im.renderOrder = 2;
        return im;
      })(),
      geometries: Object.values(g),
      materials: [solid, ghost, ringMat],
    };
  }, [slots, fallback]);

  useEffect(() => () => {
    for (const g of meshes.geometries) g.dispose();
    for (const m of meshes.materials) m.dispose();
  }, [meshes]);

  const col = useMemo(() => buildColours(colors), [colors]);
  const ringYellow = useMemo(() => new THREE.Color(RING_COLOR), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const hidden = useMemo(() => {
    const o = new THREE.Object3D();
    o.scale.setScalar(0);
    o.updateMatrix();
    return o.matrix;
  }, []);

  // Frame-time ring buffer, in refs.
  const samples = useRef<number[]>([]);
  const early = useRef<number[]>([]);
  const late = useRef<number[]>([]);
  const elapsed = useRef(0);
  const lastReport = useRef(0);
  const drawn = useRef(false);
  /**
   * WHERE A FRAME'S TIME GOES, in a debug build while the park's crowd test is on
   * (slots above SLOTS): JS milliseconds per section, averaged and logged every two
   * seconds as "[perf] ..." -- readable off a plugged-in phone with
   * `adb logcat -s ReactNativeJS`. `render` is three issuing the draw calls; the
   * gap between the sections' sum and the frame is the GPU and the native side.
   */
  const prof = useRef({ on: false, n: 0, at: 0, sim: 0, vis: 0, crowd: 0, marks: 0, city: 0, render: 0, frame: 0, loop: 0, start: 0 });
  useEffect(() => {
    if (!__DEV__) return;
    const p = prof.current;
    // On in every debug build: the park's own frame (and the city round it) is worth
    // reading off a plugged-in phone, not only the crowd test's.
    p.on = true;
    const orig = gl.render.bind(gl);
    gl.render = (sc: THREE.Object3D, cm: THREE.Camera) => {
      if (!p.on) { orig(sc, cm); return; }
      const t0 = performance.now(); orig(sc, cm); p.render += performance.now() - t0;
    };
    return () => { gl.render = orig; };
  }, [gl, slots]);

  useFrame((_, dt) => {
    if (prof.current.on) prof.current.start = performance.now();
    if (!drawn.current) { drawn.current = true; onFirstFrame?.(); }
    const clamped = Math.min(dt, 0.1);
    elapsed.current += clamped;
    const t = elapsed.current;

    // WHICH WORLD. Venue coordinates are local and live in their own sim; city
    // coordinates never get copied into it.
    const walking = cam.walking && !!venueSim;
    const live = walking ? venueSim! : sim;
    // Set every frame, not only when it changes: two boolean writes cost nothing, and
    // a rule that only fires on a transition loses its grip the moment either world
    // is rebuilt -- a theme change or a reload left the garden drawn over the city,
    // and then the city drawn over the garden (on the phone, 2026-09-22).
    map.group.visible = !walking;
    garden.group.visible = walking;
    if (city) city.group.visible = walking;
    furnitureHolder.visible = walking;
    if (walking !== inGarden.current || appliedGarden.current !== garden) {
      inGarden.current = walking;
      appliedGarden.current = garden;
      scene.fog = walking
        ? new THREE.Fog(garden.horizon, MIST_NEAR, VIEW)
        : new THREE.Fog(colors.bg, EYE * 0.82, EYE * 1.42);
      scene.background = new THREE.Color(walking ? garden.horizon : colors.bg);
      onWalking?.(walking);
    }
    const p0 = prof.current.on ? performance.now() : 0;
    // THE PEOPLE NOBODY CAN SEE take their steps less often (WorldSim.step). Last
    // frame's camera is near enough: this one has not moved yet.
    if (mode.current === 'walk') {
      // On foot: past the mist (or the far plane), or behind you.
      stepNear.x = walkCamera.position.x;
      stepNear.z = walkCamera.position.z;
      stepNear.r = VIEW;
      walkCamera.getWorldDirection(lookDir);
      const flat = Math.hypot(lookDir.x, lookDir.z) || 1;
      stepNear.fx = lookDir.x / flat;
      stepNear.fz = lookDir.z / flat;
      stepNear.every = 1;
    } else {
      // On the map: off the patch of ground the screen shows, and a margin.
      stepNear.x = focus.x;
      stepNear.z = focus.z;
      stepNear.r = groundReach(cam.pose.zoom, size, elevationFor(cam.pose.zoom, cam.city.zoom)) + 2;
      stepNear.fx = 0;
      stepNear.fz = 0;
      // A walker covers 0.2 units a second, which is 0.2 x zoom pixels. Stepped every N
      // frames at 120 a second, each step is zoom x N / 600 pixels; under half a pixel
      // nobody can see the difference, so N is 240 / zoom -- four frames at the street
      // view and pulled out over the city, every frame close in.
      stepNear.every = Math.max(1, Math.min(4, Math.floor(240 / Math.max(1, cam.pose.zoom))));
    }
    live.step(clamped, stepNear);
    const p1 = prof.current.on ? performance.now() : 0;
    if (walking) garden.tick(t, clamped);

    // Your tile, lit once your agent knows which it is.
    // Your tile is lit wherever your agent actually stands -- including the central
    // one, before the neighbourhood question is answered. Lighting nothing left the
    // city with no focal point at all (on the phone, 2026-09-22).
    const you = live.get('you');
    if (!walking && you && you.area !== yourArea.current) { yourArea.current = you.area; map.setYourTile(you.area ?? CENTRAL_AREA); }

    rigs.group.visible = walking;
    // The stick, if a thumb is on it: it steers in the camera's bearing, not the
    // agent's, so "up" always means away from you however they are facing. Not in the
    // sky drop (flight.ts): up there the stick does nothing.
    const flying = walking && !!you?.fly;
    // The sights still to see, bobbing gently, only while walking the park.
    for (const m of marks.group.children) {
      m.visible = walking && marked.current.has(m.name);
      if (m.visible) { m.position.y = SIGHT_MARK_Y + Math.sin(t * 2 + m.position.x) * 0.08; m.rotation.y = t * 0.8; }
    }
    if (cam.walking && stick && !flying) {
      const { x: jx, y: jy } = stick.current;
      const push = Math.min(1, Math.hypot(jx, jy));
      // ON A BENCH, OR ON THE WAY TO ONE, ONLY A FIRM PUSH GETS YOU UP. A thumb resting
      // on the stick, or brushing it, stood you up and ended the bench for both of you
      // -- and moved both voices to another room (park-live.ts benchPill).
      if (push > (you?.seat ? STAND_PUSH : 0.08)) {
        const [dx, dz] = driveVector(jx, jy, cam.yaw);
        const len = Math.hypot(dx, dz) || 1;
        // On a bicycle, BIKE_PACE times a walk.
        const pace = walkSpeedFor(walking ? layout.radius : 26) * (walking && live.get('you')?.riding ? BIKE_PACE : 1);
        live.drive('you', (dx / len) * pace * push, (dz / len) * pace * push);
      } else live.drive('you', 0, 0);
    }

    // The camera: a fly in progress, else following your agent, else where it was left.
    cam.clock = t;
    if (cam.fly) {
      const { pose, done } = flyAt(cam.fly, t);
      cam.pose = pose;
      if (done) { cam.fly = null; cam.follow = cam.followAfterFly; }
    } else if (cam.follow && you) {
      const k = 1 - Math.exp(-FOLLOW * clamped);
      cam.pose = clampTarget({ tx: cam.pose.tx + (you.x - cam.pose.tx) * k, tz: cam.pose.tz + (you.z - cam.pose.tz) * k, zoom: cam.pose.zoom }, BOUNDS);
    }
    const want = cam.walking && you ? 'walk' : 'map';
    const camera = want === 'walk' ? walkCamera : mapCamera;
    if (want !== mode.current) {
      const was = mode.current;
      mode.current = want;
      onWalking?.(want === 'walk');
      // Leaving: the map picks up where the walk left off, over your agent.
      if (was !== null && want === 'map' && you) { cam.pose = { tx: you.x, tz: you.z, zoom: ZOOM_START }; cam.follow = true; }
    }
    // THE CAMERA r3f DRAWS THROUGH is checked every frame, not only when the mode
    // changes. A hot reload in development runs this component's useMemo again and
    // builds two new cameras; switching only on a change of mode left r3f drawing
    // through the old walking camera, frozen where it stood, while the new one
    // followed you unseen (the founder, 2026-09-29: "the camera is no longer following
    // my character, the view is fixed"). A new camera also needs its lens set.
    if (get().camera !== camera) {
      set({ camera });
      lens.current = '';
    }
    cam.camera = camera;

    const lensNow = want === 'walk'
      ? `w:${size.width}:${size.height}`
      : `m:${cam.pose.zoom.toFixed(3)}:${size.width}:${size.height}`;
    if (lensNow !== lens.current) {
      lens.current = lensNow;
      // NEAR AND FAR DECIDE WHETHER THE GROUND HOLDS TOGETHER. A depth buffer spends
      // its precision near the camera, so 0.02 to 400 -- twenty thousand to one --
      // left almost none for ground thirty units away, and the roads, parks and tiles
      // lying a centimetre apart tore into each other. It looked like half a render
      // (the founder's words, 2026-09-22). The lens can only see about forty units
      // down a street anyway, so the range is the one it actually uses.
      if (want === 'walk') {
        walkCamera.aspect = Math.max(0.1, size.width / Math.max(1, size.height));
        walkCamera.fov = WALK_FOV; walkCamera.zoom = 1; walkCamera.near = 0.08; walkCamera.far = WALK_FAR;
        walkCamera.updateProjectionMatrix();
      }
      else {
        const bounds = orthographicBounds(size, cam.pose.zoom);
        mapCamera.left = bounds.left;
        mapCamera.right = bounds.right;
        mapCamera.top = bounds.top;
        mapCamera.bottom = bounds.bottom;
        mapCamera.zoom = bounds.zoom;
        mapCamera.near = 1;
        mapCamera.far = EYE * 3;
        mapCamera.updateProjectionMatrix();
      }
    }

    if (want === 'walk' && you) {
      // SEATED: round in front of the bench, the two of you high on the screen (camera.ts
      // benchFrame). Eased both ways, so sitting down swings the camera round.
      const sitting = walking && you.state === 'sitting' && !!you.seat;
      if (sitting && you.seat) {
        // Between the two of you when they sit beside you; your own seat otherwise.
        const partner = shownPartner(live);
        const both = partner && partner.state === 'sitting' && Math.hypot(partner.x - you.x, partner.z - you.z) < 0.3;
        cam.bench = { x: both ? (you.x + partner.x) / 2 : you.x, z: both ? (you.z + partner.z) / 2 : you.z, facing: you.seat.facing };
      }
      cam.seated += ((sitting ? 1 : 0) - cam.seated) * (1 - Math.exp(-SEAT_SWING * clamped));
      if (!sitting && cam.seated < 0.01) { cam.seated = 0; cam.bench = null; }
      const s = cam.bench ? cam.seated : 0;
      const bench = cam.bench ? benchFrame(cam.bench.facing) : null;
      // Behind the head, swinging round to where they are facing. The drag offset
      // rides on top, so you can look about without turning them.
      // Only while they are walking: a drag to look around must stay where it was put.
      // Up in the sky drop, along the flight; down, facing whoever you came to.
      if (sitting && bench) cam.yaw = turnToward(cam.yaw, bench.yaw, 1 - Math.exp(-SEAT_SWING * clamped));
      else if (you.driveX !== 0 || you.driveZ !== 0 || flying) {
        cam.yaw = turnToward(cam.yaw, you.facing, 1 - Math.exp(-TURN * clamped));
      }
      if (cam.wasFlying && !flying) cam.yaw = you.facing;
      cam.wasFlying = flying;
      if (!cam.at) cam.at = [you.x, you.z];
      // Flying, bolted on: at that speed a lag would leave you a speck ahead of the lens.
      const t2 = flying ? 1 : 1 - Math.exp(-TRACK * clamped);
      const tx = cam.bench && s > 0 ? you.x + (cam.bench.x - you.x) * s : you.x;
      const tz = cam.bench && s > 0 ? you.z + (cam.bench.z - you.z) * s : you.z;
      cam.at[0] += (tx - cam.at[0]) * t2;
      cam.at[1] += (tz - cam.at[1]) * t2;
      const [ax, az] = cam.at;
      // Nothing is in the way up in the sky, and in front of a bench only a wall would be.
      const want = flying ? WALK_BACK : clearBack(live, ax, az, cam.yaw, bench && s > 0.5 ? bench.back : WALK_BACK);
      const k = 1 - Math.exp(-(want < cam.back ? BACK_IN : BACK_OUT) * clamped);
      cam.back += (want - cam.back) * k;
      const back = cam.back;
      const lift = you.lift ?? 0;
      const mix = (walk: number, seat: number | undefined) => (bench && seat !== undefined ? walk + (seat - walk) * s : walk);
      const { eye, look } = followPose(
        ax, az, cam.yaw, back,
        mix(riseFor(back), bench?.rise) + lift, mix(aimFor(back), bench?.aim), mix(WALK_EYE, bench?.lookY) + lift,
      );
      // YOUR OWN PICKUP: the camera backs off and tips up, so the plane, its cable and you
      // are all in the picture (flight.ts flightShot), eased in from this one and out again.
      const shot = flying && you.fly ? flightShot(you.fly.f, you.fly.ms) : null;
      if (shot && shot.w > 0) {
        for (let k = 0; k < 3; k++) {
          eye[k] = eye[k]! + (shot.eye[k]! - eye[k]!) * shot.w;
          look[k] = look[k]! + (shot.look[k]! - look[k]!) * shot.w;
        }
      }
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.lookAt(look[0], look[1], look[2]);
      focus.set(look[0], 0, look[2]);
      skyFollow(garden, eye[0], 0, eye[2]);
      // No trunk between the lens and you: cut away along that line (garden-mesh.ts
      // seeThroughTrunks). To the middle of you, wherever the camera is easing to.
      garden.sightLine(eye, [you.x, lift + SIGHT_MIDDLE, you.z]);
      // Detailed benches and lamps near the camera, plain ones further out (venue-mesh).
      furniture.current?.follow(eye[0], eye[2]);
    } else {
      garden.sightLine(null);
      // The angle follows the zoom: a map seen from above out at the city, a game
      // camera looking along the street once you are down in it.
      const [ex, ey, ez] = eyeOffset(elevationFor(cam.pose.zoom, cam.city.zoom), EYE);
      camera.position.set(cam.pose.tx + ex, ey, cam.pose.tz + ez);
      camera.lookAt(cam.pose.tx, 0, cam.pose.tz);
      focus.set(cam.pose.tx, 0, cam.pose.tz);
      if (!cam.fly) {
        const band = bandOf(cam.pose.zoom, cam.city.zoom);
        if (band !== cam.band) { cam.band = band; onBand?.(band); }
      }
    }

    // The lakes breathe: a four-second sine on the opacity, and the glow at night.
    const breath = 0.5 + 0.5 * Math.sin(t * (Math.PI / 2));
    map.water.opacity = 0.72 + 0.16 * breath;
    if (colors.night) map.water.emissiveIntensity = 0.25 + 0.2 * breath;

    const { discs, dots, rings } = meshes;
    // ONLY THE PEOPLE ON SCREEN -- and in the park, only the ones this side of the mist.
    //
    // The town used to draw sixty-four people every frame whatever was happening --
    // measured identical at forty-eight and at sixty-four, 205,044 triangles both
    // times, of which the city itself was only 41,972. Everyone else was empty slots
    // and people standing behind the camera. Now the frustum decides, and walking the
    // park so does the mist: nobody past VIEW is drawn, because nobody there could be
    // seen. A park with a thousand people in it costs whatever the few dozen in front
    // of you cost.
    const p2 = prof.current.on ? performance.now() : 0;
    view.update(camera);
    const ex = camera.position.x;
    const ez = camera.position.z;
    // The same question of the trees, hedges and flowers (garden-mesh.ts packByCell).
    if (walking) garden.cull(view, ex, ez);
    // The traffic moves on, and only what is near is drawn; so are the buildings.
    const c0 = prof.current.on ? performance.now() : 0;
    if (walking && city) { city.tick(clamped, ex, ez); city.cull(ex, ez); }
    if (prof.current.on) prof.current.city += performance.now() - c0;
    const reach = walking ? VIEW * VIEW : Infinity;
    const used = visible(live.agents(), view, shown, {
      limit: slots,
      radius: SEEN_R,
      fx: focus.x,
      fz: focus.z,
      keep: (a) => a.state !== 'gone' && !a.hidden && (a.x - ex) ** 2 + (a.z - ez) ** 2 <= reach,
    });
    // NEAREST FIRST. The crowd gives the nearest the most detail: nearest the camera
    // on foot, nearest the middle of the screen on the map, where the camera is far
    // away behind everything and every person is the same size.
    const onFoot = want === 'walk';
    nearestFirst(shown, used, onFoot ? ex : focus.x, onFoot ? ez : focus.z, order);

    const p3 = prof.current.on ? performance.now() : 0;
    const bodies = people.current;
    const caps = meshes.capsules;
    if (bodies) {
      crowdFrame.eyeX = ex;
      crowdFrame.eyeZ = ez;
      crowdFrame.flat = onFoot ? 0 : mapDistance(cam.pose.zoom, size.height);
      crowdFrame.time = t;
      crowdFrame.dt = clamped;
      crowdFrame.scale = PERSON;
      bodied.current = bodies.update(shown, used, crowdFrame);
      // Whoever of them is flying: the plane, its cable or their parachute (flight.ts). The
      // cable is a hairline however far off: how much of the world a screen point covers.
      if (walking) {
        rigs.update(shown, bodied.current, {
          eye: [camera.position.x, camera.position.y, camera.position.z],
          unitsPerDp: (2 * Math.tan((WALK_FOV * Math.PI) / 360)) / Math.max(1, size.height),
          time: t,
        });
      }
      // A bicycle under each rider the crowd drew, nearest first, at the rider's own build.
      let nb = 0;
      for (let i = 0; walking && i < bodied.current && nb < BIKES_DRAWN; i++) {
        const a = shown[i]!;
        if (!a.riding) continue;
        const [bx, tall, bz] = buildScale(a.look);
        const k = PERSON * MODEL_SCALE;
        dummy.position.set(a.x, 0, a.z);
        dummy.rotation.set(0, a.facing, 0);
        dummy.scale.set(k * bx, k * tall, k * bz);
        dummy.updateMatrix();
        bikes.setMatrixAt(nb++, dummy.matrix);
      }
      bikes.count = nb;
      bikes.visible = nb > 0;
      if (nb) bikes.instanceMatrix.needsUpdate = true;
    } else if (caps) {
      // THE FALLBACK: the model could not be read, so capsules, as the town was drawn
      // before it had bodies. Solid people first and ghosts after, so each set of
      // meshes only has to span its own.
      shown.sort((a, b) => Number(a.ghost) - Number(b.ghost));
      let solids = 0;
      while (solids < used && !shown[solids]!.ghost) solids++;
      setCounts(caps, used, solids);
      for (let i = 0; i < used; i++) {
        const a = shown[i]!;
        const moving = a.state === 'walking' || a.state === 'approaching' || a.state === 'leaving';
        const bob = Math.sin(t * (moving ? 9 : 2) + a.seed) * (moving ? 0.06 : 0.03);
        hideAgent(a.ghost ? caps.solid : caps.ghost, i, hidden);
        poseAgent(a.ghost ? caps.ghost : caps.solid, i, a, bob, dummy, hidden, col, PERSON);
      }
      flag(caps.solid); flag(caps.ghost);
      bodied.current = used;
    } else {
      // Still loading: nobody yet, rather than capsules that turn into people.
      bodied.current = 0;
    }

    const p4 = prof.current.on ? performance.now() : 0;
    // WHO THEY ARE TO YOU, drawn for the people it is true of and nobody else: the
    // markers are packed, so a crowd of strangers writes nothing here at all. Each
    // mesh draws exactly as many as were written this frame, so nothing is left over
    // from the last one.
    const top = 1.55 * PERSON;
    let nd = 0;
    let nt = 0;
    let nr = 0;
    for (let i = 0; i < bodied.current; i++) {
      const a = shown[i]!;
      // Who they are to you: a disc at the feet. You in the accent, people you have
      // met in the secondary grey, strangers nothing. The body no longer says it.
      //
      // NOT YOUR OWN DISC WHILE YOU WALK. It exists to pick you out of sixty-four
      // people seen from above; behind your own head it is a purple plate you appear
      // to be standing on, and the founder asked what it was before he asked for it
      // to go (2026-09-23). Other people keep theirs -- that is how you spot someone
      // you have already met across the grass.
      const wearsDisc = a.kind === 'met' || (a.kind === 'you' && !cam.walking);
      if (wearsDisc) {
        dummy.position.set(a.x, 0.02 * PERSON, a.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(PERSON);
        dummy.updateMatrix();
        discs.setMatrixAt(nd, dummy.matrix);
        discs.setColorAt(nd, a.kind === 'you' ? col.you : col.met);
        nd++;
      }

      // Bubbles. Dots while two agents are together; then one still dot, the same for
      // every pair. It used to be a tick, a cross or a coloured dot -- a verdict on a
      // person, drawn over their head before either human had looked.
      if (a.bubble === 'dots') {
        for (let k = 0; k < DOTS_PER; k++) {
          const phase = Math.sin(t * 6 + k * 1.1);
          dummy.position.set(a.x + (k - 1) * 0.17 * PERSON, top + 0.06 * PERSON * Math.max(0, phase), a.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar((0.8 + 0.2 * Math.max(0, phase)) * PERSON);
          dummy.updateMatrix();
          dots.setMatrixAt(nt, dummy.matrix);
          dots.setColorAt(nt, col.prop);
          nt++;
        }
      } else if (a.bubble === 'met') {
        dummy.position.set(a.x, top + 0.05 * PERSON, a.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1.3 * PERSON);
        dummy.updateMatrix();
        dots.setMatrixAt(nt, dummy.matrix);
        dots.setColorAt(nt, col.prop);
        nt++;
      }

      if (ringShown(a)) {
        const pulse = (1 + 0.12 * Math.sin(t * 4)) * PERSON;
        dummy.position.set(a.x, 0.03 * PERSON, a.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(pulse);
        dummy.updateMatrix();
        rings.setMatrixAt(nr, dummy.matrix);
        rings.setColorAt(nr, ringYellow);
        nr++;
      }
    }
    discs.count = nd;
    dots.count = nt;
    rings.count = nr;
    upload(discs); upload(dots); upload(rings);

    if (prof.current.on) {
      const q = prof.current;
      const p5 = performance.now();
      q.sim += p1 - p0; q.vis += p3 - p2; q.crowd += p4 - p3; q.marks += p5 - p4; q.loop += p5 - q.start; q.frame += clamped * 1000; q.n++;
      if (t - q.at >= 2 && q.n) {
        const f = (x: number) => (x / q.n).toFixed(1);
        const lv = bodies ? `${bodies.stats.near}/${bodies.stats.middle}/${bodies.stats.far}/${bodies.stats.tiny}` : '-';
        console.log(`[perf] frame ${f(q.frame)} ms | loop ${f(q.loop)} | sim ${f(q.sim)} | visible ${f(q.vis)} | city ${f(q.city)} | crowd ${f(q.crowd)} | marks ${f(q.marks)} | render ${f(q.render)} | idle ${f(q.frame - q.loop - q.render)} | shown ${used} (${lv}) | calls ${gl.info.render.calls} | tris ${gl.info.render.triangles}`);
        q.at = t; q.n = 0; q.sim = 0; q.vis = 0; q.crowd = 0; q.marks = 0; q.city = 0; q.render = 0; q.frame = 0; q.loop = 0;
      }
    }

    if (!onStats) return;
    const ms = clamped * 1000;
    samples.current.push(ms);
    if (samples.current.length > 240) samples.current.shift();
    if (t <= 5) early.current.push(ms);
    else {
      late.current.push(ms);
      if (late.current.length > 300) late.current.shift();
    }
    if (t - lastReport.current >= 0.5) {
      lastReport.current = t;
      const sorted = [...samples.current].sort((a, b) => a - b);
      const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      onStats({
        fps: 1000 / (mean(samples.current) || 16.7),
        p50: pick(0.5),
        p95: pick(0.95),
        worst: sorted[sorted.length - 1] ?? 0,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        elapsed: t,
        earlyFps: 1000 / (mean(early.current) || 16.7),
        lateFps: 1000 / (mean(late.current) || 16.7),
      });
    }
  });

  /**
   * TAPS ON PEOPLE. The crowd is placed by the graphics chip, so there is no mesh where
   * anybody stands for three to hit: this object answers the ray itself, with whoever
   * of this frame's bodies it passes through nearest (pickAlong in ./visible.ts). It is
   * nearer the camera than the ground under them, so a tap on a person is never also a
   * tap on the tile.
   */
  const picker = useMemo(() => {
    const o = new THREE.Object3D();
    o.name = 'people';
    const at = new THREE.Vector3();
    o.raycast = (raycaster, hits) => {
      const i = pickAlong(raycaster.ray, shown, bodied.current, BODY_H, at);
      if (i >= 0) hits.push({ distance: raycaster.ray.origin.distanceTo(at), point: at.clone(), object: o, instanceId: i });
    };
    return o;
  }, [shown]);
  const tapPerson = (e: { instanceId?: number; stopPropagation(): void }) => {
    const ref = e.instanceId === undefined ? undefined : shown[e.instanceId]?.ref;
    if (ref && onTapAgent) { e.stopPropagation(); onTapAgent(ref); }
  };

  /** A tap on a tile, when the tiles are the unit: fly there. Close in, taps are for people. */
  const tapTile = (e: { point: { x: number; z: number }; stopPropagation(): void }) => {
    if (cam.band === 'near' || cam.fly) return;
    if (Math.hypot(e.point.x - venue.mapAt[0], e.point.z - venue.mapAt[1]) < 0.7 && onTapVenue) {
      e.stopPropagation();
      onTapVenue(venue.id);
      return;
    }
    const hit = MAP.areas.find((a) => pointInPolygon([e.point.x, e.point.z], a.polygon));
    if (!hit) return;
    e.stopPropagation();
    flyToArea(cam, hit.id, hit.id === (sim.get('you')?.area ?? null));
  };


  return (
    <>
      {/* Light from the screen's top-left in the isometric view, so the bevel highlight
          sits top-left and the skirt bottom-right, exactly as the UI's raised() does.
          In the evening the sun goes down and the lamps and windows carry the scene. */}
      {/* The evening keeps most of the light: the dark palette's page grey is already
          four times darker than the day's, and halving the light on top of that made
          the city a black field with dots on it (seen on the Seeker, 2026-09-21). */}
      <hemisphereLight args={colors.night ? ['#aab4cc', '#2a2e36', 0.95] : ['#ffffff', '#8a94a6', 0.95]} />
      <directionalLight position={[-4, 10, 8]} intensity={colors.night ? 0.6 : 0.75} />

      <primitive object={map.group} onClick={tapTile} />
      <primitive object={garden.group} />
      {city && <primitive object={city.group} />}
      <primitive object={furnitureHolder} />
      <primitive object={rigs.group} />
      <primitive object={bikes} />
      <primitive object={marks.group} />
      <primitive object={crowdHolder} />
      <primitive object={picker} onClick={tapPerson} />
      {meshes.capsules?.solid.all.map((p, i) => <primitive key={`s${i}`} object={p.mesh} />)}
      {meshes.capsules?.ghost.all.map((p, i) => <primitive key={`g${i}`} object={p.mesh} />)}
      <primitive object={meshes.discs} />
      <primitive object={meshes.dots} />
      <primitive object={meshes.rings} />
    </>
  );
}

// ── one character, up close ──────────────────────────────────────────────────

// The builder's stage and the You tab's card: the town's own body, one person at a
// time (./character-canvas.tsx). Re-exported so `loadWorldRenderer()` finds it here.
export { CharacterCanvas, type CharacterCanvasProps, type Focus } from './character-canvas';
