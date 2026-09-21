/**
 * The town, drawn.
 *
 * THIS IS THE ONLY FILE THAT IMPORTS three AND r3f AT THE TOP, and it is only ever
 * reached through `loadWorldRenderer()` in ./r3f.ts. Import it statically from a screen
 * and tests/native-imports.test.ts fails the build, on purpose.
 *
 * Budget, and why it is shaped like this: one draw call per kind of part. A person is
 * a body, a head, a hair piece or two, eyes, brows, and whatever their outfit and
 * extra add -- each an InstancedMesh with one slot per agent, written every frame,
 * scale zero when that person does not wear it. Practice profiles get a translucent
 * twin of every part. Sixty-four slots, no textures, no shadows, Lambert lighting;
 * about forty draw calls at worst against sixteen measured at 116 fps, and the bench
 * (features/dev/gl-bench.tsx) is what says whether that holds. The city under them
 * (./map-mesh.ts) is thirteen more draw calls and thirty-two thousand triangles,
 * built once and never touched per frame except the water's opacity.
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
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import * as THREE from 'three';
import { HAIR_HEX, OUTFIT_HEX, SKIN_HEX, pointInPolygon, type Look } from '@clone/shared';
import {
  CITY_BAND, FLY_SECS, bandOf, cityPose, clampTarget, flyAt, pan, pinch, tileZoom,
  type Band, type Bounds, type Fly, type Pose, type Size, type WorldControl,
} from './camera';
import { MAP, type Frame } from './map';
import { buildMap } from './map-mesh';
import type { SimAgent, WorldSim } from './sim';

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
}

const DEFAULT_FRAME: Frame = { top: 160, bottom: 100, side: 12 };
const BOUNDS: Bounds = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of MAP.outline) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, maxX, minZ, maxZ };
})();
/** Closest the camera starts: today's zoom, at which an agent is about forty pixels. */
const ZOOM_START = 30;

/**
 * The camera, as a plain mutable object shared by the gesture handlers (on the
 * wrapping View) and the frame loop (inside the canvas). No React state: a drag is
 * sixty updates a second and none of them should render anything.
 */
interface CamState {
  pose: Pose;
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
const BARS_PER = 2;

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
    bar: new THREE.BoxGeometry(0.5, 0.08, 0.08),
    ring: new THREE.TorusGeometry(0.55, 0.05, 6, 24),
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

function buildParts(g: Geometry, material: THREE.Material): PartSet {
  const mk = (geo: THREE.BufferGeometry, per = 1): Part => {
    const mesh = new THREE.InstancedMesh(geo, material, SLOTS * per);
    mesh.count = SLOTS * per;
    mesh.frustumCulled = false;
    return { mesh, per };
  };
  const set = {
    body: mk(g.body), head: mk(g.head), cap: mk(g.cap), back: mk(g.back), knob: mk(g.knob),
    eyes: mk(g.eye, 2), brows: mk(g.brow, 2), collar: mk(g.collar, 2), skirt: mk(g.skirt), trim: mk(g.trim),
    glasses: mk(g.glass, 2), hat: mk(g.hat), studs: mk(g.stud, 2),
  };
  return { ...set, all: Object.values(set) };
}

/** Eye spacing, size and tilt per face preset. Same order as shared/look.ts LOOK_LABELS.face. */
const FACE = [
  { gap: 0.14, eye: 1, dy: 0.02, tilt: 0 },        // Calm
  { gap: 0.16, eye: 1.15, dy: 0.03, tilt: -0.15 }, // Bright
  { gap: 0.14, eye: 0.8, dy: 0.0, tilt: 0.1 },     // Sleepy
  { gap: 0.17, eye: 1.3, dy: 0.03, tilt: -0.05 },  // Wide-eyed
  { gap: 0.13, eye: 1, dy: 0.02, tilt: 0.3 },      // Wry (one brow up)
  { gap: 0.14, eye: 0.9, dy: 0.01, tilt: 0.2 },    // Serious
] as const;
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
function poseAgent(set: PartSet, i: number, a: Posed, bob: number, dummy: THREE.Object3D, hidden: THREE.Matrix4, col: Colours) {
  const { look } = a;
  const f = a.facing;
  const fx = Math.sin(f), fz = Math.cos(f);       // forward
  const rx = Math.cos(f), rz = -Math.sin(f);      // right
  const headY = 1.12 + bob;
  const place = (p: Part, k: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rxr = 0, ryr = f, rzr = 0) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rxr, ryr, rzr);
    dummy.scale.set(sx, sy, sz);
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
  const h = look.hair;
  if (h === 7) hide(set.cap);
  else {
    const sy = h === 1 ? 0.45 : h === 2 ? 1.25 : 0.95;
    const sxz = h === 2 ? 1.2 : 1;
    place(set.cap, 0, a.x, headY + 0.02, a.z, sxz, sy, sxz);
    tint(set.cap, 0, hair);
  }
  if (h === 3 || h === 5) {
    const narrow = h === 5 ? 0.5 : 1;
    place(set.back, 0, a.x - fx * 0.12, headY - 0.2, a.z - fz * 0.12, narrow, 1, narrow);
    tint(set.back, 0, hair);
  } else hide(set.back);
  if (h === 4) { place(set.knob, 0, a.x - fx * 0.08, headY + 0.26, a.z - fz * 0.08, 1.1, 1.1, 1.1); tint(set.knob, 0, hair); }
  else if (h === 5) { place(set.knob, 0, a.x - fx * 0.24, headY - 0.1, a.z - fz * 0.24); tint(set.knob, 0, hair); }
  else if (h === 6) { place(set.knob, 0, a.x, headY + 0.24, a.z, 0.35, 2.2, 1.1); tint(set.knob, 0, hair); }
  else hide(set.knob);

  // face
  const face = FACE[look.face] ?? FACE[0];
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    const ex = a.x + fx * 0.19 + rx * face.gap * 0.5 * side;
    const ez = a.z + fz * 0.19 + rz * face.gap * 0.5 * side;
    place(set.eyes, k, ex, headY + face.dy, ez, face.eye, face.eye, face.eye);
    tint(set.eyes, k, col.eye);
    const tilt = k === 0 ? face.tilt : (look.face === 4 ? 0 : -face.tilt);
    place(set.brows, k, ex, headY + face.dy + 0.07, ez, 1, 1, 1, 0, f, tilt);
    tint(set.brows, k, col.hairDim[look.hairColor] ?? col.hairDim[0]!);
  }

  // outfit
  const o = look.outfit;
  const outfitDim = col.outfitDim[look.outfitColor] ?? col.outfitDim[0]!;
  if (o === 1 || o === 2 || o === 5 || o === 6) {
    place(set.collar, 0, a.x, 0.9 + bob, a.z, 1, 1, 1, Math.PI / 2, f, 0);
    tint(set.collar, 0, outfitDim);
  } else hide(set.collar, 0);
  if (o === 2 || o === 3 || o === 4) {
    const short = o === 2 ? 0.6 : 1;
    place(set.skirt, 0, a.x, 0.22 + bob, a.z, bx, short, bz);
    tint(set.skirt, 0, col.outfit[look.outfitColor] ?? col.outfit[0]!);
  } else hide(set.skirt);
  if (o === 4) { place(set.trim, 0, a.x + fx * 0.29, 0.72 + bob, a.z + fz * 0.29, 1, 1.6, 1, 0, f, 0.7); tint(set.trim, 0, outfitDim); }
  else if (o === 5) { place(set.trim, 0, a.x + fx * 0.29 + rx * 0.08, 0.7 + bob, a.z + fz * 0.29 + rz * 0.08, 1, 1, 1, 0, f, 0); tint(set.trim, 0, outfitDim); }
  else if (o === 6) { place(set.trim, 0, a.x + fx * 0.29, 0.68 + bob, a.z + fz * 0.29, 0.5, 1, 1, 0, f, 0); tint(set.trim, 0, col.eye); }
  else if (o === 7) { place(set.trim, 0, a.x + fx * 0.29, 0.6 + bob, a.z + fz * 0.29, 1, 1.6, 1, 0, f, Math.PI / 2); tint(set.trim, 0, col.white); }
  else hide(set.trim);

  // extra
  const x = look.accessory;
  if (x === 1) {
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      place(set.glasses, k, a.x + fx * 0.21 + rx * face.gap * 0.5 * side, headY + face.dy, a.z + fz * 0.21 + rz * face.gap * 0.5 * side, 1, 1, 1, 0, f, 0);
      tint(set.glasses, k, col.prop);
    }
  } else { hide(set.glasses, 0); hide(set.glasses, 1); }
  if (x === 2) { place(set.hat, 0, a.x, headY + 0.22, a.z); tint(set.hat, 0, col.outfitDim[(look.outfitColor + 3) % 12]!); } else hide(set.hat);
  if (x === 3) {
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      place(set.studs, k, a.x + rx * 0.22 * side, headY - 0.04, a.z + rz * 0.22 * side);
      tint(set.studs, k, col.warning);
    }
  } else { hide(set.studs, 0); hide(set.studs, 1); }
  if (x === 4) { place(set.collar, 1, a.x, 0.88 + bob, a.z, 1.15, 1.15, 1.3, Math.PI / 2, f, 0); tint(set.collar, 1, col.outfit[(look.outfitColor + 6) % 12]!); }
  else hide(set.collar, 1);
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
  const { cap30 = false, active = true, sim, control, frame = DEFAULT_FRAME } = props;
  const cam = useRef<CamState | null>(null);
  if (!cam.current) {
    const [hx, hz] = sim.homeOf('you');
    const size = { width: 390, height: 800 };
    cam.current = {
      pose: { tx: hx, tz: hz, zoom: ZOOM_START }, fly: null, follow: true, followAfterFly: true, band: null,
      size, city: cityPose(MAP.outline, size, frame), clock: 0, lastDx: 0, lastDy: 0, pinchDist: null,
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
    onPanResponderGrant: (_e, g) => { c.fly = null; c.follow = false; c.lastDx = g.dx; c.lastDy = g.dy; c.pinchDist = null; },
    onPanResponderMove: (e, g) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        const a = t[0]!; const b = t[1]!;
        const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        const mid: [number, number] = [(a.locationX + b.locationX) / 2, (a.locationY + b.locationY) / 2];
        if (c.pinchDist && d > 0) c.pose = clampTarget(pinch(c.pose, mid, d / c.pinchDist, c.size, c.city.zoom), BOUNDS);
        c.pinchDist = d; c.lastDx = g.dx; c.lastDy = g.dy;
        return;
      }
      c.pinchDist = null;
      const dx = g.dx - c.lastDx; const dy = g.dy - c.lastDy;
      c.lastDx = g.dx; c.lastDy = g.dy;
      c.pose = clampTarget(pan(c.pose, dx, dy), BOUNDS);
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
      flyTo: (id) => flyToArea(c, id, false),
      flyHome: () => flyToArea(c, sim.get('you')?.area ?? null, true),
      flyCity: () => startFly(c, c.city, false),
    };
    return () => { control.current = null; };
  }, [control, c, sim]);

  return (
    <View style={{ flex: 1 }} onLayout={onLayout} {...responder.panHandlers}>
      <Canvas
        orthographic
        // Zoom 30, up from 24: at 24 the square filled the middle third of a phone
        // and an agent was thirty pixels tall, which is why tapping one took aim.
        camera={{ position: [12, 12, 12], zoom: ZOOM_START, near: 0.1, far: 200 }}
        // No dpr prop: expo-gl renders at the phone's native pixel ratio and nothing
        // else, and the native Canvas type says so by leaving it out.
        gl={{ antialias: false }}
        frameloop={!active ? 'never' : cap30 ? 'demand' : 'always'}
      >
        <Town {...props} cam={c} />
      </Canvas>
    </View>
  );
}

/** Where the camera stands relative to what it looks at: the isometric (1,1,1). */
const EYE = 12;
/** How fast the camera catches up with your agent: 1 - e^(-k·dt) per frame. */
const FOLLOW = 3;

function Town({ sim, colors, cap30, onStats, onTapAgent, onFirstFrame, onBand, cam }: WorldCanvasProps & { cam: CamState }) {
  const { gl, scene, camera, invalidate } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(colors.bg);
  }, [scene, colors.bg]);

  // The city, built once per palette; the theme toggle rebuilds it (lamps, windows).
  const map = useMemo(() => buildMap(MAP, colors), [colors]);
  useEffect(() => () => map.dispose(), [map]);
  const yourArea = useRef<string | null | undefined>(undefined);

  // 30 fps: r3f's demand mode draws only when asked, so ask on a 33 ms ticker.
  useEffect(() => {
    if (!cap30) return;
    const t = setInterval(() => invalidate(), 33);
    return () => clearInterval(t);
  }, [cap30, invalidate]);

  const meshes = useMemo(() => {
    const g = buildGeometry();
    const solid = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const ghost = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 });
    const mk = (geo: THREE.BufferGeometry, n: number) => {
      const im = new THREE.InstancedMesh(geo, solid, n);
      im.count = n;
      im.frustumCulled = false;
      return im;
    };
    return {
      solid: buildParts(g, solid),
      ghost: buildParts(g, ghost),
      discs: mk(g.disc, SLOTS),
      dots: mk(g.dot, SLOTS * DOTS_PER),
      bars: mk(g.bar, SLOTS * BARS_PER),
      rings: mk(g.ring, SLOTS),
      geometries: Object.values(g),
      materials: [solid, ghost],
    };
  }, []);

  useEffect(() => () => {
    for (const g of meshes.geometries) g.dispose();
    for (const m of meshes.materials) m.dispose();
  }, [meshes]);

  const col = useMemo(() => buildColours(colors), [colors]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const hidden = useMemo(() => {
    const o = new THREE.Object3D();
    o.scale.setScalar(0);
    o.updateMatrix();
    return o.matrix;
  }, []);
  /** Instance slot → agent ref, for taps. Written in the frame loop, read on click. */
  const refAt = useRef<string[]>([]);

  // Frame-time ring buffer, in refs.
  const samples = useRef<number[]>([]);
  const early = useRef<number[]>([]);
  const late = useRef<number[]>([]);
  const elapsed = useRef(0);
  const lastReport = useRef(0);
  const drawn = useRef(false);

  useFrame((_, dt) => {
    if (!drawn.current) { drawn.current = true; onFirstFrame?.(); }
    const clamped = Math.min(dt, 0.1);
    elapsed.current += clamped;
    const t = elapsed.current;
    sim.step(clamped);

    // Your tile, lit once your agent knows which it is.
    const you = sim.get('you');
    if (you && you.area !== yourArea.current) { yourArea.current = you.area; map.setYourTile(you.area); }

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
    camera.position.set(cam.pose.tx + EYE, EYE, cam.pose.tz + EYE);
    camera.lookAt(cam.pose.tx, 0, cam.pose.tz);
    if (camera.zoom !== cam.pose.zoom) { camera.zoom = cam.pose.zoom; camera.updateProjectionMatrix(); }
    if (!cam.fly) {
      const band = bandOf(cam.pose.zoom, cam.city.zoom);
      if (band !== cam.band) { cam.band = band; onBand?.(band); }
    }

    // The lakes breathe: a four-second sine on the opacity, and the glow at night.
    const breath = 0.5 + 0.5 * Math.sin(t * (Math.PI / 2));
    map.water.opacity = 0.72 + 0.16 * breath;
    if (colors.night) map.water.emissiveIntensity = 0.25 + 0.2 * breath;

    const { solid, ghost, discs, dots, bars, rings } = meshes;
    const agents = sim.agents();
    const n = Math.min(agents.length, SLOTS);
    refAt.current.length = n;

    for (let i = 0; i < SLOTS; i++) {
      const a = i < n ? (agents[i] as SimAgent) : null;
      if (!a || a.state === 'gone') {
        hideAgent(solid, i, hidden); hideAgent(ghost, i, hidden);
        discs.setMatrixAt(i, hidden); rings.setMatrixAt(i, hidden);
        for (let k = 0; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
        continue;
      }
      refAt.current[i] = a.ref;
      const moving = a.state === 'walking' || a.state === 'approaching' || a.state === 'leaving';
      const bob = Math.sin(t * (moving ? 9 : 2) + a.seed) * (moving ? 0.06 : 0.03);
      const set = a.ghost ? ghost : solid;
      hideAgent(a.ghost ? solid : ghost, i, hidden);
      poseAgent(set, i, a, bob, dummy, hidden, col);

      // Who they are to you: a disc at the feet. You in the accent, people you have
      // met in the secondary grey, strangers nothing. The body no longer says it.
      if (a.kind === 'you' || a.kind === 'met') {
        dummy.position.set(a.x, 0.02, a.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        discs.setMatrixAt(i, dummy.matrix);
        discs.setColorAt(i, a.kind === 'you' ? col.you : col.met);
      } else discs.setMatrixAt(i, hidden);

      // Bubbles. Dots while talking; a tick, a cross or a single dot for the verdict.
      const top = 1.55 + bob;
      if (a.bubble === 'dots') {
        for (let k = 0; k < DOTS_PER; k++) {
          const phase = Math.sin(t * 6 + k * 1.1);
          dummy.position.set(a.x + (k - 1) * 0.17, top + 0.06 * Math.max(0, phase), a.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(0.8 + 0.2 * Math.max(0, phase));
          dummy.updateMatrix();
          dots.setMatrixAt(i * DOTS_PER + k, dummy.matrix);
          dots.setColorAt(i * DOTS_PER + k, col.prop);
        }
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
      } else if (a.bubble === 'got_on' || a.bubble === 'did_not_click') {
        const ok = a.bubble === 'got_on';
        const colour = ok ? col.success : col.danger;
        // A tick is a short bar and a long bar at 45°; a cross is two equal bars.
        for (let k = 0; k < BARS_PER; k++) {
          dummy.position.set(a.x + (ok && k === 0 ? -0.12 : 0), top + 0.05, a.z);
          dummy.rotation.set(0, Math.PI / 4, k === 0 ? Math.PI / 4 : -Math.PI / 4);
          dummy.scale.set(ok && k === 0 ? 0.55 : 1, 1, 1);
          dummy.updateMatrix();
          bars.setMatrixAt(i * BARS_PER + k, dummy.matrix);
          bars.setColorAt(i * BARS_PER + k, colour);
        }
        for (let k = 0; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
      } else if (a.bubble === 'unsure' || a.bubble === 'could_not_tell') {
        dummy.position.set(a.x, top + 0.05, a.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1.3);
        dummy.updateMatrix();
        dots.setMatrixAt(i * DOTS_PER, dummy.matrix);
        dots.setColorAt(i * DOTS_PER, a.bubble === 'unsure' ? col.warning : col.grey);
        for (let k = 1; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
      } else {
        for (let k = 0; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
      }

      if (a.ring) {
        const pulse = 1 + 0.12 * Math.sin(t * 4);
        dummy.position.set(a.x, 0.03, a.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(pulse);
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
        rings.setColorAt(i, col.accent);
      } else {
        rings.setMatrixAt(i, hidden);
      }
    }

    flag(solid); flag(ghost);
    for (const m of [discs, dots, bars, rings]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
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

  const tap = (e: { instanceId?: number; stopPropagation(): void }) => {
    const ref = e.instanceId === undefined ? undefined : refAt.current[e.instanceId];
    if (ref && onTapAgent) { e.stopPropagation(); onTapAgent(ref); }
  };

  /** A tap on a tile, when the tiles are the unit: fly there. Close in, taps are for people. */
  const tapTile = (e: { point: { x: number; z: number }; stopPropagation(): void }) => {
    if (cam.band === 'near' || cam.fly) return;
    const hit = MAP.areas.find((a) => pointInPolygon([e.point.x, e.point.z], a.polygon));
    if (!hit) return;
    e.stopPropagation();
    flyToArea(cam, hit.id, hit.id === (sim.get('you')?.area ?? null));
  };

  const rest = (set: PartSet) => set.all.filter((p) => p !== set.body && p !== set.head);

  return (
    <>
      {/* Light from the screen's top-left in the isometric view, so the bevel highlight
          sits top-left and the skirt bottom-right, exactly as the UI's raised() does.
          In the evening the sun goes down and the lamps and windows carry the scene. */}
      <hemisphereLight args={colors.night ? ['#8f9ab3', '#2a2e36', 0.6] : ['#ffffff', '#8a94a6', 0.95]} />
      <directionalLight position={[-4, 10, 8]} intensity={colors.night ? 0.35 : 0.75} />

      <primitive object={map.group} onClick={tapTile} />

      {/* Taps land on bodies and heads, solid or ghost; the smaller parts pass through. */}
      <primitive object={meshes.solid.body.mesh} onClick={tap} />
      <primitive object={meshes.solid.head.mesh} onClick={tap} />
      <primitive object={meshes.ghost.body.mesh} onClick={tap} />
      <primitive object={meshes.ghost.head.mesh} onClick={tap} />
      {rest(meshes.solid).map((p, i) => <primitive key={`s${i}`} object={p.mesh} />)}
      {rest(meshes.ghost).map((p, i) => <primitive key={`g${i}`} object={p.mesh} />)}
      <primitive object={meshes.discs} />
      <primitive object={meshes.dots} />
      <primitive object={meshes.bars} />
      <primitive object={meshes.rings} />
    </>
  );
}

// ── one character, up close ──────────────────────────────────────────────────

export interface CharacterCanvasProps {
  look: Look;
  colors: WorldColors;
  height?: number;
}

/**
 * The builder's preview: the same parts, the same pose code, one slot, turning slowly.
 * Preview equals town by construction.
 */
export function CharacterCanvas({ look, colors, height = 260 }: CharacterCanvasProps) {
  return (
    <Canvas style={{ height }} camera={{ position: [0, 1.0, 3.1], fov: 32 }} gl={{ antialias: false }} frameloop="always">
      <Figure look={look} colors={colors} />
    </Canvas>
  );
}

function Figure({ look, colors }: { look: Look; colors: WorldColors }) {
  const { scene } = useThree();
  useEffect(() => { scene.background = new THREE.Color(colors.bg); }, [scene, colors.bg]);
  const g = useMemo(() => buildGeometry(), []);
  const set = useMemo(() => buildParts(g, new THREE.MeshLambertMaterial({ color: '#ffffff' })), [g]);
  useEffect(() => () => { for (const geo of Object.values(g)) geo.dispose(); }, [g]);
  const col = useMemo(() => buildColours(colors), [colors]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const hidden = useMemo(() => { const o = new THREE.Object3D(); o.scale.setScalar(0); o.updateMatrix(); return o.matrix; }, []);
  const lookRef = useRef(look);
  useEffect(() => { lookRef.current = look; }, [look]);
  const t = useRef(0);

  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1);
    for (let i = 1; i < SLOTS; i++) hideAgent(set, i, hidden);
    poseAgent(set, 0, { x: 0, z: 0, facing: Math.sin(t.current * 0.5) * 0.7, look: lookRef.current },
      Math.sin(t.current * 2) * 0.02, dummy, hidden, col);
    flag(set);
  });

  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a94a6', 0.95]} />
      <directionalLight position={[3, 6, 4]} intensity={0.8} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[1.1, 24]} />
        <meshLambertMaterial color={colors.ground} />
      </mesh>
      {set.all.map((p, i) => <primitive key={i} object={p.mesh} />)}
    </>
  );
}
