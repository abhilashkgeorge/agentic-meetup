/**
 * The character model on disk, and the things people wear on top of it.
 *
 * This cannot check that a person LOOKS right -- the contact sheets of
 * scripts/render-looks.mts are for eyes -- but it can check the things that silently
 * do not work and are invisible until somebody looks: that the rig lost only the bones
 * it meant to, that no head is open at the back, and that every hat, pair of glasses,
 * earring, scarf and bag is where it is worn -- ON the head, not inside it; above the
 * collar, not over the chin; on the cloth, not buried in it.
 *
 * It loads the real `assets/characters/people.glb`, not a fixture, so it fails if the
 * build script ever writes something the renderer cannot use.
 *
 * (The rigged crowd this file used to exercise is gone: everybody is drawn by the
 * graphics chip, tests/crowd-gpu.test.ts.)
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - hang the scarf off the head again, where it first was -> "hangs each thing where
 *     it is worn" fails, the scarf is over the women's chins.
 *   - give the beanie an inside as big as the cap's brim -> "keeps hair inside every
 *     hat" fails.
 *   - build the bags' straps at a fixed depth instead of on the cloth -> "lays every
 *     bag's straps on the top it was made for" fails.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { LOOK_SIZES } from '@clone/shared';
import { HAT_INSIDE, LOOKS, roleOf } from '../src/features/world/character';
import type { Manifest } from '../src/features/world/character-mesh';

// three's FileLoader resolves the model's data: URI through a browser event type that
// Node does not have. The same two lines the build script needs, for the same reason.
type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const ASSETS = join(import.meta.dirname, '..', 'assets', 'characters');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as Manifest;

let mesh: typeof import('../src/features/world/character-mesh');
let gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

async function fresh() {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(join(ASSETS, 'people.glb'));
  return new Promise<typeof gltf>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
}

beforeAll(async () => {
  mesh = await import('../src/features/world/character-mesh');
  gltf = await fresh();
});

/** Every skinned mesh by name, and the bind-space matrix into each bone's own space. */
function model() {
  const byName = new Map<string, THREE.SkinnedMesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) byName.set(o.name, o as THREE.SkinnedMesh); });
  const skeleton = byName.values().next().value!.skeleton;
  const into = (bone: string) => skeleton.boneInverses[skeleton.bones.findIndex((b) => b.name === bone)]!;
  const points = (name: string, bone: string) => {
    const m = byName.get(name)!;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    return Array.from({ length: pos.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.bindMatrix).applyMatrix4(into(bone)));
  };
  return { byName, into, points };
}

/**
 * The head, measured the way the renderer measures it.
 *
 * NOT `inverse(bone.matrixWorld)`: a glTF armature is stored in whatever pose the
 * artist left it in, and skinning uses the BIND pose from `inverseBindMatrices`. The
 * two differ here by 0.04 in y and 0.05 in z, which is the whole height of an eye --
 * measured off the scene pose, the glasses ended up inside the skull and nothing at
 * all appeared on the phone.
 */
function headEnvelope() {
  const { byName, into } = model();
  const skeleton = byName.values().next().value!.skeleton;
  const head = skeleton.bones.findIndex((b) => b.name === 'Head');
  const bind = into('Head');
  // Skin only. Hair hangs further forward and further up than the head it is on, and
  // a fringe in front of a lens is the hair doing its job.
  const role = new Map<string, string>();
  for (const look of Object.values(manifest.looks)) for (const part of look.head) role.set(part.mesh, roleOf(part));
  const v = new THREE.Vector3();
  const skin: THREE.Vector3[] = [];
  for (const m of byName.values()) {
    if (role.get(m.name) !== 'skin') continue;
    const { position, skinIndex, skinWeight } = m.geometry.attributes;
    for (let i = 0; i < position!.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (skinIndex!.getComponent(i, k) === head) w += skinWeight!.getComponent(i, k);
      if (w < 0.99) continue;                      // only what the head alone carries
      skin.push(v.fromBufferAttribute(position as THREE.BufferAttribute, i)
        .applyMatrix4(m.bindMatrix).applyMatrix4(bind).clone());
    }
  }
  expect(skin.length, 'no head skin found to measure').toBeGreaterThan(500);
  const eyeBand = skin.filter((p) => p.y > 0.10 && p.y < 0.14 && Math.abs(p.x) > 0.02 && Math.abs(p.x) < 0.09);
  return {
    faceAtEyes: Math.max(...eyeBand.map((p) => p.z)),
    skullTop: Math.max(...skin.map((p) => p.y)),
    widest: Math.max(...skin.map((p) => Math.abs(p.x))),
    chin: Math.min(...skin.map((p) => p.y)),
  };
}

describe('the model', () => {
  it('has no finger or toe bones left, and still has the ones that matter', async () => {
    // These are what the build welds away. 40 of the pack's 62 bones were knuckles.
    const g = await fresh();
    let skinned: THREE.SkinnedMesh | null = null;
    g.scene.traverse((o) => { if (!skinned && (o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh; });
    const names = (skinned as unknown as THREE.SkinnedMesh).skeleton.bones.map((b) => b.name);
    expect(names.length, 'a rig should be two dozen bones, not five dozen').toBeLessThanOrEqual(24);
    for (const finger of ['Index1L', 'Thumb2R', 'Pinky3L', 'PTL', 'PTR']) {
      expect(names, `${finger} survived the weld`).not.toContain(finger);
    }
    for (const real of ['Hips', 'Chest', 'Neck', 'Head', 'WristL', 'FootR', 'UpperLegL']) {
      expect(names, `${real} is missing, so the walk cannot work`).toContain(real);
    }
  });

  it('reweights every vertex cleanly when the finger bones are welded away', async () => {
    // Welding 40 bones into their parents means several influences collapse onto one
    // wrist, and their weights have to ADD and then still sum to exactly one. Get that
    // wrong and vertices drift towards the origin -- hands stretch into the floor -- or
    // point at a bone index that no longer exists, which is a crash or garbage.
    const g = await fresh();
    const meshes: THREE.SkinnedMesh[] = [];
    g.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    expect(meshes.length).toBeGreaterThan(10);
    const bones = meshes[0]!.skeleton.bones.length;
    let checked = 0;
    let worstSum = 0;
    for (const m of meshes) {
      const idx = m.geometry.attributes.skinIndex!;
      const w = m.geometry.attributes.skinWeight!;
      const scale = w.normalized ? 255 : 1;
      for (let v = 0; v < idx.count; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          expect(idx.array[v * 4 + k]!, 'a vertex points at a bone that was removed').toBeLessThan(bones);
          sum += (w.array[v * 4 + k] as number) / scale;
        }
        worstSum = Math.max(worstSum, Math.abs(sum - 1));
        checked++;
      }
    }
    expect(checked, 'no vertices were checked, so this proved nothing').toBeGreaterThan(50_000);
    expect(worstSum, 'weights do not add up to one').toBeLessThan(0.002);

    // AND THE WEIGHT HAS TO LAND IN THE RIGHT PLACE. Summing to one only proves the
    // arithmetic closed; it says nothing about WHICH bone got the hand. Before the
    // weld, 31% of all vertex weight sat on finger bones. After it, that share has to
    // reappear on the wrists -- if the ancestor walk picked the wrong bone (the root,
    // say) the sums would still be one and every hand would be dragged to the floor.
    const names = meshes[0]!.skeleton.bones.map((b) => b.name);
    let total = 0;
    let wrists = 0;
    for (const m of meshes) {
      const idx = m.geometry.attributes.skinIndex!;
      const w = m.geometry.attributes.skinWeight!;
      const scale = w.normalized ? 255 : 1;
      for (let i = 0; i < idx.count * 4; i++) {
        const weight = (w.array[i] as number) / scale;
        total += weight;
        if (/^Wrist[LR]$/.test(names[idx.array[i]!] ?? '')) wrists += weight;
      }
    }
    const share = wrists / total;
    expect(share, 'the hands did not land on the wrists').toBeGreaterThan(0.2);
    expect(share, 'far more than the hands landed on the wrists').toBeLessThan(0.45);
  });

  it('closes the back of every head, so Bald is not a look inside one', async () => {
    // THE BUG THIS EXISTS FOR: the women's heads in this pack are not heads, they are
    // FACES. The artist left the skull off because every look has hair over it, so
    // choosing Bald showed the inside of somebody's face from behind. The build caps
    // any hole it finds; this proves there are none left to find.
    //
    // Matched by POSITION, not by vertex index: a vertex on a normal seam is
    // duplicated, and counting by index calls every seam a hole.
    const g = await fresh();
    const heads = new Set<string>();
    for (const look of Object.values(manifest.looks)) {
      for (const piece of look.head) if (piece.role === 'skin') heads.add(piece.mesh);
    }
    expect(heads.size, 'no heads to check').toBe(Object.keys(manifest.looks).length);

    let checked = 0;
    g.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh || !heads.has(m.name)) return;
      const pos = m.geometry.attributes.position!;
      const index = m.geometry.index!;
      const key = (i: number) =>
        `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
      const seen = new Map<string, number>();
      for (let t = 0; t < index.count; t += 3) {
        const k = [0, 1, 2].map((j) => key(index.getX(t + j)));
        for (let e = 0; e < 3; e++) {
          const id = [k[e]!, k[(e + 1) % 3]!].sort().join('|');
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
      }
      const open = [...seen.values()].filter((n) => n === 1).length;
      expect(open, `${m.name} has ${open} open edges: a hole you can see through`).toBe(0);
      checked++;
    });
    expect(checked, 'no head was actually measured').toBe(heads.size);
  });

  it('keeps facial hair off the heads, so a clean face is clean', async () => {
    // Two heads came with facial hair modelled in: a patch of darker skin over the
    // casual head's jaw and a real moustache on the worker. Whoever picked those heads
    // had a beard they never chose, and "Clean" in the beard rail was stubble. They
    // stay in the MODEL, because every beard is cut out of them.
    const facial = (manifest as unknown as { facial: string[] }).facial;
    expect(facial.length, 'the build found no facial hair to take off').toBeGreaterThan(1);
    for (const look of Object.values(manifest.looks)) {
      for (const slot of ['head', 'top', 'legs', 'feet'] as const) {
        for (const piece of look[slot]) {
          expect(facial, `${piece.mesh} is still worn as part of a ${slot}`).not.toContain(piece.mesh);
        }
      }
    }
    const g = await fresh();
    const inModel = new Set<string>();
    g.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) inModel.add(o.name); });
    for (const name of facial) expect(inModel, `${name} was thrown out of the model`).toContain(name);
  });
});

describe('what people wear on top', () => {
  const boxOf = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

  it('hangs each thing where it is worn', () => {
    // THE BUG THIS EXISTS FOR, twice: placed with numbers read off the armature's
    // stored pose instead of its bind pose, the glasses sat first on the forehead and
    // then inside the skull, where they drew nothing at all; and a scarf hung off the
    // head rode up with every nod and sat on the women's chins.
    const head = headEnvelope();
    const x = mesh.buildExtras();
    // The neck bone sits below the head's; the scarf is measured in the head's space.
    const { into } = model();
    const neckToHead = new THREE.Matrix4().multiplyMatrices(into('Head'), into('Neck').clone().invert());

    for (const kind of ['round', 'sunglasses', 'square'] as const) {
      const b = boxOf(x[kind].geometry);
      expect(x[kind].bone).toBe('Head');
      const eyes = (b.min.y + b.max.y) / 2;
      expect(eyes, `the ${kind} are not at eye height`).toBeGreaterThan(0.10);
      expect(eyes, `the ${kind} are not at eye height`).toBeLessThan(0.14);
      // The lenses themselves are in front of the face (the arms go back to the ears).
      expect(b.max.z, `the ${kind} are inside the face`).toBeGreaterThan(head.faceAtEyes);
    }
    for (const kind of ['cap', 'beanie', 'bucket', 'beret'] as const) {
      const b = boxOf(x[kind].geometry);
      expect(x[kind].bone).toBe('Head');
      expect(b.max.y, `the ${kind} does not cover the top of the head`).toBeGreaterThan(head.skullTop);
      expect(b.min.y, `the ${kind} comes down over the eyes`).toBeGreaterThan(0.13);
      expect(Math.max(-b.min.x, b.max.x), `the ${kind} is narrower than the head`).toBeGreaterThan(head.widest);
    }
    for (const kind of ['studs', 'hoops'] as const) {
      const b = boxOf(x[kind].geometry);
      expect(Math.max(-b.min.x, b.max.x), `the ${kind} are not out at the ears`).toBeGreaterThan(head.widest - 0.01);
    }
    for (const kind of ['scarf', 'necklace', 'bowtie'] as const) {
      expect(x[kind].bone, `the ${kind} does not hang off the neck`).toBe('Neck');
      const b = boxOf(x[kind].geometry.clone().applyMatrix4(neckToHead));
      expect(b.max.y, `the ${kind} is over the chin, not under it`).toBeLessThan(head.chin);
    }
  });

  it('keeps what is worn on the head out of every head', () => {
    // Every face's skin is a closed mesh (the build caps them: "closes the back of
    // every head"), so a point is inside it when a ray from it crosses it an odd
    // number of times. Glasses and hoops must be wholly outside every face -- a lens
    // arm through a temple shows as an arm that stops. What sits ON the head may tuck
    // in where it meets it, out of sight (the beanie's cuff, a stud in the ear, the
    // cap's peak at the brow), but most of it must be outside, where it is seen.
    const x = mesh.buildExtras();
    const { points, byName } = model();
    const ray = new THREE.Raycaster();
    const faces = LOOKS.map((key) => {
      const skin = manifest.looks[key]!.head.find((p) => roleOf(p) === 'skin')!.mesh;
      const g = new THREE.BufferGeometry().setFromPoints(points(skin, 'Head'));
      g.setIndex(byName.get(skin)!.geometry.index);
      return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    });
    for (const kind of ['cap', 'beanie', 'bucket', 'beret', 'round', 'sunglasses', 'square', 'studs', 'hoops'] as const) {
      const pos = x[kind].geometry.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      faces.forEach((face, f) => {
        let inside = 0;
        for (let i = 0; i < pos.count; i++) {
          ray.set(v.fromBufferAttribute(pos, i), new THREE.Vector3(0.577, 0.577, 0.577));
          // Crossings, counted once per surface point (a ray through an edge is hit twice).
          const hits = new Set(ray.intersectObject(face).map((h) => h.distance.toFixed(6)));
          if (hits.size % 2 === 1) inside++;
        }
        const allowed = kind === 'round' || kind === 'sunglasses' || kind === 'square' || kind === 'hoops' ? 0 : 0.2;
        expect(inside / pos.count, `${kind}: ${inside} of ${pos.count} points inside the ${LOOKS[f]} face`)
          .toBeLessThanOrEqual(allowed);
      });
    }
  });

  it('keeps hair inside every hat: each hat\'s inside is inside the hat', () => {
    // HAT_INSIDE is where hair is pulled to under a hat (character.ts). It must lie
    // inside the hat everywhere, or the hair it pulls in shows through: from every
    // point of its upper half, straight out from its middle, there is hat.
    const x = mesh.buildExtras();
    const { points, byName, into } = model();
    const hatMesh = (hat: number): THREE.Mesh => {
      if (hat === 4) {
        const m = byName.get('m_worker_h3')!;
        const g = new THREE.BufferGeometry().setFromPoints(points('m_worker_h3', 'Head'));
        g.setIndex(m.geometry.index);
        return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      }
      const kind = (['cap', 'beanie', 'bucket', null, 'beret'] as const)[hat - 1]!;
      return new THREE.Mesh(x[kind].geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    };
    void into;
    const ray = new THREE.Raycaster();
    for (let hat = 1; hat < LOOK_SIZES.hat; hat++) {
      const inside = HAT_INSIDE[hat]!;
      const hatAt = hatMesh(hat);
      const centre = new THREE.Vector3(0, inside.rim, 0.014);
      let missed = 0, tried = 0;
      for (let a = 0; a < 16; a++) {
        for (const up of [0.15, 0.4, 0.65, 0.9]) {
          const dir = new THREE.Vector3(Math.cos((a / 16) * Math.PI * 2) * Math.cos(up * Math.PI / 2), Math.sin(up * Math.PI / 2),
            Math.sin((a / 16) * Math.PI * 2) * Math.cos(up * Math.PI / 2));
          // The point of the inside in that direction...
          const q = Math.hypot(dir.x / inside.radii[0], dir.y / inside.radii[1], dir.z / inside.radii[2]);
          const p = centre.clone().addScaledVector(dir, 1 / q);
          // ...has hat further out along it.
          ray.set(p, dir);
          tried++;
          if (!ray.intersectObject(hatAt).length) missed++;
        }
      }
      expect(missed, `hat ${hat}: ${missed} of ${tried} points of its inside are outside it`).toBe(0);
    }
  });

  it('lays every bag\'s straps on the top it was made for', () => {
    // A bag is built per top so its straps follow that top's cloth (buildBag). One
    // strap for everybody has to clear the fullest top, so it floats off the tee and
    // cuts through the women's tops at the bust. Checked where it shows most: the
    // backpack's straps down the chest and the shoulder bag's across it lie on the
    // cloth -- neither sunk into it nor standing off it -- on every top. Both surfaces
    // are found by a ray from in front, as the eye finds them.
    const { byName, into } = model();
    const ray = new THREE.Raycaster();
    const frontOf = (g: THREE.BufferGeometry, x: number, y: number) => {
      ray.set(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1));
      return ray.intersectObject(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))[0]?.point.z;
    };
    let checked = 0;
    for (let set = 0; set < LOOKS.length; set++) {
      const body = mesh.clothOf(manifest.looks[LOOKS[set]!]!.top.map((p) => {
        const m = byName.get(p.mesh)!;
        return { geometry: m.geometry, matrix: new THREE.Matrix4().multiplyMatrices(into('Chest'), m.bindMatrix) };
      }));
      for (const [kind, at] of [
        ['backpack', [[0.085, 0.045], [0.085, 0.01], [-0.085, -0.025]]],
        ['shoulderbag', [[0.02, -0.02], [-0.04, -0.11]]],
      ] as const) {
        const g = mesh.buildBag(kind, body)!;
        expect(g, `no ${kind} for ${LOOKS[set]}`).not.toBeNull();
        for (const [x, y] of at) {
          const cloth = frontOf(body, x, y);
          const strap = frontOf(g, x, y);
          expect(cloth, `${LOOKS[set]} has no cloth at (${x}, ${y})`).toBeDefined();
          expect(strap, `${kind} on ${LOOKS[set]} does not cross (${x}, ${y})`).toBeDefined();
          // On the cloth: its lift and its own thickness in front of it, give or take.
          const off = strap! - cloth!;
          expect(off, `${kind} on ${LOOKS[set]} at (${x}, ${y}) is sunk into the cloth`).toBeGreaterThan(0);
          expect(off, `${kind} on ${LOOKS[set]} at (${x}, ${y}) stands ${off.toFixed(3)} off it`).toBeLessThan(0.025);
          checked++;
        }
        g.dispose();
      }
      body.dispose();
    }
    expect(checked, 'no strap was measured').toBe(LOOKS.length * 5);
  });
});
