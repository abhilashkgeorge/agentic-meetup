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
 *   3. FOUR LEVELS OF DETAIL, four draw calls in all. Near: the full model. Middle:
 *      the same parts with nearby vertices merged (about a third of the triangles).
 *      Far: one merged outfit per head, merged harder -- at forty pixels tall a person
 *      is a silhouette, their colours, and their hair. Tiny: the same, merged hardest,
 *      for people a few pixels tall. Past the park's mist, nothing.
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
import { HARD_HAT, lookKey, type Look } from '@clone/shared';
import { BIKE, RIDE_FRAMES, WRIST_ON_GRIP, ankleOn } from './bike';
import {
  EXTRA_OWN_COLOUR, FITTED_HAIR, HAT_INSIDE, HEAD_BIND, LOOKS, SCALP, SKULL_MIDDLE, buildScale, coloursOf, hardHatSet, partsOf, roleOf,
  type ExtraKind, type LookKey, type LookPieces, type Role,
} from './character';
import {
  MODEL_SCALE, buildBag, buildExtras, clothOf, readModel, type BagKind, type Bone, type Manifest, type SharedExtra,
} from './character-mesh';

/** Where each role takes its colour from (aMeta.x): see VERTEX_SELECT. */
export const ROLE: Record<Role | 'neck' | 'bag', number> = {
  skin: 0, hair: 1, top: 2, plain: 3, legs: 4, feet: 5, eyes: 6, brows: 7, hat: 8, neck: 9, bag: 10,
};
/** Which choice a vertex belongs to (aMeta.y); the shader reads each one's wanted variant. */
export const SLOT_ID = {
  face: 0, hair: 1, top: 2, legs: 3, feet: 4, beard: 5, hat: 6, glasses: 7, earrings: 8, neck: 9, bag: 10, outfit: 11,
} as const;
/** No variant is ever this: a slot wanting it draws nothing (no hair, no hat). */
export const NONE = 99;
/**
 * The hair slot's other variants: a hairstyle grown to fit a bigger skull is FITTED
 * plus its place in FITTED_HAIR, and a shaved head on a face that ends at the
 * hairline is SCALP_VARIANT (the pack's own scalp, in skin).
 */
export const FITTED = 20;
export const SCALP_VARIANT = 30;
/**
 * Each extra's slot and variant, in LOOK_LABELS order; the hard hat is a mesh, 4 and
 * 6. A bag's variant also depends on the top it is made for (bagVariant).
 */
const EXTRA_SLOT: Record<ExtraKind, { slot: number; variant: number; role: number }> = {
  cap: { slot: SLOT_ID.hat, variant: 1, role: ROLE.hat },
  beanie: { slot: SLOT_ID.hat, variant: 2, role: ROLE.hat },
  bucket: { slot: SLOT_ID.hat, variant: 3, role: ROLE.hat },
  beret: { slot: SLOT_ID.hat, variant: 5, role: ROLE.hat },
  round: { slot: SLOT_ID.glasses, variant: 1, role: ROLE.plain },
  sunglasses: { slot: SLOT_ID.glasses, variant: 2, role: ROLE.plain },
  square: { slot: SLOT_ID.glasses, variant: 3, role: ROLE.plain },
  studs: { slot: SLOT_ID.earrings, variant: 1, role: ROLE.plain },
  hoops: { slot: SLOT_ID.earrings, variant: 2, role: ROLE.plain },
  scarf: { slot: SLOT_ID.neck, variant: 1, role: ROLE.neck },
  necklace: { slot: SLOT_ID.neck, variant: 2, role: ROLE.plain },
  bowtie: { slot: SLOT_ID.neck, variant: 3, role: ROLE.neck },
  backpack: { slot: SLOT_ID.bag, variant: 1, role: ROLE.bag },
  shoulderbag: { slot: SLOT_ID.bag, variant: 2, role: ROLE.plain },
};
/** The women's hard hat is its own mesh; the men's is HARD_HAT itself. */
const HARD_HAT_W = 6;
/** A bag is built for each top (character-mesh.ts buildBag): its variant says which. */
export const bagVariant = (kind: BagKind, topSet: number): number => (kind === 'backpack' ? 1 : 1 + LOOKS.length) + topSet;

/** Numbers per person in a level's buffer: eight vec4s, in this order (see fixedOf). */
export const INSTANCE_ATTRIBUTES = ['aPos', 'aAnim', 'aShape', 'aCol1', 'aCol2', 'aSel1', 'aSel2', 'aSel3'] as const;
export const STRIDE = INSTANCE_ATTRIBUTES.length * 4;
/** The baked animation's frame rate. Nearest frame, so no blending between frames. */
export const BAKE_FPS = 60;

/**
 * The levels: how far each reaches from the camera, how many people each may hold,
 * and how hard its vertices are merged (0: not at all). Distances in town units (a
 * person is 0.23 tall); the park's mist ends at VIEW in camera.ts. On the map every
 * person counts as mapDistance() away.
 *
 * The last two hold everybody one world can show, crowd test included (CROWD_TEST +
 * SLOTS): zoomed out over the whole city, every one of them is on screen at once.
 *
 * TINY is for people a few pixels tall. Past 40 units a person is under 4.5 points
 * high; the far level still spent 321 vertices each on them, and with the city's
 * test crowd zoomed out -- 1,042 people, each a speck -- that was the graphics chip's
 * whole frame (the Seeker, 2026-09-29: 14.5 ms, the JavaScript thread idle for 4.6
 * of it). Merged at 0.3 an outfit is 55 vertices.
 */
export const LEVELS = [
  { name: 'near', until: 4.5, max: 12, merge: 0 },
  { name: 'middle', until: 14, max: 96, merge: 0.05 },
  { name: 'far', until: 40, max: 2048, merge: 0.1 },
  { name: 'tiny', until: Infinity, max: 2048, merge: 0.3 },
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
  /** One still frame: sitting on a bench (sitPose). */
  sit: { row: number; frames: number };
  /** One turn of the cranks on a bicycle (ridePose); the first frame is the still one. */
  ride: { row: number; frames: number };
}

/**
 * Sitting, made from the idle pose: the pack has no sitting clip, only walking, idling
 * and fighting. The body drops by what it takes to bring the ankles down to the ground
 * with the thighs level and the shins upright, the thighs point forward, the shins
 * down, and the feet -- which in this rig hang off the root, not the shins -- are moved
 * to where the ankles now are. Pointed by aim, from where each bone's child is to where
 * it should be, so it does not matter which way each bone's own axes run.
 */
export function sitPose(root: THREE.Object3D, bone: (name: string) => THREE.Bone): void {
  root.updateMatrixWorld(true);
  const at = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
  /** Turn `b` about its own joint so that `from` (world) comes to lie along `to`. */
  const aim = (b: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
    const pivot = at(b);
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().sub(pivot).normalize(), to.clone().sub(pivot).normalize());
    const parentQ = b.parent!.getWorldQuaternion(new THREE.Quaternion());
    const worldQ = b.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
    b.updateMatrixWorld(true);
  };
  const body = bone('Body');
  const legs = (['L', 'R'] as const).map((s) => ({ upper: bone(`UpperLeg${s}`), lower: bone(`LowerLeg${s}`), foot: bone(`Foot${s}`) }));
  // THE SHIN'S OWN END, in the shin's frame, taken standing. The foot is no help once
  // the thigh has turned: it hangs off the root, so it stays where the standing foot
  // was while the shin swings forward with the thigh. Aiming the shin by the foot --
  // which is what this did first -- turned it from pointing at that stale spot to
  // pointing down, and left it sticking forward, out past the knees; the ankle's skin,
  // weighted to the foot, stretched back down to the ground (the render of a couple on
  // a bench, 2026-09-29, scripts/render-bench.mts).
  const shinEnd = legs.map(({ lower, foot }) => lower.worldToLocal(at(foot)));
  const L = legs[0]!;
  const thigh = at(L.upper).distanceTo(at(L.lower));
  const shin = at(L.lower).distanceTo(at(L.foot));
  const ground = at(L.foot).y;
  // Down, so a level thigh and an upright shin put the ankle on the ground.
  const drop = at(L.upper).y - (ground + shin);
  const bodyAt = at(body).sub(new THREE.Vector3(0, drop, 0));
  body.position.copy(body.parent!.worldToLocal(bodyAt));
  root.updateMatrixWorld(true);
  legs.forEach(({ upper, lower, foot }, i) => {
    const hip = at(upper);
    const knee = hip.clone().add(new THREE.Vector3((hip.x > 0 ? 1 : -1) * 0.015, -0.03, thigh));
    aim(upper, at(lower), knee);
    const ankle = at(lower).clone().setY(ground);
    aim(lower, lower.localToWorld(shinEnd[i]!.clone()), ankle);
    foot.position.copy(foot.parent!.worldToLocal(ankle.clone()));
    foot.updateMatrixWorld(true);
  });
  root.updateMatrixWorld(true);
}

/** Turn `b` about its own joint so that the world point `from` comes to lie towards `to`. */
function aimBone(b: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  const pivot = b.getWorldPosition(new THREE.Vector3());
  const q = new THREE.Quaternion().setFromUnitVectors(from.clone().sub(pivot).normalize(), to.clone().sub(pivot).normalize());
  const parentQ = b.parent!.getWorldQuaternion(new THREE.Quaternion());
  const worldQ = b.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
  b.updateMatrixWorld(true);
}

/** Turn `b` in the world by `q` about its own joint. */
function turnBone(b: THREE.Bone, q: THREE.Quaternion): void {
  const parentQ = b.parent!.getWorldQuaternion(new THREE.Quaternion());
  const worldQ = b.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(parentQ.invert().multiply(q.clone().multiply(worldQ)));
  b.updateMatrixWorld(true);
}

/**
 * A limb of two bones reaching for a point: the end -- a point fixed in the lower bone,
 * `end` in its own frame -- is brought to `target`, the joint between bending towards
 * `pole`. The bones keep their lengths; a target out of reach is reached for.
 */
function reach(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): void {
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = lower.localToWorld(end.clone());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const toT = target.clone().sub(a);
  const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, toT.length()));
  const dir = toT.normalize();
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const side = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const joint = a.clone().add(dir.clone().multiplyScalar(l1 * cos)).add(side.multiplyScalar(l1 * sin));
  aimBone(upper, b, joint);
  aimBone(lower, lower.localToWorld(end.clone()), target);
}

/** How far the hip joints ride above the saddle: the seat of the trousers is under them. */
const SADDLE_TO_HIP = 0.115;
/** How far forward a rider leans, from the waist, and how much of it the neck takes back. */
const LEAN = 0.42;
const LOOK_UP = 0.65;

/**
 * Riding a bicycle, `phase` of a turn of the cranks round (0 to 1): the pack has no such
 * clip, so, like sitPose, it is made from the idle's first frame -- and from the same
 * points the bicycle is drawn from (bike.ts BIKE), so the rider is on it:
 *   - the hips squared to the front (the idle frame has them turned 27 degrees, which
 *     standing reads as a relaxed stance and on a bike as falling off), the upper body
 *     left as it was;
 *   - the body lifted and moved back until the hip joints ride SADDLE_TO_HIP over the
 *     saddle;
 *   - a lean forward from the waist, the neck taking most of it back so the rider
 *     looks down the road;
 *   - each hand on its grip, the elbows bent back and out;
 *   - each ankle over its pedal as the cranks go round, the knees forward -- and the
 *     feet, which in this rig hang off the root, put where the ankles are.
 */
export function ridePose(root: THREE.Object3D, bone: (name: string) => THREE.Bone, phase: number): void {
  root.updateMatrixWorld(true);
  const at = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
  const body = bone('Body'), hips = bone('Hips'), abdomen = bone('Abdomen'), neck = bone('Neck');
  const sides = ['L', 'R'] as const;
  const legs = sides.map((s) => ({ s, upper: bone(`UpperLeg${s}`), lower: bone(`LowerLeg${s}`), foot: bone(`Foot${s}`) }));
  const arms = sides.map((s) => ({ s, upper: bone(`UpperArm${s}`), lower: bone(`LowerArm${s}`), wrist: bone(`Wrist${s}`) }));
  // Each limb's end in its own lower bone's frame, standing: the shin's ankle (the foot
  // hangs off the root, so it is no guide once the leg moves) and the forearm's wrist.
  const shinEnd = legs.map(({ lower, foot }) => lower.worldToLocal(at(foot)));
  const armEnd = arms.map(({ lower, wrist }) => lower.worldToLocal(at(wrist)));

  // Square the hips, keep the rest of the body where it faced.
  const across = at(legs[0]!.upper).sub(at(legs[1]!.upper));
  const hipsWorld = hips.getWorldQuaternion(new THREE.Quaternion());
  turnBone(body, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(across.z, across.x)));
  hips.quaternion.copy(body.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(hipsWorld));
  root.updateMatrixWorld(true);

  // Onto the saddle.
  const mid = at(legs[0]!.upper).add(at(legs[1]!.upper)).multiplyScalar(0.5);
  const want = new THREE.Vector3(BIKE.saddle[0], BIKE.saddle[1] + SADDLE_TO_HIP, BIKE.saddle[2] + 0.02);
  const bodyAt = at(body).add(want.sub(mid));
  body.position.copy(body.parent!.worldToLocal(bodyAt));
  root.updateMatrixWorld(true);

  // Lean from the waist; look up the road.
  turnBone(abdomen, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), LEAN));
  turnBone(neck, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -LEAN * LOOK_UP));
  root.updateMatrixWorld(true);

  // Hands on the bars, elbows back and out.
  arms.forEach(({ s, upper, lower }, i) => {
    const x = s === 'L' ? 1 : -1;
    const wrist = new THREE.Vector3(BIKE.grip[0] * x + WRIST_ON_GRIP[0], BIKE.grip[1] + WRIST_ON_GRIP[1], BIKE.grip[2] + WRIST_ON_GRIP[2]);
    reach(upper, lower, armEnd[i]!, wrist, new THREE.Vector3(0.6 * x, -0.3, -1));
  });

  // Feet on the pedals, knees forward, and the feet themselves moved to the ankles.
  legs.forEach(({ s, upper, lower, foot }, i) => {
    const ankle = new THREE.Vector3(...ankleOn(s, phase));
    reach(upper, lower, shinEnd[i]!, ankle, new THREE.Vector3(s === 'L' ? 0.15 : -0.15, 0.25, 1));
    foot.position.copy(foot.parent!.worldToLocal(lower.localToWorld(shinEnd[i]!.clone())));
    foot.updateMatrixWorld(true);
  });
  root.updateMatrixWorld(true);
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
  const data = new Float32Array(width * (w + i + 1 + RIDE_FRAMES) * 4);
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
  // Sitting: the idle's first frame, sat down. A stopped action leaves its last pose on
  // the bones, which is what sitPose starts from.
  const still = mixer.clipAction(idle);
  still.reset().play();
  mixer.setTime(0);
  mixer.stopAllAction();
  const need = (n: string) => {
    const b = found.get(n);
    if (!b) throw new Error(`sitting and riding need bone "${n}"`);
    return b;
  };
  // The idle's first frame, kept: each posed row starts again from it.
  const base = [...found.values()].map((b) => ({ b, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
  const restore = () => { for (const { b, p, q, s } of base) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(s); } root.updateMatrixWorld(true); };
  const write = () => {
    for (let b = 0; b < bones.length; b++) {
      m.multiplyMatrices(bones[b]!.matrixWorld, boneInverses[b]!);
      data.set(m.elements, (row * width + b * 4) * 4);
    }
    row++;
  };
  sitPose(root, need);
  write();
  // Riding: a turn of the cranks, a frame at a time.
  for (let f = 0; f < RIDE_FRAMES; f++) {
    restore();
    ridePose(root, need, f / RIDE_FRAMES);
    write();
  }
  restore();
  return {
    data, width, rows: w + i + 1 + RIDE_FRAMES,
    walk: { row: 0, frames: w }, idle: { row: w, frames: i }, sit: { row: w + i, frames: 1 },
    ride: { row: w + i + 1, frames: RIDE_FRAMES },
  };
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
 * An attribute with an array of its own, one item after another.
 *
 * THE MODEL'S NORMALS ARE INTERLEAVED: three bytes each, padded to four, because glTF
 * aligns every vertex to four bytes. Read as if they were packed -- which is what
 * mergeNear and a plain copy both do -- every vertex takes its normal from the wrong
 * bytes: 4,012 of the middle level's 10,366 normals pointed nowhere, and the middle
 * and far bodies were lit wrong (found while timing the build on the Seeker,
 * 2026-09-29). three's own clone() unpacks them, one push at a time and a console
 * line per piece; this does it in one loop.
 */
function own(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.count;
  const k = a.itemSize;
  const out = new (a.array.constructor as new (n: number) => THREE.TypedArray)(n * k);
  if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const i = a as THREE.InterleavedBufferAttribute;
    const src = i.data.array;
    const stride = i.data.stride;
    for (let v = 0; v < n; v++) for (let c = 0; c < k; c++) out[v * k + c] = src[v * stride + i.offset + c]!;
  } else {
    out.set((a as THREE.BufferAttribute).array.subarray(0, n * k));
  }
  return new THREE.BufferAttribute(out, k, a.normalized);
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
    base.setAttribute(name, own(a));
  }
  if (src.index) base.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
  const g = merge > 0 ? mergeNear(base, merge) : base;
  const n = g.attributes.position!.count;
  const rgb = new Float32Array(n * 3);
  const tag = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = colour.r; rgb[i * 3 + 1] = colour.g; rgb[i * 3 + 2] = colour.b;
    tag[i * 4] = meta.role; tag[i * 4 + 1] = meta.slot; tag[i * 4 + 2] = meta.variant;
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  g.setAttribute('aMeta', new THREE.BufferAttribute(tag, 4));
  // Every attribute is read as float by the shader, whatever flag the loader gave it,
  // so every piece says so alike.
  for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).gpuType = THREE.FloatType;
  return g;
}

/**
 * A piece grown by `fit` about the middle of the skull, in bind space (the model's
 * bind matrix is the identity, which prepareSteps checks): a hairstyle on a bigger
 * skull than it was modelled on. Normals are unchanged by a uniform scale.
 */
function grown(src: THREE.BufferGeometry, fit: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight'] as const) {
    const a = src.attributes[name];
    if (a) g.setAttribute(name, own(a));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
  const p = g.attributes.position!.array;
  if (!(p instanceof Float32Array)) throw new Error("a hairstyle to grow has positions that are not floats");
  const [cx, cy, cz] = SKULL_MIDDLE;
  for (let i = 0; i < p.length; i += 3) {
    p[i] = cx + (p[i]! - cx) * fit;
    p[i + 1] = cy + (p[i + 1]! - cy) * fit;
    p[i + 2] = cz + (p[i + 2]! - cz) * fit;
  }
  return g;
}

/**
 * An accessory as a skinned piece: hung rigidly on one bone, so it is carried into
 * the model's bind space from that bone's (the space `HEAD`, `NECK` and `CHEST` in
 * character-mesh.ts measure in) and weighted wholly to it.
 */
function extraPiece(geo: THREE.BufferGeometry, bone: number, bind: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(bind);
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const n = g.attributes.position!.count;
  const normals = g.attributes.normal!;
  const packed = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) packed[i] = Math.round(Math.max(-1, Math.min(1, normals.array[i]!)) * 127);
  g.setAttribute('normal', new THREE.BufferAttribute(packed, 3, true));
  const idx = new Uint8Array(n * 4);
  const wgt = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = bone; wgt[i * 4] = 255; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4, true));
  if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

/**
 * Many pieces into one geometry, as three's mergeGeometries does, but straight into
 * typed arrays.
 *
 * WHY NOT THREE'S. It builds the merged index as a plain array, one push and one
 * getX() call per corner, then converts it -- 190,000 corners for the near level.
 * On the Seeker (debug build, 2026-09-29) that single merge was 417 ms of the
 * crowd's 1,060 ms build, a visible freeze, where everything else was under 60 ms.
 * The pieces here always share one attribute layout, so this copies each attribute
 * with one `set` per piece and offsets the index in one typed loop.
 */
export function mergePieces(pieces: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const first = pieces[0];
  if (!first) throw new Error('nothing to merge');
  const names = Object.keys(first.attributes);
  let verts = 0;
  let corners = 0;
  for (const p of pieces) {
    if (!p.index) throw new Error('the crowd pieces did not merge: one has no index');
    if (Object.keys(p.attributes).length !== names.length) throw new Error('the crowd pieces did not merge: their attributes differ');
    for (const n of names) {
      const a = p.attributes[n] as THREE.BufferAttribute | undefined;
      const f = first.attributes[n] as THREE.BufferAttribute;
      if (!a || a.array.constructor !== f.array.constructor || a.itemSize !== f.itemSize || a.normalized !== f.normalized) {
        throw new Error(`the crowd pieces did not merge: their "${n}" differs`);
      }
    }
    verts += p.attributes.position!.count;
    corners += p.index.count;
  }
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const f = first.attributes[n] as THREE.BufferAttribute;
    const arr = new (f.array.constructor as new (n: number) => THREE.TypedArray)(verts * f.itemSize);
    let at = 0;
    for (const p of pieces) {
      const a = p.attributes[n] as THREE.BufferAttribute;
      arr.set(a.array, at);
      at += a.count * a.itemSize;
    }
    const merged = new THREE.BufferAttribute(arr, f.itemSize, f.normalized);
    merged.gpuType = f.gpuType;
    out.setAttribute(n, merged);
  }
  const index = verts > 65535 ? new Uint32Array(corners) : new Uint16Array(corners);
  let at = 0;
  let base = 0;
  for (const p of pieces) {
    const src = p.index!.array;
    for (let i = 0; i < src.length; i++) index[at + i] = src[i]! + base;
    at += src.length;
    base += p.attributes.position!.count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

export interface CrowdParts {
  /** Mesh name -> geometry, and the artist's colour, straight from people.glb. */
  geometry: ReadonlyMap<string, THREE.BufferGeometry>;
  colour: ReadonlyMap<string, THREE.Color>;
  pieces: (key: LookKey) => LookPieces | undefined;
  beards: readonly string[];
  /** The bones accessories hang off: their index, and the matrix out of their bind space. */
  bones: Readonly<Record<Bone, { index: number; bind: THREE.Matrix4 }>>;
}

/**
 * The four meshes' geometry. Near, middle and far: every choice there is -- each set's
 * face, hair, top, trousers and shoes, the beards, the hard hats and everything worn on
 * top -- merged harder at each level (far leaves the small things off). Tiny: one
 * merged outfit per set, for people a few pixels tall.
 *
 * A LOOK AT A TIME. This is a generator that stops after each set, so the app can
 * build it between frames (loadGpuCrowd) and the tests all at once (buildLevels). In
 * node the whole build is about fifty milliseconds; a phone's JavaScript engine has no
 * compiler to speed it up, and done in one go it would freeze the town for a good
 * part of a second.
 */
export function* levelSteps(parts: CrowdParts): Generator<void, THREE.BufferGeometry[], void> {
  const white = new THREE.Color(1, 1, 1);
  // The artist's colour stays in the vertices wherever it can show: plain pieces, the
  // hard hat, and the fabric of trousers and shoes, which is theirs until somebody
  // picks a colour for it ("As made"). Everything the shader always paints carries
  // white. (Trousers and shoes carried white too, for a day: "As made" came out white.)
  const kept: ReadonlySet<Role> = new Set(['plain', 'hat', 'legs', 'feet']);
  const colourOf = (mesh: string, role: Role) => (kept.has(role) ? parts.colour.get(mesh) ?? white : white);
  const extras = buildExtras();
  // The bags, one of each for every top, laid over that top (buildBag), and hung off
  // the chest like everything worn on the body.
  const chest = parts.bones.Chest;
  const toChest = chest.bind.clone().invert();
  const bags: { geometry: THREE.BufferGeometry; meta: { role: number; slot: number; variant: number }; colour: THREE.Color }[] = [];
  for (let set = 0; set < LOOKS.length; set++) {
    const body = clothOf((parts.pieces(LOOKS[set]!)?.top ?? []).flatMap((p) => {
      const geometry = parts.geometry.get(p.mesh);
      return geometry ? [{ geometry, matrix: toChest }] : [];
    }));
    for (const kind of ['backpack', 'shoulderbag'] as const) {
      const g = buildBag(kind, body);
      if (!g) continue;
      const at = EXTRA_SLOT[kind];
      bags.push({
        geometry: extraPiece(g, chest.index, chest.bind),
        meta: { role: at.role, slot: SLOT_ID.bag, variant: bagVariant(kind, set) },
        colour: new THREE.Color(at.role === ROLE.plain ? EXTRA_OWN_COLOUR[kind] : '#ffffff'),
      });
      g.dispose();
    }
    body.dispose();
    yield;
  }
  const piece = (mesh: string, role: Role, slot: number, variant: number, merge: number) => {
    const g = parts.geometry.get(mesh);
    return g ? tagged(g, { role: ROLE[role], slot, variant }, colourOf(mesh, role), merge) : null;
  };
  function* everything(merge: number, small: boolean): Generator<void, THREE.BufferGeometry[], void> {
    const out: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry | null) => { if (g) out.push(g); };
    for (let variant = 0; variant < LOOKS.length; variant++) {
      const key = LOOKS[variant]!;
      const set = parts.pieces(key);
      for (const p of set?.head ?? []) {
        const role = roleOf(p);
        if (role === 'hat') continue;
        add(piece(p.mesh, role, role === 'hair' ? SLOT_ID.hair : SLOT_ID.face, variant, merge));
      }
      for (const slot of ['top', 'legs', 'feet'] as const) {
        for (const p of set?.[slot] ?? []) add(piece(p.mesh, roleOf(p), SLOT_ID[slot], variant, merge));
      }
      yield;
    }
    // The hairstyles grown to fit a whole skull, and the scalp.
    FITTED_HAIR.forEach(({ hair, fit }, k) => {
      for (const p of parts.pieces(LOOKS[hair]!)?.head ?? []) {
        if (roleOf(p) !== 'hair') continue;
        const g = parts.geometry.get(p.mesh);
        if (g) out.push(tagged(grown(g, fit), { role: ROLE.hair, slot: SLOT_ID.hair, variant: FITTED + k }, white, merge));
      }
    });
    add(piece(SCALP, 'skin', SLOT_ID.hair, SCALP_VARIANT, merge));
    // The hard hats, one per figure's head.
    for (const [key, variant] of [['m_worker', HARD_HAT], ['w_worker', HARD_HAT_W]] as const) {
      for (const p of parts.pieces(key)?.head ?? []) if (roleOf(p) === 'hat') add(piece(p.mesh, 'hat', SLOT_ID.hat, variant, merge));
    }
    if (small) {
      parts.beards.forEach((mesh, i) => add(piece(mesh, 'hair', SLOT_ID.beard, i + 1, merge)));
      for (const kind of Object.keys(extras) as SharedExtra[]) {
        const { geometry, bone } = extras[kind];
        const b = parts.bones[bone];
        const at = EXTRA_SLOT[kind];
        const own = new THREE.Color(at.role === ROLE.plain ? EXTRA_OWN_COLOUR[kind] : '#ffffff');
        out.push(tagged(extraPiece(geometry, b.index, b.bind), at, own, 0));
      }
      for (const bag of bags) out.push(tagged(bag.geometry, bag.meta, bag.colour, 0));
    }
    yield;
    return out;
  }
  function* outfits(merge: number): Generator<void, THREE.BufferGeometry[], void> {
    const out: THREE.BufferGeometry[] = [];
    for (let variant = 0; variant < LOOKS.length; variant++) {
      const set = parts.pieces(LOOKS[variant]!);
      for (const slot of ['head', 'top', 'legs', 'feet'] as const) {
        for (const p of set?.[slot] ?? []) {
          const role = roleOf(p);
          if (role === 'hat') continue;
          const g = piece(p.mesh, role, SLOT_ID.outfit, variant, merge);
          if (g) out.push(g);
        }
      }
      yield;
    }
    return out;
  }
  const merged = (pieces: THREE.BufferGeometry[]) => {
    const g = mergePieces(pieces);
    for (const p of pieces) p.dispose();
    return g;
  };
  const near = merged(yield* everything(LEVELS[0].merge, true));
  yield;
  const middle = merged(yield* everything(LEVELS[1].merge, true));
  yield;
  const far = merged(yield* everything(LEVELS[2].merge, false));
  yield;
  const tiny = merged(yield* outfits(LEVELS[3].merge));
  for (const e of Object.values(extras)) e.geometry.dispose();
  for (const b of bags) b.geometry.dispose();
  return [near, middle, far, tiny];
}

/** Run a build's steps to the end, all at once. */
function finish<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

export function buildLevels(parts: CrowdParts): THREE.BufferGeometry[] {
  return finish(levelSteps(parts));
}

// ── one person, as numbers ───────────────────────────────────────────────────

/**
 * A colour as one number: 8-bit sRGB red, green and blue in the low 24 bits, which a
 * 32-bit float holds exactly. -1 is "as made": the vertex keeps the artist's colour.
 *
 * WHY PACKED. A phone promises sixteen vertex attributes and the crowd already reads
 * six per vertex; one vec4 per colour would have been nine more. Packed, a person's
 * nine colours are three numbers each in two vec4s, and the shader unpacks the one a
 * vertex needs.
 */
export const pack = (hex: string | null): number => (hex === null ? -1 : parseInt(hex.slice(1), 16));
export const unpack = (v: number): [number, number, number] => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];

/**
 * The 24 numbers of a person that do not move, in the order of STRIDE's last six
 * vec4s: shape (build x, build z, height, bag colour), two vec4s of colours (skin,
 * hair, top, trousers; shoes, eyes, hat, neck), and three of choices (face, hair,
 * top, trousers; shoes, beard, hat, glasses; earrings, neck, bag, outfit). Everything
 * here comes from `partsOf`, so the GPU dresses somebody exactly as the builder
 * shows them.
 */
export function fixedOf(look: Look, pieces: CrowdParts['pieces'], beards: readonly string[]): Float32Array {
  const who = partsOf(look, pieces, beards);
  const colour = coloursOf(look);
  const out = new Float32Array(24);
  const [bx, height, bz] = buildScale(look);
  const extra = (slot: number) => who.extras.find((e) => EXTRA_SLOT[e.kind].slot === slot) ?? null;
  // A worn thing's colour multiplies what its vertices carry: white for a shape the
  // person colours, the artist's yellow for the hard hat, which keeps it.
  const tintOf = (slot: number) => extra(slot)?.tint ?? '#ffffff';
  const chosen = (slot: number) => { const e = extra(slot); return e ? EXTRA_SLOT[e.kind].variant : 0; };
  const bag = extra(SLOT_ID.bag);
  const bagChosen = bag ? bagVariant(bag.kind as BagKind, LOOKS.indexOf(who.wearing.top)) : 0;
  const set = (k: LookKey | null) => (k === null ? NONE : LOOKS.indexOf(k));
  out.set([bx, bz, height, pack(tintOf(SLOT_ID.bag))], 0);
  out.set([pack(colour.skin), pack(colour.hair), pack(colour.top), pack(colour.legs)], 4);
  out.set([pack(colour.feet), pack(colour.eyes), pack(tintOf(SLOT_ID.hat)), pack(tintOf(SLOT_ID.neck))], 8);
  // The hair slot: their hairstyle, grown or not, the scalp, or nothing (partsOf).
  const hair = who.parts.find((p) => p.worn === 'hair');
  const fitted = hair?.fit ? FITTED_HAIR.findIndex((f) => f.hair === look.hair && f.fit === hair.fit) : -1;
  const hairVariant = !hair ? NONE : hair.role === 'skin' ? SCALP_VARIANT : fitted >= 0 ? FITTED + fitted : set(who.wearing.hair);
  out.set([set(who.wearing.head), hairVariant, set(who.wearing.top), set(who.wearing.legs)], 12);
  const hat = look.hat === HARD_HAT ? (hardHatSet(look.head) === 'w_worker' ? HARD_HAT_W : HARD_HAT) : chosen(SLOT_ID.hat);
  const beard = who.parts.some((p) => p.worn === 'beard') ? look.beard : 0;
  out.set([set(who.wearing.feet), beard, hat, chosen(SLOT_ID.glasses)], 16);
  // Tiny: the outfit of their top's set, the biggest patch of colour a speck has.
  out.set([chosen(SLOT_ID.earrings), chosen(SLOT_ID.neck), bagChosen, set(who.wearing.top)], 20);
  return out;
}

/**
 * The shader's choice, in JavaScript: does a vertex tagged `meta` (role, slot,
 * variant) belong to the person whose fixed numbers are `f`? Mirrors VERTEX_SELECT
 * line for line, so a test can dress somebody with no GPU in the room.
 */
export function wears(meta: readonly [number, number, number], f: Float32Array): boolean {
  const [, slot, variant] = meta;
  return Math.abs(variant - f[12 + slot]!) <= 0.5;
}

/**
 * The colour the shader paints a vertex of `role`, in JavaScript and sRGB: its
 * artist colour `own` unless the role takes one from the person.
 */
export function paintOf(role: number, own: [number, number, number], f: Float32Array): [number, number, number] {
  const col = (v: number) => (v < 0 ? own : unpack(v));
  const times = (a: [number, number, number], b: [number, number, number]) => a.map((c, k) => c * b[k]!) as [number, number, number];
  switch (role) {
    case ROLE.skin: return unpack(f[4]!);
    case ROLE.hair: return unpack(f[5]!);
    case ROLE.top: return unpack(f[6]!);
    case ROLE.legs: return col(f[7]!);
    case ROLE.feet: return col(f[8]!);
    case ROLE.eyes: return unpack(f[9]!);
    case ROLE.brows: return unpack(f[5]!).map((c) => c * 0.55) as [number, number, number];
    case ROLE.hat: return times(own, unpack(f[10]!));
    case ROLE.neck: return times(own, unpack(f[11]!));
    case ROLE.bag: return times(own, unpack(f[3]!));
    default: return own;
  }
}

// ── the shader ───────────────────────────────────────────────────────────────

const VERTEX_PARS = /* glsl */`
uniform highp sampler2D uBake;
uniform vec4 uClips;
uniform float uSit;
uniform vec2 uRide;
uniform float uFps;
uniform float uTime;
uniform vec4 uHat[8];
uniform vec3 uHeadMid;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aMeta;
attribute vec4 aPos;
attribute vec4 aAnim;
attribute vec4 aShape;
attribute vec4 aCol1;
attribute vec4 aCol2;
attribute vec4 aSel1;
attribute vec4 aSel2;
attribute vec4 aSel3;
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
vec3 crowdUnpack(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  vec3 c = vec3(r, g, b) / 255.0;
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

/** Pick this vertex's part or send it off screen; then its colour. Runs first in main. */
const VERTEX_SELECT = /* glsl */`
float crowdRole = aMeta.x;
float crowdSlot = aMeta.y;
float crowdWant = crowdSlot < 0.5 ? aSel1.x : crowdSlot < 1.5 ? aSel1.y : crowdSlot < 2.5 ? aSel1.z : crowdSlot < 3.5 ? aSel1.w
  : crowdSlot < 4.5 ? aSel2.x : crowdSlot < 5.5 ? aSel2.y : crowdSlot < 6.5 ? aSel2.z : crowdSlot < 7.5 ? aSel2.w
  : crowdSlot < 8.5 ? aSel3.x : crowdSlot < 9.5 ? aSel3.y : crowdSlot < 10.5 ? aSel3.z : aSel3.w;
if (abs(aMeta.z - crowdWant) > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vGhost = 0.0; return; }
vec3 crowdPaint = color;
if (crowdRole < 0.5) crowdPaint = crowdUnpack(aCol1.x);
else if (crowdRole < 1.5) crowdPaint = crowdUnpack(aCol1.y);
else if (crowdRole < 2.5) crowdPaint = crowdUnpack(aCol1.z);
else if (crowdRole < 3.5) crowdPaint = color;
else if (crowdRole < 4.5) crowdPaint = aCol1.w < 0.0 ? color : crowdUnpack(aCol1.w);
else if (crowdRole < 5.5) crowdPaint = aCol2.x < 0.0 ? color : crowdUnpack(aCol2.x);
else if (crowdRole < 6.5) crowdPaint = crowdUnpack(aCol2.y);
else if (crowdRole < 7.5) crowdPaint = crowdUnpack(aCol1.y) * 0.27;
else if (crowdRole < 8.5) crowdPaint = color * crowdUnpack(aCol2.z);
else if (crowdRole < 9.5) crowdPaint = color * crowdUnpack(aCol2.w);
else crowdPaint = color * crowdUnpack(aShape.w);
vColor = vec4(crowdPaint, 1.0);
// aAnim.w: 1 for see-through, plus 2 for sitting, plus 4 for riding a bicycle.
vGhost = mod(aAnim.w, 2.0);
`;

/** Where in their walk (or idle) they are, and where they stand: one matrix. */
const VERTEX_SKIN = /* glsl */`
int crowdWalkRow = int(uClips.x + mod(floor((uTime + aAnim.x) * uFps), uClips.y));
int crowdIdleRow = int(uClips.z + mod(floor((uTime + aAnim.y) * uFps), uClips.w));
// Riding: the cranks turn while they move and rest level while they stand.
bool crowdRiding = aAnim.w > 3.5;
bool crowdSitting = !crowdRiding && aAnim.w > 1.5;
int crowdRideRow = int(uRide.x + (aAnim.z > 0.5 ? mod(floor((uTime + aAnim.x) * uFps), uRide.y) : 0.0));
mat4 crowdSkin = crowdRiding ? crowdPose(crowdRideRow) : crowdSitting ? crowdPose(int(uSit))
  : aAnim.z > 0.995 ? crowdPose(crowdWalkRow) : aAnim.z < 0.005 ? crowdPose(crowdIdleRow)
  : crowdPose(crowdWalkRow) * aAnim.z + crowdPose(crowdIdleRow) * (1.0 - aAnim.z);
float crowdC = cos(aPos.z);
float crowdS = sin(aPos.z);
mat4 crowdPlace = mat4(crowdC * aPos.w * aShape.x, 0.0, -crowdS * aPos.w * aShape.x, 0.0,
                       0.0, aPos.w * aShape.z, 0.0, 0.0,
                       crowdS * aPos.w * aShape.y, 0.0, crowdC * aPos.w * aShape.y, 0.0,
                       aPos.x, 0.0, aPos.y, 1.0);
mat4 crowdWorld = crowdPlace * crowdSkin;
`;

/**
 * Hat hair (character.ts HAT_INSIDE, underHat): a hair vertex above the rim of the hat
 * they wear, outside the hat's inside, is pulled onto it. In bind space, before
 * skinning; uHat is indexed by the hat slot's variant, (rim, radii) each.
 */
const VERTEX_HAT = /* glsl */`
if (crowdSlot > 0.5 && crowdSlot < 1.5) {
  vec4 crowdHat = uHat[int(aSel2.z + 0.5)];
  vec3 crowdRim = uHeadMid + vec3(0.0, crowdHat.x, 0.0);
  vec3 crowdD = transformed - crowdRim;
  if (crowdD.y > 0.0) {
    float crowdQ = length(crowdD / crowdHat.yzw);
    if (crowdQ > 1.0) transformed = crowdRim + crowdD / crowdQ;
  }
}
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
      .replace('#include <skinning_vertex>', `${VERTEX_HAT}\ntransformed = (crowdWorld * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nvarying float vGhost;')
      .replace('#include <clipping_planes_fragment>', `${FRAGMENT_GHOST}\n#include <clipping_planes_fragment>`);
  };
  m.customProgramCacheKey = () => 'crowd-gpu-5';
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
  /** 'walking', 'approaching' and 'leaving' walk; 'sitting' sits; every other state stands. */
  readonly state: string;
  /** On a bicycle: pedalling while they move, still on it while they stand. */
  readonly riding?: boolean;
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
  readonly stats: { near: number; middle: number; far: number; tiny: number; dropped: number };
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
 * animation and the levels' geometry. Built once per app run -- the town's
 * canvas is rebuilt whenever the app comes back from the background, and building
 * this again each time would be the same pause each time.
 */
export interface PreparedCrowd {
  bake: Bake;
  levels: THREE.BufferGeometry[];
  pieces: (key: LookKey) => LookPieces | undefined;
  beards: readonly string[];
}

/** The crowd's parts, a step at a time (see levelSteps). */
export function* prepareSteps(
  gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
  manifest: Manifest,
): Generator<void, PreparedCrowd, void> {
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
  const bone = (name: Bone) => {
    const index = boneNames.indexOf(name);
    if (index < 0) throw new Error(`the rig has no ${name} bone to hang anything off`);
    return { index, bind: boneInverses[index]!.clone().invert() };
  };
  const bones = { Head: bone('Head'), Neck: bone('Neck'), Chest: bone('Chest') };
  const pieces = (key: LookKey): LookPieces | undefined => manifest.looks[key];
  const beards = manifest.beards ?? [];

  const bake = bakeClips(gltf.scene, boneNames, boneInverses, new Map(gltf.animations.map((c) => [c.name, c])));
  yield;
  const levels = yield* levelSteps({ geometry, colour, pieces, beards, bones });
  return { bake, levels, pieces, beards };
}

export function prepareCrowd(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, manifest: Manifest): PreparedCrowd {
  return finish(prepareSteps(gltf, manifest));
}

/**
 * HAT_INSIDE by the hat slot's variant, for the shader: (rim, radii). No hat is a rim
 * nothing reaches; the women's hard hat is the men's size.
 */
export function hatUniform(): THREE.Vector4[] {
  return Array.from({ length: 8 }, (_, v) => {
    const h = HAT_INSIDE[v === HARD_HAT_W ? HARD_HAT : v];
    return h ? new THREE.Vector4(h.rim, h.radii[0], h.radii[1], h.radii[2]) : new THREE.Vector4(99, 1, 1, 1);
  });
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
    uSit: { value: bake.sit.row },
    uRide: { value: new THREE.Vector2(bake.ride.row, bake.ride.frames) },
    uFps: { value: BAKE_FPS },
    uTime: { value: 0 },
    uHat: { value: hatUniform() },
    uHeadMid: { value: new THREE.Vector3(HEAD_BIND[0], HEAD_BIND[1], HEAD_BIND[2] + 0.014) },
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
    INSTANCE_ATTRIBUTES.forEach((name, k) =>
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
  const fixed = new Map<string, Float32Array>();
  /**
   * What a person's numbers were last frame: their look (as the object, so a changed
   * look is noticed), its fixed numbers, and how far into walking they are. One lookup
   * a person a frame -- working out the look's key and fetching it again, and a second
   * map for the walk, was half of 6 ms for the city's 1,042 (the Seeker, 2026-09-29).
   */
  const recs = new Map<string, { look: Look; fixed: Float32Array; w: number }>();
  const stats = { near: 0, middle: 0, far: 0, tiny: 0, dropped: 0 };
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
        const dx = a.x - frame.eyeX;
        const dz = a.z - frame.eyeZ;
        const d = frame.flat > 0 ? frame.flat : Math.sqrt(dx * dx + dz * dz);
        while (level < levels.length - 1 && (d > levels[level]!.until || levels[level]!.n >= levels[level]!.max)) level++;
        const l = levels[level]!;
        // Nearest first, so once the last level is full everybody after is further
        // still: the drawn are always people[0..drawn).
        if (l.n >= l.max) { stats.dropped = count - i; break; }
        const target = a.state === 'walking' || a.state === 'approaching' || a.state === 'leaving' ? 1 : 0;
        let r = recs.get(a.ref);
        if (!r || r.look !== a.look) {
          const key = lookKey(a.look);
          let f = fixed.get(key);
          if (!f) { f = fixedOf(a.look, pieces, beards); fixed.set(key, f); }
          if (r) { r.look = a.look; r.fixed = f; } else { r = { look: a.look, fixed: f, w: target }; recs.set(a.ref, r); }
        }
        r.w += (target - r.w) * step;
        const w = r.w;
        const f = r.fixed;
        const offset = (a.seed % 100) / 100;
        const arr = l.buffer.array as Float32Array;
        const at = l.n * STRIDE;
        arr[at] = a.x; arr[at + 1] = a.z; arr[at + 2] = a.facing; arr[at + 3] = s;
        arr[at + 4] = offset * walkDur; arr[at + 5] = offset * idleDur; arr[at + 6] = w;
        arr[at + 7] = (a.ghost ? 1 : 0) + (a.riding ? 4 : a.state === 'sitting' ? 2 : 0);
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
      stats.near = levels[0]!.n; stats.middle = levels[1]!.n; stats.far = levels[2]!.n; stats.tiny = levels[3]!.n;
      uniforms.uTime!.value = frame.time % 3600;
      // Nobody not seen for a while is remembered for ever.
      if (recs.size > 4096) recs.clear();
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
    const steps = prepareSteps(gltf, require('../../../assets/characters/people.json') as Manifest);
    const t0 = Date.now();
    let longest = 0;
    let at = 0;
    const slow: string[] = [];
    for (;;) {
      const s0 = Date.now();
      const r = steps.next();
      const took = Date.now() - s0;
      if (took > 30) slow.push(`#${at}:${took}`);
      at++;
      longest = Math.max(longest, took);
      if (r.done) {
        if ((globalThis as { __DEV__?: boolean }).__DEV__) {
          console.log(`[crowd] built in ${Date.now() - t0} ms, longest step ${longest} ms (${at} steps; slow: ${slow.join(' ')})`);
        }
        return r.value;
      }
      // Let the phone draw a frame between steps.
      await new Promise((res) => setTimeout(res, 0));
    }
  })();
  try {
    return crowdFrom(await prepared);
  } catch (e) {
    // A failed read is not remembered: the next canvas tries again.
    prepared = null;
    throw e;
  }
}
