/**
 * The character model on disk, and the things people wear that it does not model.
 *
 * REACHED ONLY FROM canvas.tsx and the files it reaches (crowd-gpu.ts), which are only
 * reached through `loadWorldRenderer()`. It imports three, so it is in LAZY_ONLY in
 * tests/native-imports.test.ts and importing it from a screen fails the build.
 *
 * WHAT USED TO BE HERE: a rigged body per person, dressed by merging their meshes on
 * the JavaScript thread -- the "one person after the other" the founder watched
 * arrive in the park (2026-09-28). Everybody is drawn by the graphics chip now
 * (crowd-gpu.ts), and since 2026-09-29 so is the builder's preview, so the rig is gone.
 * What is left is what the crowd reads: the model's bytes, the manifest's shape, and
 * the accessories.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Beards, ExtraKind, LookPieces } from './character';

/** The things built once and shared by everybody: everything bar the bags (buildBag). */
export type SharedExtra = Exclude<ExtraKind, 'backpack' | 'shoulderbag'>;
export type BagKind = Extract<ExtraKind, 'backpack' | 'shoulderbag'>;

/** What the build script wrote next to the model: how many pieces each look has. */
export interface Manifest {
  bones: number;
  clips: string[];
  looks: Record<string, { tris: number } & LookPieces>;
  /** The facial-hair meshes, in catalog order after "Clean". */
  beards?: Beards;
}

/**
 * The model stands 1.87 units tall and the capsules it replaced stood about 1.34, so
 * without this everybody would grow by two fifths on the day this landed. The town's
 * proportions -- street widths, building heights, how a person reads against a door --
 * were tuned against the old height and are not worth re-tuning for a new mesh.
 */
export const MODEL_SCALE = 0.72;

/**
 * Read the model off disk.
 *
 * `require` of a .glb gives Metro's asset id, not bytes, so it goes through expo-asset
 * to get a local file and expo-file-system to read it. `fetch` on the resulting file://
 * URI is not reliable on Android, which is why this does not use it.
 */
export async function readModel(): Promise<ArrayBuffer> {
  const { Asset } = await import('expo-asset');
  const asset = Asset.fromModule(require('../../../assets/characters/people.glb') as number);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const { File } = await import('expo-file-system');
  return new File(uri).arrayBuffer();
}

/**
 * Where things sit on the head, IN THE HEAD BONE'S BIND SPACE.
 *
 * MEASURE THROUGH `skeleton.boneInverses[Head]`, NEVER THROUGH `inverse(
 * bone.matrixWorld)`. That is the whole reason this got placed wrong twice. A glTF
 * armature is stored in some arbitrary pose -- ours has the head bone at world
 * (0.004, 1.547, 0.094) -- while skinning uses the BIND pose, which for the same bone
 * is (0.000, 1.587, 0.043). Measured off the scene pose instead, everything came out
 * 0.04 too high and 0.05 too far back -- glasses on the forehead, then glasses inside
 * the skull with nothing on screen at all.
 *
 * The envelope, over every head in the pack, in that frame (skin only; a fringe hangs
 * further forward and is meant to):
 *
 *     chin        y 0.044        skull top    y 0.238
 *     eyes        y 0.10..0.13   widest       |x| 0.109 at y 0.08..0.10
 *     face front  z 0.121 at eye height, 0.128 at the nose
 *     head centre z 0.014        tallest ordinary hair  y 0.27
 *
 * `tests/character-mesh.test.ts` re-measures this from the asset and fails if a thing
 * ends up behind the face, off the side of the head or under the hair.
 */
export const HEAD = {
  midZ: 0.014,
  eyeY: 0.118,
  faceZ: 0.121,
  crownY: 0.192,
  crownR: 0.120,
  earX: 0.106,
  earY: 0.095,
  throatY: -0.022,
};

/**
 * The neck and the chest, IN THEIR OWN BONES' BIND SPACE: the neck bone is bound at
 * (0, 1.511, 0.043), the chest at (0, 1.377, 0.041), both square to the model.
 * Measured over every top in the pack (2026-09-29): the collar's front is 0.138
 * (women's) to 0.152 (the hoodie) forward at model height 1.47; the back, at chest
 * height, is 0.05 behind the bone on the men and level with it on the women.
 */
export const NECK = { collarY: -0.041, collarZ: 0.106, baseY: -0.012, midZ: 0.012 };
export const CHEST = { backZ: -0.046, hipY: -0.407 };

/** The bone each worn thing hangs off. */
export type Bone = 'Head' | 'Neck' | 'Chest';

export interface ExtraShape {
  geometry: THREE.BufferGeometry;
  bone: Bone;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); return g; };
const merged = (parts: THREE.BufferGeometry[]) => {
  // Every shape must merge: the same attributes (no uv) and none of them indexed.
  const flat = parts.map((p) => {
    p.deleteAttribute('uv');
    if (!p.index) return p;
    const g = p.toNonIndexed();
    p.dispose();
    return g;
  });
  const out = mergeGeometries(flat, false);
  for (const g of flat) g.dispose();
  if (!out) throw new Error('an accessory did not merge');
  return out;
};

/**
 * A straight strap from one point to another, as a thin box: a bag's strap.
 */
function strap(from: THREE.Vector3, to: THREE.Vector3, w: number, t: number): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(to, from);
  const box = new THREE.BoxGeometry(w, d.length(), t);
  box.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  box.translate(mid.x, mid.y, mid.z);
  return box;
}

/**
 * Everything people can wear on top of their clothes, from simple shapes: nobody is
 * modelling earrings for a person who is twenty pixels tall. Built once and shared.
 */
export function buildExtras(): Record<SharedExtra, ExtraShape> {
  const proud = HEAD.faceZ + 0.019;     // clear of the skin, not floating off it

  // ── on the head ──
  // A DOME AND A BAND, NOT A CYLINDER. A flat top reads as a bucket, and a crown that
  // only reaches the top of the skull leaves the hair growing through it, so the dome
  // clears the tallest ordinary hair (y 0.27) and the band closes the gap below it.
  // The peak is the FRONT half of a disc: three's cylinder sweeps theta from +x, so
  // `thetaStart = 0` put the peak over the wearer's right ear.
  const capDome = new THREE.SphereGeometry(HEAD.crownR, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  capDome.scale(1, 0.86, 1);
  const cap = merged([
    at(capDome, 0, HEAD.crownY, HEAD.midZ),
    at(new THREE.CylinderGeometry(HEAD.crownR + 0.004, HEAD.crownR + 0.008, 0.05, 12, 1, true), 0, HEAD.crownY - 0.022, HEAD.midZ),
    at(new THREE.CylinderGeometry(0.108, 0.108, 0.012, 12, 1, false, -Math.PI / 2, Math.PI), 0, HEAD.crownY - 0.042, HEAD.midZ + 0.076),
  ]);
  // A beanie: a taller, rounder dome with a rolled cuff, down to just over the ears.
  const beanieDome = new THREE.SphereGeometry(HEAD.crownR + 0.008, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  beanieDome.scale(1, 1.08, 1.05);
  const cuff = new THREE.TorusGeometry(HEAD.crownR + 0.006, 0.02, 6, 16);
  cuff.rotateX(Math.PI / 2);
  const beanie = merged([
    at(beanieDome, 0, HEAD.crownY - 0.012, HEAD.midZ),
    at(cuff, 0, HEAD.crownY - 0.024, HEAD.midZ),
  ]);
  // A bucket hat: a low crown and a brim that slopes down all the way round.
  const bucketDome = new THREE.SphereGeometry(HEAD.crownR + 0.004, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  bucketDome.scale(1, 0.92, 1);
  // The band closes the gap between the crown's edge and the brim, which showed as a
  // bright line through the hat (render-looks.mts hat-hair).
  const bucket = merged([
    at(bucketDome, 0, HEAD.crownY - 0.004, HEAD.midZ),
    at(new THREE.CylinderGeometry(HEAD.crownR + 0.006, HEAD.crownR + 0.008, 0.018, 16, 1, true), 0, HEAD.crownY - 0.01, HEAD.midZ),
    at(new THREE.CylinderGeometry(HEAD.crownR + 0.008, HEAD.crownR + 0.066, 0.03, 16), 0, HEAD.crownY - 0.028, HEAD.midZ),
  ]);
  // A beret: a flat round crown tipped to one side over a snug band. (It replaced a
  // headband, which sat on the hair as a halo: a band at one height meets ten
  // hairstyles at ten different widths.)
  const beretTop = new THREE.SphereGeometry(0.135, 14, 6);
  beretTop.scale(1, 0.4, 1);
  beretTop.rotateZ(0.14);
  const beretBand = new THREE.TorusGeometry(0.117, 0.009, 6, 18);
  beretBand.rotateX(Math.PI / 2);
  const beret = merged([
    at(beretTop, 0.012, HEAD.crownY + 0.01, HEAD.midZ - 0.004),
    at(beretBand, 0, 0.176, HEAD.midZ),
  ]);

  // ── on the eyes ──
  const ring = () => new THREE.TorusGeometry(0.034, 0.007, 6, 12);
  const bridge = () => new THREE.BoxGeometry(0.032, 0.006, 0.006);
  const round = merged([at(ring(), -0.042, HEAD.eyeY, proud), at(ring(), 0.042, HEAD.eyeY, proud), at(bridge(), 0, HEAD.eyeY, proud)]);
  const lens = () => { const l = new THREE.CylinderGeometry(0.036, 0.036, 0.008, 14); l.rotateX(Math.PI / 2); return l; };
  const arm = (side: number) => at(new THREE.BoxGeometry(0.006, 0.006, 0.09), side * 0.104, HEAD.eyeY + 0.004, proud - 0.05);
  const sunglasses = merged([
    at(lens(), -0.043, HEAD.eyeY - 0.002, proud), at(lens(), 0.043, HEAD.eyeY - 0.002, proud),
    at(bridge(), 0, HEAD.eyeY + 0.006, proud), arm(-1), arm(1),
  ]);
  const frame = (cx: number) => {
    const w = 0.068, h = 0.05, t = 0.007;
    return [
      at(new THREE.BoxGeometry(w, t, t), cx, HEAD.eyeY + h / 2, proud),
      at(new THREE.BoxGeometry(w, t, t), cx, HEAD.eyeY - h / 2, proud),
      at(new THREE.BoxGeometry(t, h, t), cx - w / 2, HEAD.eyeY, proud),
      at(new THREE.BoxGeometry(t, h, t), cx + w / 2, HEAD.eyeY, proud),
    ];
  };
  const square = merged([...frame(-0.043), ...frame(0.043), at(bridge(), 0, HEAD.eyeY + 0.008, proud)]);

  // ── in the ears ──
  const stud = () => new THREE.SphereGeometry(0.016, 6, 5);
  const studs = merged([at(stud(), -HEAD.earX, HEAD.earY, HEAD.midZ), at(stud(), HEAD.earX, HEAD.earY, HEAD.midZ)]);
  const hoop = (side: number) => {
    const h = new THREE.TorusGeometry(0.02, 0.0045, 6, 14);
    h.rotateY(Math.PI / 2);
    return at(h, side * (HEAD.earX + 0.004), HEAD.earY - 0.028, HEAD.midZ + 0.005);
  };
  const hoops = merged([hoop(-1), hoop(1)]);

  // ── round the neck ──
  // A scarf: two loose turns round the neck, low on it and above the collar, and a
  // knot at the front. It hangs off the NECK: hung off the head (as it first was) it
  // rode up with every nod and sat on the women's chins.
  const turn = (r: number, tilt: number) => {
    const t = new THREE.TorusGeometry(r, 0.024, 6, 16);
    t.rotateX(Math.PI / 2 + tilt);                 // a torus is born standing up
    return t;
  };
  const scarf = merged([
    at(turn(0.078, 0.1), 0, 0.02, NECK.midZ),
    at(turn(0.084, -0.08), 0, -0.006, NECK.midZ + 0.004),
    at(new THREE.BoxGeometry(0.04, 0.045, 0.03), -0.022, -0.02, NECK.midZ + 0.098),
  ]);
  // A necklace: a fine chain lower at the front, and a pendant at its lowest point.
  const chain = new THREE.TorusGeometry(0.088, 0.004, 5, 24);
  chain.rotateX(Math.PI / 2 - 0.32);
  const necklace = merged([
    at(chain, 0, NECK.baseY, NECK.midZ),
    at(new THREE.SphereGeometry(0.012, 6, 5), 0, NECK.baseY - 0.03, NECK.midZ + 0.086),
  ]);
  // A bow tie at the collar: two cones point in to a knot.
  const wing = (side: number) => {
    const c = new THREE.ConeGeometry(0.017, 0.034, 6);
    c.rotateZ(side * Math.PI / 2);
    return at(c, side * 0.02, NECK.collarY, NECK.collarZ + 0.01);
  };
  const bowtie = merged([wing(-1), wing(1), at(new THREE.BoxGeometry(0.014, 0.016, 0.014), 0, NECK.collarY, NECK.collarZ + 0.012)]);

  return {
    cap: { geometry: cap, bone: 'Head' },
    beanie: { geometry: beanie, bone: 'Head' },
    bucket: { geometry: bucket, bone: 'Head' },
    beret: { geometry: beret, bone: 'Head' },
    round: { geometry: round, bone: 'Head' },
    sunglasses: { geometry: sunglasses, bone: 'Head' },
    square: { geometry: square, bone: 'Head' },
    studs: { geometry: studs, bone: 'Head' },
    hoops: { geometry: hoops, bone: 'Head' },
    scarf: { geometry: scarf, bone: 'Neck' },
    necklace: { geometry: necklace, bone: 'Neck' },
    bowtie: { geometry: bowtie, bone: 'Neck' },
  };
}

/**
 * Some pieces' triangles as one geometry, each moved by its matrix (into a bone's bind
 * space): the cloth buildBag lays straps on.
 */
export function clothOf(pieces: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (const { geometry, matrix } of pieces) {
    const p = geometry.attributes.position as THREE.BufferAttribute;
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      pos.push(v.x, v.y, v.z);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) idx.push(base + geometry.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** How far a strap stands off the cloth under it. */
const STRAP_LIFT = 0.007;

/**
 * A bag, made to fit one top: its straps are laid over that top's own surface.
 *
 * WHY PER TOP. One strap for everybody has to clear the fullest top it goes over, so
 * it floats off every other: the tops' fronts at the chest run from 0.101 (the tee) to
 * 0.150 (the women's tops) in front of the chest bone, and their shoulders from 0.140
 * to 0.220 above it (measured 2026-09-29). So the straps follow the cloth instead:
 * each point of a strap is put on the top's surface, found by a ray at its
 * triangles (not its vertices: the tee is a few big triangles, and a point between
 * its vertices found nothing near it), and a bag is built for each of the ten tops.
 *
 * `body` is the top's triangles in the CHEST bone's bind space, which is what the bag
 * is hung off. Returns null for a top with nothing to lay a strap on.
 */
export function buildBag(kind: BagKind, body: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (!body.attributes.position?.count) return null;
  const cloth = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  const from = new THREE.Vector3();
  const along = new THREE.Vector3();
  /** The outside of the top at a point, STRAP_LIFT clear of it, seen from one side. */
  const out = (x: number, y: number, z: number, side: 'front' | 'back' | 'up'): THREE.Vector3 => {
    if (side === 'up') { from.set(x, 1, z); along.set(0, -1, 0); }
    else { from.set(x, y, side === 'front' ? 1 : -1); along.set(0, 0, side === 'front' ? -1 : 1); }
    ray.set(from, along);
    const hit = ray.intersectObject(cloth)[0];
    if (!hit) return new THREE.Vector3(x, y, z);
    return hit.point.addScaledVector(along, -STRAP_LIFT);
  };
  const chain = (points: readonly THREE.Vector3[], w: number) =>
    points.slice(1).map((p, i) => strap(points[i]!, p, w, 0.008));
  const pos = body.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // The back, behind where a bag hangs: the rearmost cloth across the shoulder blades.
  let back = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (Math.abs(v.x) < 0.1 && v.y < -0.05 && v.y > -0.25 && v.z < back) back = v.z;
  }
  if (!Number.isFinite(back)) back = CHEST.backZ;

  if (kind === 'backpack') {
    const pieces: THREE.BufferGeometry[] = [
      at(new THREE.BoxGeometry(0.22, 0.28, 0.11), 0, -0.16, back - 0.055 - STRAP_LIFT),
      at(new THREE.BoxGeometry(0.16, 0.11, 0.035), 0, -0.22, back - 0.125 - STRAP_LIFT),
    ];
    for (const s of [-1, 1]) {
      const x = s * 0.085;
      // Up the back from the top of the pack, over the shoulder, and down the front to
      // under the arm.
      const path = [
        ...[-0.04, 0, 0.04, 0.08].map((y) => out(x, y, 0, 'back')),
        ...[-0.07, -0.045, -0.02, 0.005, 0.03, 0.055, 0.08].map((z) => out(x, 0, z, 'up')),
        ...[0.08, 0.045, 0.01, -0.025, -0.06].map((y) => out(x, y, 0, 'front')),
      ];
      pieces.push(...chain(path, 0.03));
    }
    return merged(pieces);
  }
  // A shoulder bag: at the left hip, its strap across the front and the back to over
  // the right shoulder.
  const bagX = -0.19, bagY = -0.33;
  const diagonal = (side: 'front' | 'back') => Array.from({ length: 7 }, (_, i) => {
    const t = i / 6;
    return out(0.085 + (bagX + 0.03 - 0.085) * t, 0.08 + (bagY + 0.05 - 0.08) * t, 0, side);
  });
  const front = diagonal('front');
  const over = [0.05, 0.0, -0.05].map((z) => out(0.085, 0, z, 'up'));
  const rear = diagonal('back');
  return merged([
    at(new THREE.BoxGeometry(0.05, 0.13, 0.15), bagX, bagY, 0.01),
    at(new THREE.BoxGeometry(0.052, 0.04, 0.152), bagX, bagY + 0.05, 0.01),
    ...chain([...front.reverse(), ...over, ...rear], 0.022),
  ]);
}
