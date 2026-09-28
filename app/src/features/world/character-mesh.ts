/**
 * Real people, with legs that move.
 *
 * REACHED ONLY FROM canvas.tsx, which is itself only reached through
 * `loadWorldRenderer()`. It imports three and a native module, so it is in LAZY_ONLY
 * in tests/native-imports.test.ts and importing it from a screen fails the build.
 *
 * WHAT THIS IS FOR. Everybody in the town was a capsule with a sine wave for a walk.
 * The founder put our screenshot next to a demo with a walking samurai in it and said
 * ours looked worse, and he was right -- not because of the polygon count, but because
 * nothing had legs. This draws the nearest few people as rigged characters playing a
 * real walk cycle, from `assets/characters/people.glb`.
 *
 * THE BUDGET IS DRAW CALLS, NOT TRIANGLES. A dressed character is about 5,000
 * triangles, which is nothing -- the whole city is 32,000 -- but it arrives as six or
 * seven separate meshes, and three has no way to batch meshes that have bones. Sixty-
 * four people at seven meshes each is 448 draw calls against the forty the town uses
 * today, which is not a trade, it is a cliff. So two things happen here:
 *
 *   1. Every person is MERGED INTO ONE MESH, with their colours baked into the
 *      vertices, so a person costs exactly one draw call.
 *   2. Only the nearest `limit` people get one at all. Everyone else stays a capsule,
 *      drawn by the instanced renderer that was already there. Nobody can tell at the
 *      back of a crowd, and the cost stops being a function of how many people exist.
 *
 * The bench (features/dev/gl-bench.tsx) is what decides `limit`, not this comment.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Look } from '@clone/shared';
import { buildScale, clipFor, partsOf, type Beards, type Extra, type LookKey, type LookPieces } from './character';

/** What the build script wrote next to the model: how many pieces each look has. */
export interface Manifest {
  bones: number;
  clips: string[];
  looks: Record<string, { tris: number } & LookPieces>;
  /** The facial-hair meshes, in catalog order after "Clean". */
  beards?: Beards;
}

/**
 * The model stands 1.87 units tall and the capsules it replaces stood about 1.34, so
 * without this everybody would grow by two fifths on the day this landed. The town's
 * proportions -- street widths, building heights, how a person reads against a door --
 * were tuned against the old height and are not worth re-tuning for a new mesh.
 */
export const MODEL_SCALE = 0.72;

/** How long a walk takes to become a stand, and the other way about. */
const BLEND = 0.22;

/** Dressed bodies kept around. Past this, the least recently wanted one is dropped. */
const WARDROBE = 24;

export interface CrowdAgent {
  readonly ref: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly look: Look;
  readonly moving: boolean;
  /** A practice profile: a real body, but see-through, because it is not a real person. */
  readonly ghost: boolean;
  /** Their own number, so two people side by side are not on the same footfall. */
  readonly seed: number;
}

export interface Crowd {
  readonly group: THREE.Group;
  /** Refs that were given a real body this frame; the capsule renderer skips these. */
  readonly drawn: ReadonlySet<string>;
  readonly stats: { rigs: number; triangles: number; wardrobe: number };
  /**
   * Called once a frame, after the sim has stepped. `limit` is how many people may
   * have a real body THIS frame, which differs between the two worlds -- see the
   * measurements above RIGS in canvas.tsx. It cannot exceed the pool it was built with.
   */
  pose(agents: readonly CrowdAgent[], focus: THREE.Vector3, dt: number, scale: number, limit?: number): void;
  dispose(): void;
}

interface Source {
  /** The bone tree, with every mesh already taken off it. */
  armature: THREE.Object3D;
  boneNames: readonly string[];
  boneInverses: THREE.Matrix4[];
  bindMatrix: THREE.Matrix4;
  geometry: Map<string, THREE.BufferGeometry>;
  /** What the artist painted each mesh, for the parts we do not recolour. */
  colour: Map<string, THREE.Color>;
  clips: Map<string, THREE.AnimationClip>;
}

/** One reusable body: a skeleton, a mesh hanging off it, and something playing a clip. */
interface Rig {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  idle: THREE.AnimationAction;
  /** The look currently dressed onto it, so an unchanged person costs nothing. */
  wearing: string | null;
  ref: string | null;
  /** Glasses, a cap, earrings or a scarf, hung off the head bone. One mesh, reshaped. */
  extra: THREE.Mesh;
  extraMat: THREE.MeshLambertMaterial;
  extraKind: Extra;
}

/** A look plus its colours: two people matching this share one dressed body. */
const signature = (look: Look) =>
  `${look.head}/${look.top}/${look.legs}/${look.feet}/${look.beard}/${look.skin}/${look.hairColor}/${look.outfitColor}`;

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
 * The things people wear that the pack does not model: glasses, a cap, earrings, a
 * scarf. Built once and shared, then hung off each rig's head bone so they ride the
 * walk cycle for free.
 *
 * What a thing is when the person's own colours do not decide it. A cap and a scarf
 * take a shade off the outfit wheel (see `partsOf`); glasses and earrings do not,
 * because tinted spectacles and a matching earring look like a costume.
 */
export const EXTRA_OWN_COLOUR: Record<Exclude<Extra, 'none'>, string> = {
  glasses: '#2f333a',
  cap: '#ffffff',
  earrings: '#d9a441',
  scarf: '#ffffff',
};

/**
 * Where things sit, IN THE HEAD BONE'S BIND SPACE.
 *
 * MEASURE THROUGH `skeleton.boneInverses[Head]`, NEVER THROUGH `inverse(
 * bone.matrixWorld)`. That is the whole reason this got placed wrong twice. A glTF
 * armature is stored in some arbitrary pose -- ours has the head bone at world
 * (0.004, 1.547, 0.094) -- while skinning uses the BIND pose, which for the same bone
 * is (0.000, 1.587, 0.043). A child of the bone lands at `bone.matrixWorld * p`, and
 * the skin lands at `bone.matrixWorld * boneInverse * v`, so `p` has to be measured in
 * the same frame the skin is: `boneInverse * bindMatrix * v`. Measured off the scene
 * pose instead, everything came out 0.04 too high and 0.05 too far back -- glasses on
 * the forehead, then glasses inside the skull with nothing on screen at all.
 *
 * The envelope, over every head in the pack, in that frame (skin only; a fringe hangs
 * further forward and is meant to):
 *
 *     chin        y 0.044        skull top    y 0.238
 *     eyes        y 0.10..0.13   widest       |x| 0.109 at y 0.08..0.10
 *     face front  z 0.121 at eye height, 0.128 at the nose
 *     head centre z 0.014
 *
 * `tests/character-mesh.test.ts` re-measures this from the asset and fails if a thing
 * ends up behind the face, off the side of the head or above the hair.
 */
const HEAD = {
  /** The middle of the head in z: what a thing that rings the head is centred on. */
  midZ: 0.014,
  /** Eye height, and how far forward the face is there. */
  eyeY: 0.118,
  faceZ: 0.121,
  /** Where a cap's dome springs from, and how wide it is to cover the hair. */
  crownY: 0.192,
  crownR: 0.120,
  /** Where an ear is: the widest part of the head. */
  earX: 0.106,
  earY: 0.095,
  /** Below the chin, which is at 0.044. */
  throatY: -0.022,
};

export function buildExtras(): Record<Exclude<Extra, 'none'>, THREE.BufferGeometry> {
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); return g; };
  const proud = HEAD.faceZ + 0.019;     // clear of the skin, not floating off it
  const lens = () => new THREE.TorusGeometry(0.034, 0.007, 6, 12);
  const glasses = mergeGeometries([
    at(lens(), -0.042, HEAD.eyeY, proud),
    at(lens(), 0.042, HEAD.eyeY, proud),
    at(new THREE.BoxGeometry(0.032, 0.006, 0.006), 0, HEAD.eyeY, proud),
  ], false)!;
  // A DOME AND A BAND, NOT A CYLINDER. A flat top reads as a bucket, and a crown that
  // only reaches the top of the skull leaves the hair growing through it, so the dome
  // clears the tallest ordinary hair (y 0.27) and the band closes the gap below it.
  // The peak is the FRONT half of a disc: three's cylinder sweeps theta from +x, so
  // `thetaStart = 0` put the peak over the wearer's right ear.
  const dome = new THREE.SphereGeometry(HEAD.crownR, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.86, 1);
  const cap = mergeGeometries([
    at(dome, 0, HEAD.crownY, HEAD.midZ),
    at(new THREE.CylinderGeometry(HEAD.crownR + 0.004, HEAD.crownR + 0.008, 0.05, 12), 0, HEAD.crownY - 0.022, HEAD.midZ),
    at(new THREE.CylinderGeometry(0.108, 0.108, 0.012, 12, 1, false, -Math.PI / 2, Math.PI), 0, HEAD.crownY - 0.042, HEAD.midZ + 0.076),
  ], false)!;
  const stud = () => new THREE.SphereGeometry(0.016, 6, 5);
  const earrings = mergeGeometries([
    at(stud(), -HEAD.earX, HEAD.earY, HEAD.midZ),
    at(stud(), HEAD.earX, HEAD.earY, HEAD.midZ),
  ], false)!;
  const loop = new THREE.TorusGeometry(0.09, 0.032, 6, 14);
  loop.rotateX(Math.PI / 2);                       // a torus is born standing up
  const scarf = at(loop, 0, HEAD.throatY, HEAD.midZ);
  return { glasses, cap, earrings, scarf };
}

function harvest(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): Source {
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (!meshes.length) throw new Error('people.glb has no skinned meshes');

  const first = meshes[0]!;
  const source: Source = {
    armature: gltf.scene,
    boneNames: first.skeleton.bones.map((b) => b.name),
    boneInverses: first.skeleton.boneInverses.map((m) => m.clone()),
    bindMatrix: first.bindMatrix.clone(),
    geometry: new Map(),
    colour: new Map(),
    clips: new Map(gltf.animations.map((c) => [c.name, c])),
  };

  for (const m of meshes) {
    source.geometry.set(m.name, m.geometry);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    source.colour.set(m.name, mat.color.clone());
    // The meshes come off the rig: what is cloned per person is the BONES, and the
    // geometry is shared by everybody, so it is uploaded to the GPU once.
    m.removeFromParent();
  }
  for (const c of ['walk', 'idle']) {
    if (!source.clips.has(c)) throw new Error(`people.glb has no "${c}" clip`);
  }
  return source;
}

/**
 * Build one person's body: their parts, merged into a single geometry, with each
 * part's colour written into its vertices.
 *
 * Baking colour into vertices rather than using one material per part is what buys the
 * single draw call. It costs a copy of the geometry per distinct look on screen, which
 * is about 100 KB, and the wardrobe below caps how many of those exist.
 */
function dress(src: Source, look: Look, pieces: (k: LookKey) => LookPieces | undefined, beards: Beards): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const part of partsOf(look, pieces, beards).parts) {
    const geo = src.geometry.get(part.mesh);
    if (!geo) continue;                       // a look that lost a mesh loses the part
    const clone = geo.clone();
    const c = part.tint ? new THREE.Color(part.tint) : (src.colour.get(part.mesh) ?? new THREE.Color(0xffffff));
    const n = clone.attributes.position!.count;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
    clone.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geos.push(clone);
  }
  if (!geos.length) throw new Error('nobody can be dressed in nothing');
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('the parts of a person did not merge; their attributes must differ');
  return merged;
}

/** Read the model and the manifest off disk, then build the crowd from them. */
export async function loadCrowd(limit: number): Promise<Crowd> {
  const bytes = await readModel();
  const gltf = await new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(bytes, '', res as never, rej));
  return makeCrowd(gltf, require('../../../assets/characters/people.json') as Manifest, limit);
}

/**
 * Everything that is not reading a file. Split out so a test can hand it a model it
 * loaded itself and check that a person actually moves, with no phone in the room.
 */
export function makeCrowd(
  gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
  manifest: Manifest,
  limit: number,
): Crowd {
  const src = harvest(gltf);
  const pieces = (key: LookKey): LookPieces | undefined => manifest.looks[key];
  const beards: Beards = manifest.beards ?? [];

  const group = new THREE.Group();
  group.name = 'crowd';
  // Two materials, not one per person: colour lives in the vertices, so the only thing
  // a material still decides is whether you can see through somebody. Practice
  // profiles are see-through, which is how the town has always said "not a real
  // person", and they are most of the crowd -- forty of forty-one on the founder's
  // phone -- so leaving them out of this would have left almost nobody with legs.
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const ghostMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.5 });

  const wardrobe = new Map<string, THREE.BufferGeometry>();
  const dressed = (look: Look): THREE.BufferGeometry => {
    const key = signature(look);
    const had = wardrobe.get(key);
    if (had) { wardrobe.delete(key); wardrobe.set(key, had); return had; }   // keep it fresh
    const made = dress(src, look, pieces, beards);
    wardrobe.set(key, made);
    while (wardrobe.size > WARDROBE) {
      const oldest = wardrobe.keys().next().value as string;
      wardrobe.get(oldest)!.dispose();
      wardrobe.delete(oldest);
    }
    return made;
  };

  /** Take a rig out of the scene entirely, or put it back. */
  const park = (rig: Rig) => {
    rig.group.visible = false;
    rig.extra.visible = false;
    rig.extraKind = 'none';
    rig.ref = null;
    rig.mesh.userData.ref = null;
    if (rig.group.parent) rig.group.removeFromParent();
  };
  const unpark = (rig: Rig) => {
    if (!rig.group.parent) group.add(rig.group);
    rig.group.visible = true;
  };

  const extras = buildExtras();

  const rigs: Rig[] = [];
  for (let i = 0; i < limit; i++) {
    const holder = new THREE.Group();
    const bones = cloneRig(src.armature);
    const found = new Map<string, THREE.Bone>();
    bones.traverse((o: THREE.Object3D) => { if ((o as THREE.Bone).isBone) found.set(o.name, o as THREE.Bone); });
    const ordered = src.boneNames.map((n) => {
      const b = found.get(n);
      if (!b) throw new Error(`the cloned rig is missing bone "${n}"`);
      return b;
    });
    const skeleton = new THREE.Skeleton(ordered, src.boneInverses);
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), solidMat);
    mesh.frustumCulled = false;   // the bones move it; its own box is the T-pose
    /**
     * A rig nobody is using must not answer a tap, and must not be asked to measure
     * itself either.
     *
     * A rig starts life holding an EMPTY geometry -- it has no look to wear until
     * somebody is assigned to it -- and three's SkinnedMesh.raycast measures its own
     * bounding sphere on first use, which reads `geometry.attributes.position.count`.
     * On an empty geometry that is `undefined.count`, and the whole screen dies:
     *
     *     Uncaught Error: Cannot read property 'count' of undefined
     *       SkinnedMesh#computeBoundingSphere -> SkinnedMesh#raycast -> Raycaster
     *
     * That went unnoticed until the crowd was made tappable, because until then
     * nothing ever raycast into it. `userData.ref` is set only while a rig is standing
     * in for a real person, so it is exactly the right thing to gate on.
     */
    mesh.raycast = function raycastWhenWorn(raycaster, intersects) {
      if (!this.userData.ref) return;
      THREE.SkinnedMesh.prototype.raycast.call(this, raycaster, intersects);
    };
    holder.add(bones, mesh);
    mesh.bind(skeleton, src.bindMatrix);
    /**
     * A SPARE RIG IS NOT ADDED TO THE SCENE AT ALL.
     *
     * Hiding it is not enough. three walks the whole graph in `updateMatrixWorld`
     * every frame, visible or not, and a rig is twenty-two bones. Measured on a Pixel
     * 6a: the park with 24 people drew exactly the same 63 calls and 175,578 triangles
     * whether the pool held 12 rigs or 24 -- and ran at 59.8 fps against 30.1. The
     * only difference was 264 more bones being walked for nothing. So unused rigs are
     * detached, and rejoin the scene the moment somebody needs one.
     */
    holder.visible = false;

    // Worn things ride the head bone, so they turn and bob with it and cost nothing
    // to keep in place. One mesh per rig whose geometry is swapped, not four meshes.
    const headBone = ordered.find((b) => b.name === 'Head');
    if (!headBone) throw new Error('the rig has no Head bone to hang anything off');
    const extraMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const extra = new THREE.Mesh(extras.glasses, extraMat);
    extra.visible = false;
    extra.frustumCulled = false;
    extra.raycast = () => {};          // taps belong to the body, not the earring
    headBone.add(extra);

    const mixer = new THREE.AnimationMixer(holder);
    const walk = mixer.clipAction(src.clips.get('walk')!);
    const idle = mixer.clipAction(src.clips.get('idle')!);
    walk.play(); idle.play();
    walk.setEffectiveWeight(0); idle.setEffectiveWeight(1);
    rigs.push({
      group: holder, mesh, skeleton, mixer, walk, idle, wearing: null, ref: null,
      extra, extraMat, extraKind: 'none',
    });
  }

  /**
   * Looks that could not be dressed, so they are not attempted again.
   *
   * This happens for real: the model and the manifest beside it are written by the
   * same script, but a phone can be holding a cached copy of one and a fresh copy of
   * the other for a moment after a rebuild, and then a look names meshes that are not
   * there. Throwing from inside the frame loop takes the whole town down over it. A
   * person nobody can dress stays a capsule, which is exactly what they were before.
   */
  const broken = new Set<string>();
  const drawn = new Set<string>();
  const stats = { rigs: 0, triangles: 0, wardrobe: 0 };
  const near: { a: CrowdAgent; d: number }[] = [];

  return {
    group,
    drawn,
    stats,
    pose(agents, focus, dt, scale, limit) {
      drawn.clear();
      near.length = 0;
      for (const a of agents) near.push({ a, d: (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 });
      near.sort((p, q) => p.d - q.d);
      const take = Math.min(limit ?? rigs.length, rigs.length, near.length);

      let triangles = 0;
      for (let i = 0; i < rigs.length; i++) {
        const rig = rigs[i]!;
        if (i >= take) { park(rig); continue; }
        const a = near[i]!.a;

        const key = signature(a.look);
        if (broken.has(key)) { park(rig); continue; }
        if (rig.wearing !== key) {
          try {
            rig.mesh.geometry = dressed(a.look);
            rig.wearing = key;
          } catch (e) {
            broken.add(key);
            console.warn(`[world] cannot dress ${key}, leaving them a capsule:`, e);
            park(rig);
            continue;
          }
        }
        // A rig that has just changed hands starts its clip somewhere of its own, or a
        // row of strangers walks in step like a parade.
        if (rig.ref !== a.ref) {
          const offset = (a.seed % 100) / 100;
          rig.walk.time = offset * rig.walk.getClip().duration;
          rig.idle.time = offset * rig.idle.getClip().duration;
          rig.ref = a.ref;
        }

        rig.mesh.material = a.ghost ? ghostMat : solidMat;

        // What they are wearing on top. Only touched when it changes, because
        // swapping a geometry every frame would undo the point of the wardrobe.
        const worn = partsOf(a.look, pieces, beards);
        if (rig.extraKind !== worn.extra) {
          rig.extraKind = worn.extra;
          rig.extra.visible = worn.extra !== 'none';
          if (worn.extra !== 'none') rig.extra.geometry = extras[worn.extra];
        }
        if (worn.extra !== 'none') {
          rig.extraMat.color.set(worn.extraTint ?? EXTRA_OWN_COLOUR[worn.extra]);
          rig.extraMat.transparent = a.ghost;
          rig.extraMat.opacity = a.ghost ? 0.5 : 1;
        }
        // Who this body belongs to, for taps. A person with a rigged body has their
        // capsule hidden, and the capsule is what the tap map is built from -- so
        // without this the nearest people, the ones most likely to be tapped, are the
        // only ones you cannot tap.
        rig.mesh.userData.ref = a.ref;
        const [bx, , bz] = buildScale(a.look);
        const s = scale * MODEL_SCALE;
        unpark(rig);
        rig.group.position.set(a.x, 0, a.z);
        rig.group.rotation.set(0, a.facing, 0);
        rig.group.scale.set(s * bx, s, s * bz);

        const want = clipFor(a.moving) === 'walk' ? 1 : 0;
        const step = Math.min(1, dt / BLEND);
        const w = rig.walk.getEffectiveWeight() + (want - rig.walk.getEffectiveWeight()) * step;
        rig.walk.setEffectiveWeight(w);
        rig.idle.setEffectiveWeight(1 - w);
        rig.mixer.update(dt);

        drawn.add(a.ref);
        const g = rig.mesh.geometry;
        triangles += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
      }
      stats.rigs = take;
      stats.triangles = Math.round(triangles);
      stats.wardrobe = wardrobe.size;
    },
    dispose() {
      for (const rig of rigs) if (!rig.group.parent) group.add(rig.group);
      for (const g of wardrobe.values()) g.dispose();
      wardrobe.clear();
      for (const rig of rigs) { rig.mixer.stopAllAction(); rig.mesh.geometry.dispose(); rig.extraMat.dispose(); }
      for (const g of Object.values(extras)) g.dispose();
      for (const g of src.geometry.values()) g.dispose();
      solidMat.dispose();
      ghostMat.dispose();
      group.clear();
    },
  };
}
