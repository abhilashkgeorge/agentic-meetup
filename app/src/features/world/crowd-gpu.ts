/**
 * Everybody in the town as a real, walking person -- a thousand of them if need be --
 * without the phone's JavaScript thread paying for each one.
 *
 * WHAT WAS WRONG (the founder, 2026-09-28: "even at 1000 people the gameplay should
 * be smooth. I don't want users to be shown as capsules"). Twelve people got a rigged
 * body and everybody else was a capsule, and even so the frame was the JavaScript
 * thread's, not the graphics chip's. Measured on the Seeker, debug build, 1000 people
 * in the park and 183 on screen: a 35 ms frame, of which the capsules' per-part
 * matrices were 11.3 ms, the twelve rigs' animation mixers and skeletons 4 ms, and
 * three issuing 83 draw calls 9.5 ms. And a person's body was built -- geometry
 * merged, colours baked -- the moment they came near, on that same thread, which is
 * the "one person after the other" the founder watched appear.
 *
 * WHAT THIS DOES INSTEAD. The graphics chip does the work, and the JavaScript thread
 * writes a few numbers a person:
 *
 *   1. THE ANIMATION IS BAKED ONCE. Walk and idle are sampled at 60 frames a second
 *      when the model loads, and every bone's skinning matrix for every frame goes in
 *      one float texture (22 bones, 180 frames). The vertex shader reads the frame it
 *      needs; no mixer, no skeleton, no bone upload per person, ever.
 *   2. EVERY PART OF EVERY OUTFIT IS IN ONE MESH. A person picks their head, top,
 *      legs, feet, beard and accessory in the vertex shader; the parts they are not
 *      wearing are sent off screen before a single texture is read. Nothing is built
 *      per person, so nobody waits to be "dressed".
 *   3. THREE LEVELS OF DETAIL, three draw calls in all. Near: the full model. Middle:
 *      the same parts with nearby vertices merged (about a third of the triangles).
 *      Far: one merged outfit per head, merged harder -- at forty pixels tall a person
 *      is a silhouette, their colours, and their hair. Past the park's mist, nothing.
 *   4. ONE BUFFER PER LEVEL, written once a frame: 32 numbers a person (where they
 *      are, which way they face, where they are in their walk, their colours and
 *      their parts). Expo's GL copies whatever it is given, so the buffers are small.
 *
 * Practice profiles are drawn see-through by leaving out every other pixel (a
 * checkerboard in the fragment shader), so they need no second, blended pass.
 *
 * Reached only through canvas.tsx, like the other files that import three (LAZY_ONLY
 * in tests/native-imports.test.ts).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALD, HAIR_HEX, LOOK_PARTS, LOOK_SIZES, OUTFIT_HEX, SKIN_HEX, type Look } from '@clone/shared';
import { LOOKS, SLOTS, buildScale, partsOf, type LookKey, type LookPieces, type Role } from './character';
import { EXTRA_OWN_COLOUR, MODEL_SCALE, buildExtras, readModel, type Manifest } from './character-mesh';

/** Where each role takes its colour from (aMeta.x). */
export const ROLE: Record<Role | 'extra', number> = { skin: 0, hair: 1, top: 2, plain: 3, extra: 4 };
/** Which choice a vertex belongs to (aMeta.y): the four wardrobe slots, then these. */
export const SLOT_ID = { head: 0, top: 1, legs: 2, feet: 3, beard: 4, extra: 5, outfit: 6 } as const;
/** The accessories, in LOOK_LABELS.accessory order after "Nothing". */
const EXTRA_KINDS = ['glasses', 'cap', 'earrings', 'scarf'] as const;

/** Numbers per person in a level's buffer: eight vec4s (see the shader's attributes). */
export const STRIDE = 32;
/** The baked animation's frame rate. Nearest frame, so no blending between frames. */
export const BAKE_FPS = 60;

/**
 * The three levels: how far each reaches from the camera, how many people each may
 * hold, and how hard its vertices are merged (0: not at all). Distances in town units
 * (a person is 0.23 tall); the park's mist ends at VIEW in canvas.tsx.
 */
export const LEVELS = [
  { name: 'near', until: 4.5, max: 12, merge: 0 },
  { name: 'middle', until: 14, max: 96, merge: 0.05 },
  { name: 'far', until: Infinity, max: 512, merge: 0.1 },
] as const;

// ── the animation ────────────────────────────────────────────────────────────

export interface Bake {
  /** RGBA float texels: `width` = bones * 4 (one column of a matrix each), rows = frames. */
  data: Float32Array;
  width: number;
  rows: number;
  /** First row and frame count of each clip. */
  walk: { row: number; frames: number };
  idle: { row: number; frames: number };
}

/**
 * Every bone's skinning matrix -- bone world matrix times its inverse bind matrix,
 * exactly what three's Skeleton.update computes -- for every frame of walk and idle.
 * The armature is posed at the origin; where a person stands is applied afterwards.
 */
export function bakeClips(
  armature: THREE.Object3D,
  boneNames: readonly string[],
  boneInverses: readonly THREE.Matrix4[],
  clips: ReadonlyMap<string, THREE.AnimationClip>,
): Bake {
  const root = cloneRig(armature);
  const found = new Map<string, THREE.Bone>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) found.set(o.name, o as THREE.Bone); });
  const bones = boneNames.map((n) => {
    const b = found.get(n);
    if (!b) throw new Error(`the baked rig is missing bone "${n}"`);
    return b;
  });
  const walk = clips.get('walk');
  const idle = clips.get('idle');
  if (!walk || !idle) throw new Error('the model needs a walk and an idle clip');
  const framesOf = (c: THREE.AnimationClip) => Math.max(1, Math.round(c.duration * BAKE_FPS));
  const w = framesOf(walk);
  const i = framesOf(idle);
  const width = bones.length * 4;
  const data = new Float32Array(width * (w + i) * 4);
  const mixer = new THREE.AnimationMixer(root);
  const m = new THREE.Matrix4();
  let row = 0;
  for (const [clip, frames] of [[walk, w], [idle, i]] as const) {
    const action = mixer.clipAction(clip);
    action.reset().play();
    for (let f = 0; f < frames; f++, row++) {
      mixer.setTime(f / BAKE_FPS);
      root.updateMatrixWorld(true);
      for (let b = 0; b < bones.length; b++) {
        m.multiplyMatrices(bones[b]!.matrixWorld, boneInverses[b]!);
        data.set(m.elements, (row * width + b * 4) * 4);
      }
    }
    action.stop();
  }
  mixer.stopAllAction();
  return { data, width, rows: w + i, walk: { row: 0, frames: w }, idle: { row: w, frames: i } };
}

/**
 * The shader's skinning, in JavaScript: where vertex `v` lands at `row`. For the test
 * that holds the bake to three's own CPU skinning; the GPU does exactly this.
 */
export function skinFromBake(bake: Bake, row: number, index: readonly number[], weight: readonly number[], v: THREE.Vector3): THREE.Vector3 {
  const out = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    if (!weight[k]) continue;
    const at = (row * bake.width + index[k]! * 4) * 4;
    m.fromArray(bake.data, at);
    out.addScaledVector(p.copy(v).applyMatrix4(m), weight[k]!);
  }
  return out;
}

// ── the parts ────────────────────────────────────────────────────────────────

/**
 * Merge nearby vertices: every vertex within the same `h`-sized cell becomes the first
 * one found there (keeping its bone weights, so the merged mesh still walks), the
 * triangles that collapse are dropped, and only the vertices still used are kept.
 * Crude beside a real simplifier and free of any dependency; at the distances it is
 * used, a person is tens of pixels tall.
 */
export function mergeNear(geo: THREE.BufferGeometry, h: number): THREE.BufferGeometry {
  const pos = geo.attributes.position!;
  const index = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const rep = new Int32Array(pos.count);
  const cells = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = ((Math.floor(pos.getX(i) / h) + 1024) * 2048 + (Math.floor(pos.getY(i) / h) + 1024)) * 2048
      + (Math.floor(pos.getZ(i) / h) + 1024);
    const r = cells.get(key);
    if (r === undefined) { cells.set(key, i); rep[i] = i; } else rep[i] = r;
  }
  const kept: number[] = [];
  const seen = new Set<number>();
  const n = pos.count;
  for (let t = 0; t < index.length; t += 3) {
    const a = rep[index[t]!]!, b = rep[index[t + 1]!]!, c = rep[index[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    const [x, y, z] = [a, b, c].sort((p, q) => p - q) as [number, number, number];
    const key = (x * n + y) * n + z;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(a, b, c);
  }
  const remap = new Map<number, number>();
  const order: number[] = [];
  for (const v of kept) if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray;
    const arr = new Ctor(order.length * a.itemSize);
    order.forEach((src, dst) => {
      for (let k = 0; k < a.itemSize; k++) arr[dst * a.itemSize + k] = a.array[src * a.itemSize + k]!;
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex(kept.map((v) => remap.get(v)!));
  return out;
}

/**
 * One piece, ready to be merged with every other: the four attributes the model
 * carries, a colour (the artist's, for pieces nobody recolours), and aMeta -- the
 * role, the slot and the variant the shader selects on.
 */
function tagged(src: THREE.BufferGeometry, meta: { role: number; slot: number; variant: number }, colour: THREE.Color, merge: number): THREE.BufferGeometry {
  const base = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight'] as const) {
    const a = src.attributes[name];
    if (!a) throw new Error(`a body piece has no ${name}`);
    base.setAttribute(name, a);
  }
  if (src.index) base.setIndex(src.index);
  const g = merge > 0 ? mergeNear(base, merge) : base.clone();
  const n = g.attributes.position!.count;
  const rgb = new Float32Array(n * 3);
  const tag = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = colour.r; rgb[i * 3 + 1] = colour.g; rgb[i * 3 + 2] = colour.b;
    tag[i * 4] = meta.role; tag[i * 4 + 1] = meta.slot; tag[i * 4 + 2] = meta.variant;
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  g.setAttribute('aMeta', new THREE.BufferAttribute(tag, 4));
  // Every attribute is read as float by the shader. The model's own come with whatever
  // flag the loader gave them, and merging refuses a mix.
  for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).gpuType = THREE.FloatType;
  return g;
}

/**
 * An accessory as a skinned piece: hung rigidly on the head bone, so it is carried
 * into the bone's bind space (the same space `HEAD` in character-mesh.ts measures in)
 * and weighted wholly to it.
 */
function extraPiece(geo: THREE.BufferGeometry, head: number, headBind: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.clone() : geo.clone();
  g.applyMatrix4(headBind);
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const n = g.attributes.position!.count;
  const normals = g.attributes.normal!;
  const packed = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) packed[i] = Math.round(Math.max(-1, Math.min(1, normals.array[i]!)) * 127);
  g.setAttribute('normal', new THREE.BufferAttribute(packed, 3, true));
  const idx = new Uint8Array(n * 4);
  const wgt = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = head; wgt[i * 4] = 255; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4, true));
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

export interface CrowdParts {
  /** Mesh name -> geometry, and the artist's colour, straight from people.glb. */
  geometry: ReadonlyMap<string, THREE.BufferGeometry>;
  colour: ReadonlyMap<string, THREE.Color>;
  pieces: (key: LookKey) => LookPieces | undefined;
  beards: readonly string[];
  /** The Head bone's index, and the matrix that carries head-bone space into bind space. */
  head: number;
  headBind: THREE.Matrix4;
}

/**
 * The three meshes' geometry: every slot of every outfit (and the beards and
 * accessories) for near and middle, one merged outfit per head for far.
 */
export function buildLevels(parts: CrowdParts): THREE.BufferGeometry[] {
  const white = new THREE.Color(1, 1, 1);
  const colourOf = (mesh: string, role: Role) => (role === 'plain' ? parts.colour.get(mesh) ?? white : white);
  const extras = buildExtras();
  const slotPieces = (merge: number) => {
    const out: THREE.BufferGeometry[] = [];
    LOOKS.forEach((key, variant) => {
      for (const slot of SLOTS) {
        for (const p of parts.pieces(key)?.[slot] ?? []) {
          const g = parts.geometry.get(p.mesh);
          if (!g) continue;
          out.push(tagged(g, { role: ROLE[p.role], slot: SLOT_ID[slot], variant }, colourOf(p.mesh, p.role), merge));
        }
      }
    });
    parts.beards.forEach((mesh, i) => {
      const g = parts.geometry.get(mesh);
      if (g) out.push(tagged(g, { role: ROLE.hair, slot: SLOT_ID.beard, variant: i + 1 }, white, merge));
    });
    EXTRA_KINDS.forEach((kind, i) => {
      out.push(tagged(extraPiece(extras[kind], parts.head, parts.headBind),
        { role: ROLE.extra, slot: SLOT_ID.extra, variant: i + 1 }, white, 0));
    });
    return out;
  };
  const outfits = (merge: number) => {
    const out: THREE.BufferGeometry[] = [];
    LOOKS.forEach((key, variant) => {
      for (const slot of SLOTS) {
        for (const p of parts.pieces(key)?.[slot] ?? []) {
          const g = parts.geometry.get(p.mesh);
          if (!g) continue;
          out.push(tagged(g, { role: ROLE[p.role], slot: SLOT_ID.outfit, variant }, colourOf(p.mesh, p.role), merge));
        }
      }
    });
    return out;
  };
  const merged = (pieces: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(pieces, false);
    for (const p of pieces) p.dispose();
    if (!g) throw new Error('the crowd pieces did not merge: their attributes differ');
    return g;
  };
  for (const e of Object.values(extras)) e.dispose();
  return [
    merged(slotPieces(LEVELS[0].merge)),
    merged(slotPieces(LEVELS[1].merge)),
    merged(outfits(LEVELS[2].merge)),
  ];
}

// ── one person, as numbers ───────────────────────────────────────────────────

/** A look as one number, so its 24 fixed numbers are worked out once per look. */
export const lookKey = (look: Look): number => {
  let key = 0;
  for (const part of LOOK_PARTS) key = key * LOOK_SIZES[part] + (look[part] ?? 0);
  return key;
};

/**
 * The 24 numbers of a person that do not move: their colours in linear space, their
 * build, and which variant of each slot they wear (the order of STRIDE's last six
 * vec4s). Everything here comes from `partsOf` and the catalogs it reads, so the GPU
 * dresses somebody exactly as the builder shows them.
 */
export function fixedOf(look: Look, pieces: CrowdParts['pieces'], beards: readonly string[]): Float32Array {
  const who = partsOf(look, pieces, beards);
  const c = new THREE.Color();
  const out = new Float32Array(24);
  const [bx, , bz] = buildScale(look);
  c.set(SKIN_HEX[look.skin] ?? SKIN_HEX[3]!); out.set([c.r, c.g, c.b, bx], 0);
  c.set(HAIR_HEX[look.hairColor] ?? HAIR_HEX[0]!); out.set([c.r, c.g, c.b, bz], 4);
  c.set(OUTFIT_HEX[look.outfitColor] ?? OUTFIT_HEX[0]!); out.set([c.r, c.g, c.b, 0], 8);
  const extra = who.extra === 'none' ? 0 : EXTRA_KINDS.indexOf(who.extra) + 1;
  c.set(who.extra === 'none' ? '#ffffff' : (who.extraTint ?? EXTRA_OWN_COLOUR[who.extra]));
  out.set([c.r, c.g, c.b, 0], 12);
  const v = (k: LookKey) => LOOKS.indexOf(k);
  out.set([v(who.wearing.head), v(who.wearing.top), v(who.wearing.legs), v(who.wearing.feet)], 16);
  out.set([look.beard > 0 && beards[look.beard - 1] ? look.beard : 0, extra, look.head === BALD ? 1 : 0, 0], 20);
  return out;
}

/**
 * The shader's choice, in JavaScript: does a vertex tagged `meta` (role, slot,
 * variant) belong to the person whose fixed numbers are `f`? Mirrors VERTEX_SELECT
 * line for line, so a test can dress somebody with no GPU in the room.
 */
export function wears(meta: readonly [number, number, number], f: Float32Array): boolean {
  const [role, slot, variant] = meta;
  const want = slot === SLOT_ID.head ? f[16]! : slot === SLOT_ID.top ? f[17]! : slot === SLOT_ID.legs ? f[18]!
    : slot === SLOT_ID.feet ? f[19]! : slot === SLOT_ID.beard ? f[20]! : slot === SLOT_ID.extra ? f[21]! : f[16]!;
  const bald = f[22]! > 0.5 && role === ROLE.hair && (slot === SLOT_ID.head || slot === SLOT_ID.outfit);
  return Math.abs(variant - want) <= 0.5 && !bald;
}

// ── the shader ───────────────────────────────────────────────────────────────

const VERTEX_PARS = /* glsl */`
uniform highp sampler2D uBake;
uniform vec4 uClips;
uniform float uFps;
uniform float uTime;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aMeta;
attribute vec4 aPos;
attribute vec4 aAnim;
attribute vec4 aSkin;
attribute vec4 aHair;
attribute vec4 aTop;
attribute vec4 aExtra;
attribute vec4 aSel;
attribute vec4 aSel2;
varying float vGhost;
mat4 crowdBone(int row, float b) {
  int x = int(b + 0.5) * 4;
  return mat4(texelFetch(uBake, ivec2(x, row), 0), texelFetch(uBake, ivec2(x + 1, row), 0),
              texelFetch(uBake, ivec2(x + 2, row), 0), texelFetch(uBake, ivec2(x + 3, row), 0));
}
mat4 crowdPose(int row) {
  return crowdBone(row, skinIndex.x) * skinWeight.x + crowdBone(row, skinIndex.y) * skinWeight.y
       + crowdBone(row, skinIndex.z) * skinWeight.z + crowdBone(row, skinIndex.w) * skinWeight.w;
}
`;

/** Pick this vertex's part or send it off screen; then its colour. Runs first in main. */
const VERTEX_SELECT = /* glsl */`
float crowdRole = aMeta.x;
float crowdSlot = aMeta.y;
float crowdWant = crowdSlot < 0.5 ? aSel.x : crowdSlot < 1.5 ? aSel.y : crowdSlot < 2.5 ? aSel.z
  : crowdSlot < 3.5 ? aSel.w : crowdSlot < 4.5 ? aSel2.x : crowdSlot < 5.5 ? aSel2.y : aSel.x;
bool crowdBald = aSel2.z > 0.5 && crowdRole > 0.5 && crowdRole < 1.5 && (crowdSlot < 0.5 || crowdSlot > 5.5);
if (abs(aMeta.z - crowdWant) > 0.5 || crowdBald) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vGhost = 0.0; return; }
vColor = vec4(crowdRole < 0.5 ? aSkin.rgb : crowdRole < 1.5 ? aHair.rgb : crowdRole < 2.5 ? aTop.rgb
  : crowdRole < 3.5 ? color : aExtra.rgb, 1.0);
vGhost = aAnim.w;
`;

/** Where in their walk (or idle) they are, and where they stand: one matrix. */
const VERTEX_SKIN = /* glsl */`
int crowdWalkRow = int(uClips.x + mod(floor((uTime + aAnim.x) * uFps), uClips.y));
int crowdIdleRow = int(uClips.z + mod(floor((uTime + aAnim.y) * uFps), uClips.w));
mat4 crowdSkin = aAnim.z > 0.995 ? crowdPose(crowdWalkRow) : aAnim.z < 0.005 ? crowdPose(crowdIdleRow)
  : crowdPose(crowdWalkRow) * aAnim.z + crowdPose(crowdIdleRow) * (1.0 - aAnim.z);
float crowdC = cos(aPos.z);
float crowdS = sin(aPos.z);
mat4 crowdPlace = mat4(crowdC * aPos.w * aSkin.w, 0.0, -crowdS * aPos.w * aSkin.w, 0.0,
                       0.0, aPos.w, 0.0, 0.0,
                       crowdS * aPos.w * aHair.w, 0.0, crowdC * aPos.w * aHair.w, 0.0,
                       aPos.x, 0.0, aPos.y, 1.0);
mat4 crowdWorld = crowdPlace * crowdSkin;
`;

/** Every other pixel of a practice profile is left out: see-through with no blending. */
const FRAGMENT_GHOST = /* glsl */`
if (vGhost > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;
`;

function crowdMaterial(uniforms: Record<string, THREE.IUniform>): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_pars_vertex>', VERTEX_PARS)
      .replace('#include <color_vertex>', VERTEX_SELECT)
      .replace('#include <skinbase_vertex>', VERTEX_SKIN)
      .replace('#include <skinnormal_vertex>', 'objectNormal = normalize(mat3(crowdWorld) * objectNormal);')
      .replace('#include <skinning_vertex>', 'transformed = (crowdWorld * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nvarying float vGhost;')
      .replace('#include <clipping_planes_fragment>', `${FRAGMENT_GHOST}\n#include <clipping_planes_fragment>`);
  };
  m.customProgramCacheKey = () => 'crowd-gpu-1';
  return m;
}

// ── the crowd ────────────────────────────────────────────────────────────────

/** What the crowd reads of a person. The sim's own agents are one, as they stand. */
export interface CrowdPerson {
  readonly ref: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly look: Look;
  readonly seed: number;
  readonly ghost: boolean;
  /** 'walking', 'approaching' and 'leaving' walk; every other state stands. */
  readonly state: string;
}

/** One frame's camera and clock. The caller keeps one and rewrites it each frame. */
export interface CrowdFrame {
  /** Where the camera stands, on the ground. */
  eyeX: number;
  eyeZ: number;
  /**
   * For a camera whose picture does not shrink with distance -- the map's -- how far
   * away everybody counts as being, worked out from how big a person is on screen. 0
   * for the walking camera, where it is each person's own distance.
   */
  flat: number;
  time: number;
  dt: number;
  /** How big the town draws a person (PERSON in canvas.tsx). */
  scale: number;
}

export interface GpuCrowd {
  readonly group: THREE.Group;
  /**
   * Draw this frame's people, NEAREST FIRST (the caller sorts, and has already culled
   * to what the camera can see). Returns how many got a body: people[0..returned).
   * Everybody past that was over the last level's cap, and is not there to be tapped.
   */
  update(people: readonly CrowdPerson[], count: number, frame: CrowdFrame): number;
  /** People per level this frame, for the meter and the tests. */
  readonly stats: { near: number; middle: number; far: number; dropped: number };
  /** Each level's instance buffer, for the tests: what is uploaded, and how much. */
  readonly buffers: readonly THREE.InstancedInterleavedBuffer[];
  dispose(): void;
}

interface Level {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  buffer: THREE.InstancedInterleavedBuffer;
  max: number;
  until: number;
  n: number;
}

/**
 * Everything the crowd needs that does not belong to one GL context: the baked
 * animation and the three levels' geometry. Built once per app run -- the town's
 * canvas is rebuilt whenever the app comes back from the background, and building
 * this again each time would be the same pause each time.
 */
export interface PreparedCrowd {
  bake: Bake;
  levels: THREE.BufferGeometry[];
  pieces: (key: LookKey) => LookPieces | undefined;
  beards: readonly string[];
}

export function prepareCrowd(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, manifest: Manifest): PreparedCrowd {
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (!meshes.length) throw new Error('people.glb has no skinned meshes');
  const first = meshes[0]!;
  if (!first.bindMatrix.equals(new THREE.Matrix4())) throw new Error('the crowd expects an identity bind matrix');
  const boneNames = first.skeleton.bones.map((b) => b.name);
  const boneInverses = first.skeleton.boneInverses.map((m) => m.clone());
  const geometry = new Map<string, THREE.BufferGeometry>();
  const colour = new Map<string, THREE.Color>();
  for (const m of meshes) {
    geometry.set(m.name, m.geometry);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    colour.set(m.name, mat.color.clone());
    m.removeFromParent();
  }
  const head = boneNames.indexOf('Head');
  if (head < 0) throw new Error('the rig has no Head bone to hang anything off');
  const headBind = boneInverses[head]!.clone().invert();
  const pieces = (key: LookKey): LookPieces | undefined => manifest.looks[key];
  const beards = manifest.beards ?? [];

  const bake = bakeClips(gltf.scene, boneNames, boneInverses, new Map(gltf.animations.map((c) => [c.name, c])));
  const levels = buildLevels({ geometry, colour, pieces, beards, head, headBind });
  return { bake, levels, pieces, beards };
}

/** One GL context's crowd, from the prepared parts. Disposing it leaves them reusable. */
export function crowdFrom(prepared: PreparedCrowd): GpuCrowd {
  const { bake, pieces, beards } = prepared;
  const bakeTex = new THREE.DataTexture(bake.data, bake.width, bake.rows, THREE.RGBAFormat, THREE.FloatType);
  bakeTex.magFilter = THREE.NearestFilter;
  bakeTex.minFilter = THREE.NearestFilter;
  bakeTex.generateMipmaps = false;
  bakeTex.needsUpdate = true;
  const uniforms: Record<string, THREE.IUniform> = {
    uBake: { value: bakeTex },
    uClips: { value: new THREE.Vector4(bake.walk.row, bake.walk.frames, bake.idle.row, bake.idle.frames) },
    uFps: { value: BAKE_FPS },
    uTime: { value: 0 },
  };
  const material = crowdMaterial(uniforms);

  const group = new THREE.Group();
  group.name = 'crowd-gpu';
  const levels: Level[] = prepared.levels.map((g, i) => {
    const spec = LEVELS[i]!;
    const ig = new THREE.InstancedBufferGeometry();
    ig.setIndex(g.index);
    for (const [name, a] of Object.entries(g.attributes)) ig.setAttribute(name, a);
    const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(spec.max * STRIDE), STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    ['aPos', 'aAnim', 'aSkin', 'aHair', 'aTop', 'aExtra', 'aSel', 'aSel2'].forEach((name, k) =>
      ig.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
    ig.instanceCount = 0;
    const mesh = new THREE.Mesh(ig, material);
    mesh.name = `crowd-${spec.name}`;
    // Everybody is placed by the shader, not by the mesh, so the mesh's own box says
    // nothing; the caller has already culled to what the camera can see.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    mesh.visible = false;
    group.add(mesh);
    return { mesh, geometry: ig, buffer, max: spec.max, until: spec.until, n: 0 };
  });

  const walkDur = bake.walk.frames / BAKE_FPS;
  const idleDur = bake.idle.frames / BAKE_FPS;
  const fixed = new Map<number, Float32Array>();
  const weights = new Map<string, number>();
  const stats = { near: 0, middle: 0, far: 0, dropped: 0 };
  const BLEND = 0.22;

  return {
    group,
    stats,
    buffers: levels.map((l) => l.buffer),
    update(people, count, frame) {
      for (const l of levels) l.n = 0;
      stats.dropped = 0;
      const step = Math.min(1, frame.dt / BLEND);
      const s = frame.scale * MODEL_SCALE;
      let level = 0;
      let drawn = 0;
      for (let i = 0; i < count; i++) {
        const a = people[i]!;
        const d = frame.flat > 0 ? frame.flat : Math.hypot(a.x - frame.eyeX, a.z - frame.eyeZ);
        while (level < levels.length - 1 && (d > levels[level]!.until || levels[level]!.n >= levels[level]!.max)) level++;
        const l = levels[level]!;
        // Nearest first, so once the last level is full everybody after is further
        // still: the drawn are always people[0..drawn).
        if (l.n >= l.max) { stats.dropped = count - i; break; }
        const key = lookKey(a.look);
        let f = fixed.get(key);
        if (!f) { f = fixedOf(a.look, pieces, beards); fixed.set(key, f); }
        const target = a.state === 'walking' || a.state === 'approaching' || a.state === 'leaving' ? 1 : 0;
        const was = weights.get(a.ref) ?? target;
        const w = was + (target - was) * step;
        weights.set(a.ref, w);
        const offset = (a.seed % 100) / 100;
        const arr = l.buffer.array as Float32Array;
        const at = l.n * STRIDE;
        arr[at] = a.x; arr[at + 1] = a.z; arr[at + 2] = a.facing; arr[at + 3] = s;
        arr[at + 4] = offset * walkDur; arr[at + 5] = offset * idleDur; arr[at + 6] = w; arr[at + 7] = a.ghost ? 1 : 0;
        arr.set(f, at + 8);
        l.n++;
        drawn++;
      }
      for (const l of levels) {
        l.geometry.instanceCount = l.n;
        l.mesh.visible = l.n > 0;
        if (l.n === 0) continue;
        // ONLY THE PEOPLE WRITTEN GO TO THE GPU. The far level has room for 512 and
        // the mist leaves a few dozen in it; without a range, three sends the whole
        // 64 KB every frame. Expo's GL needs gl-subdata.ts to honour a range at all.
        l.buffer.clearUpdateRanges();
        l.buffer.addUpdateRange(0, l.n * STRIDE);
        l.buffer.needsUpdate = true;
      }
      stats.near = levels[0]!.n; stats.middle = levels[1]!.n; stats.far = levels[2]!.n;
      uniforms.uTime!.value = frame.time % 3600;
      // A person not seen for a while does not keep a weight for ever.
      if (weights.size > 4096) weights.clear();
      return drawn;
    },
    dispose() {
      // Frees this context's copies on the GPU. The prepared geometry stays, and the
      // next canvas uploads it again.
      for (const l of levels) l.geometry.dispose();
      material.dispose();
      bakeTex.dispose();
      group.clear();
    },
  };
}

/** The whole thing from a loaded model, for the tests. */
export function makeGpuCrowd(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, manifest: Manifest): GpuCrowd {
  return crowdFrom(prepareCrowd(gltf, manifest));
}

let prepared: Promise<PreparedCrowd> | null = null;

/** Read the model and manifest off disk -- once per app run -- and build the crowd. */
export async function loadGpuCrowd(): Promise<GpuCrowd> {
  prepared ??= (async () => {
    const bytes = await readModel();
    const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
      new GLTFLoader().parse(bytes, '', res as never, rej));
    const t0 = Date.now();
    const made = prepareCrowd(gltf, require('../../../assets/characters/people.json') as Manifest);
    if ((globalThis as { __DEV__?: boolean }).__DEV__) console.log(`[crowd] built in ${Date.now() - t0} ms`);
    return made;
  })();
  try {
    return crowdFrom(await prepared);
  } catch (e) {
    // A failed read is not remembered: the next canvas tries again.
    prepared = null;
    throw e;
  }
}
