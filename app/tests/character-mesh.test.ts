/**
 * The rigged crowd, exercised with no phone in the room.
 *
 * This cannot check that a person LOOKS right -- that needs eyes on a device -- but it
 * can check the things that silently do not work and are invisible until somebody
 * looks: that the walk clip actually moves a bone, that a dressed person is one mesh
 * rather than seven, that only the nearest few get a body, and that changing what
 * somebody is wearing changes what is drawn.
 *
 * It loads the real `assets/characters/people.glb`, not a fixture, so it fails if the
 * build script ever writes something the renderer cannot use.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - skip `mixer.update(dt)` in pose() -> "a walking person actually moves" fails,
 *     the ankle sits still.
 *   - sort `near` the other way round (furthest first) -> "gives a body to the nearest
 *     people" fails.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import type { Look } from '@clone/shared';
import type { Crowd, CrowdAgent, Manifest } from '../src/features/world/character-mesh';

// three's FileLoader resolves the model's data: URI through a browser event type that
// Node does not have. The same two lines the build script needs, for the same reason.
type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const ASSETS = join(import.meta.dirname, '..', 'assets', 'characters');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as Manifest;

const look = (over: Partial<Look> = {}): Look => ({
  figure: 0, skin: 3, body: 1, head: 0, hairColor: 0, beard: 0,
  top: 0, legs: 0, feet: 0, outfitColor: 0, accessory: 0, ...over,
});

const agent = (ref: string, x: number, z: number, over: Partial<CrowdAgent> = {}): CrowdAgent => ({
  ref, x, z, facing: 0, look: look(), moving: true, ghost: false, seed: 1, ...over,
});

let makeCrowd: typeof import('../src/features/world/character-mesh').makeCrowd;
let gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

/** A fresh model each time: `harvest` takes the meshes off the rig, so it is one-shot. */
async function fresh() {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(join(ASSETS, 'people.glb'));
  return new Promise<typeof gltf>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
}

beforeAll(async () => {
  ({ makeCrowd } = await import('../src/features/world/character-mesh'));
  gltf = await fresh();
});

const boneNamed = (crowd: Crowd, name: string): THREE.Bone => {
  let found: THREE.Bone | null = null;
  crowd.group.traverse((o) => { if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone; });
  if (!found) throw new Error(`no bone called ${name} in the crowd`);
  return found;
};

/**
 * The head, measured the way the renderer measures it.
 *
 * NOT `inverse(bone.matrixWorld)`: a glTF armature is stored in whatever pose the
 * artist left it in, and skinning uses the BIND pose from `inverseBindMatrices`. The
 * two differ here by 0.04 in y and 0.05 in z, which is the whole height of an eye --
 * measured off the scene pose, the glasses ended up inside the skull and nothing at
 * all appeared on the phone.
 */
async function headEnvelope() {
  const g = await fresh();
  const meshes: THREE.SkinnedMesh[] = [];
  g.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  g.scene.updateMatrixWorld(true);
  const skeleton = meshes[0]!.skeleton;
  const head = skeleton.bones.findIndex((b) => b.name === 'Head');
  const bind = skeleton.boneInverses[head]!;

  // Skin only. Hair hangs further forward and further up than the head it is on, and
  // a fringe in front of a lens is the hair doing its job.
  const role = new Map<string, string>();
  for (const look of Object.values(manifest.looks)) for (const part of look.head) role.set(part.mesh, part.role);

  const v = new THREE.Vector3();
  const skin: THREE.Vector3[] = [];
  for (const m of meshes) {
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

describe('the rigged crowd', () => {
  it('keeps unused rigs out of the scene entirely, not merely hidden', async () => {
    // Hiding a spare rig is not enough: three walks the whole graph every frame,
    // visible or not, and a rig is 22 bones. Measured on a Pixel 6a, the park drew
    // identical calls and triangles with a pool of 12 and of 24 -- 59.8 fps against
    // 30.1 -- purely because of bones being walked for nothing.
    const crowd = makeCrowd(await fresh(), manifest, 4);
    const bodies = () => {
      let n = 0;
      crowd.group.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) n++; });
      return n;
    };
    expect(crowd.drawn.size).toBe(0);
    expect(bodies(), 'nothing should be in the scene before anybody needs a body').toBe(0);

    crowd.pose([agent('a', 0, 0), agent('b', 1, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    expect(bodies(), 'one mesh per person in use, because a person is merged into one').toBe(2);
    expect(crowd.stats.rigs).toBe(2);

    // A quieter frame takes the spares straight back out again.
    crowd.pose([agent('a', 0, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    expect(bodies()).toBe(1);
    crowd.pose([], new THREE.Vector3(), 1 / 30, 0.16);
    expect(bodies(), 'an empty crowd should leave nothing behind').toBe(0);
    crowd.dispose();
  });

  it('dresses a person as ONE mesh, with colours in the vertices', async () => {
    const crowd = makeCrowd(await fresh(), manifest, 2);
    crowd.pose([agent('a', 0, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    let mesh: THREE.SkinnedMesh | null = null;
    crowd.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!mesh && m.isSkinnedMesh && m.parent?.visible) mesh = m;
    });
    const m = mesh as unknown as THREE.SkinnedMesh;
    const g = m.geometry;
    // The whole point of the merge: colour per vertex, one material, one draw call.
    expect(g.attributes.color, 'no vertex colours, so every part would be grey').toBeDefined();
    expect(g.attributes.skinIndex, 'lost the skinning, so the bones would not move it').toBeDefined();
    expect(g.attributes.skinWeight).toBeDefined();
    expect((m.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    const tris = (g.index ? g.index.count : g.attributes.position!.count) / 3;
    expect(tris, 'a person should be a few thousand triangles').toBeGreaterThan(1500);
    expect(tris).toBeLessThan(7000);
    crowd.dispose();
  });

  it('a walking person actually moves', async () => {
    const crowd = makeCrowd(await fresh(), manifest, 1);
    const a = agent('a', 0, 0, { moving: true });
    crowd.pose([a], new THREE.Vector3(), 1 / 30, 0.16);
    const ankle = boneNamed(crowd, 'FootL');
    crowd.group.updateMatrixWorld(true);
    const before = ankle.getWorldPosition(new THREE.Vector3()).clone();
    // Half a second of walking: the clip is 1.33s, so this is a real part of a stride.
    for (let i = 0; i < 15; i++) crowd.pose([a], new THREE.Vector3(), 1 / 30, 0.16);
    crowd.group.updateMatrixWorld(true);
    const after = ankle.getWorldPosition(new THREE.Vector3());
    expect(before.distanceTo(after), 'the foot never left the ground').toBeGreaterThan(0.001);
    crowd.dispose();
  });

  it('gives a body to the nearest people and leaves the rest to the capsules', async () => {
    const crowd = makeCrowd(await fresh(), manifest, 2);
    const people = [agent('far', 40, 0), agent('near', 1, 0), agent('mid', 8, 0)];
    crowd.pose(people, new THREE.Vector3(0, 0, 0), 1 / 30, 0.16);
    expect(crowd.stats.rigs).toBe(2);
    expect([...crowd.drawn].sort()).toEqual(['mid', 'near']);
    expect(crowd.drawn.has('far'), 'the far one should have stayed a capsule').toBe(false);
    // Move the camera and the choice follows it.
    crowd.pose(people, new THREE.Vector3(40, 0, 0), 1 / 30, 0.16);
    expect(crowd.drawn.has('far')).toBe(true);
    expect(crowd.drawn.has('near')).toBe(false);
    crowd.dispose();
  });

  it('re-dresses somebody only when their look changes', async () => {
    const crowd = makeCrowd(await fresh(), manifest, 1);
    const worn = () => {
      let g: THREE.BufferGeometry | null = null;
      crowd.group.traverse((o) => { const m = o as THREE.SkinnedMesh; if (!g && m.isSkinnedMesh) g = m.geometry; });
      return g;
    };
    crowd.pose([agent('a', 0, 0, { look: look({ top: 0 }) })], new THREE.Vector3(), 1 / 30, 0.16);
    const first = worn();
    crowd.pose([agent('a', 0, 0, { look: look({ top: 0 }) })], new THREE.Vector3(), 1 / 30, 0.16);
    expect(worn(), 'an unchanged person was re-dressed for nothing').toBe(first);
    crowd.pose([agent('a', 0, 0, { look: look({ top: 8 }) })], new THREE.Vector3(), 1 / 30, 0.16);
    expect(worn(), 'changing the top did not change the body').not.toBe(first);
    crowd.dispose();
  });

  it('keeps the wardrobe from growing without limit', async () => {
    const crowd = makeCrowd(await fresh(), manifest, 1);
    for (let top = 0; top < 8; top++) {
      for (let colour = 0; colour < 12; colour++) {
        crowd.pose([agent('a', 0, 0, { look: look({ top, outfitColor: colour }) })], new THREE.Vector3(), 1 / 30, 0.16);
      }
    }
    // 96 distinct looks went past; the cache must not be holding 96 bodies.
    expect(crowd.stats.wardrobe).toBeLessThanOrEqual(24);
    expect(crowd.stats.wardrobe).toBeGreaterThan(0);
    crowd.dispose();
  });

  it('draws a practice profile see-through, and a real person solid', async () => {
    // Forty of the forty-one people in the founder's town are practice profiles. An
    // earlier version left them out of the crowd entirely, so only his own agent ever
    // grew legs and the whole feature looked broken on the device.
    const crowd = makeCrowd(await fresh(), manifest, 2);
    crowd.pose([agent('real', 0, 0), agent('fake', 1, 0, { ghost: true })], new THREE.Vector3(), 1 / 30, 0.16);
    expect(crowd.drawn.size, 'a practice profile still gets a body').toBe(2);
    const mats: THREE.MeshLambertMaterial[] = [];
    crowd.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && m.parent?.visible) mats.push(m.material as THREE.MeshLambertMaterial);
    });
    expect(mats).toHaveLength(2);
    expect(mats.some((m) => m.transparent), 'the ghost is not see-through').toBe(true);
    expect(mats.some((m) => !m.transparent), 'the real person is see-through').toBe(true);
    crowd.dispose();
  });

  it('has no finger or toe bones left, and still has the ones that matter', async () => {
    // These are what the build welds away. 40 of the pack's 62 bones were knuckles.
    const crowd = makeCrowd(await fresh(), manifest, 1);
    crowd.pose([agent('a', 0, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    const names: string[] = [];
    crowd.group.traverse((o) => { if ((o as THREE.Bone).isBone) names.push(o.name); });
    expect(names.length, 'a rig should be two dozen bones, not five dozen').toBeLessThanOrEqual(24);
    for (const finger of ['Index1L', 'Thumb2R', 'Pinky3L', 'PTL', 'PTR']) {
      expect(names, `${finger} survived the weld`).not.toContain(finger);
    }
    for (const real of ['Hips', 'Chest', 'Head', 'WristL', 'FootR', 'UpperLegL']) {
      expect(names, `${real} is missing, so the walk cannot work`).toContain(real);
    }
    crowd.dispose();
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

  it('lets you tap a person who has a rigged body', async () => {
    // A rigged person has their capsule hidden, and the capsule is what the slot-
    // indexed tap map is built from -- so the nearest people, the ones most likely to
    // be tapped, were the only ones that could not be. The body carries its own ref.
    const crowd = makeCrowd(await fresh(), manifest, 2);
    crowd.pose([agent('alice', 0, 0), agent('bob', 1, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    const refs: (string | null | undefined)[] = [];
    crowd.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh && m.parent?.visible) refs.push(m.userData.ref as string | undefined);
    });
    expect(refs.filter(Boolean).sort()).toEqual(['alice', 'bob']);
    // A rig that stops being used must not keep answering for somebody.
    crowd.pose([agent('alice', 0, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    const live: (string | null | undefined)[] = [];
    crowd.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) live.push(m.userData.ref as string | undefined);
    });
    expect(live.filter(Boolean)).toEqual(['alice']);
    crowd.dispose();
  });

  it('survives being raycast before anybody is wearing it', async () => {
    // THE CRASH THIS EXISTS FOR. Making the crowd tappable meant rays now enter the
    // group, including rigs that have never been dressed and so hold an EMPTY
    // geometry. three's SkinnedMesh.raycast measures itself on first use and reads
    // `geometry.attributes.position.count`, which on an empty geometry is
    // `undefined.count`. It took the whole Home screen down with
    // "Cannot read property 'count' of undefined".
    const crowd = makeCrowd(await fresh(), manifest, 3);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.15, 5), new THREE.Vector3(0, 0, -1));
    const before: THREE.Intersection[] = [];
    expect(() => ray.intersectObject(crowd.group, true, before)).not.toThrow();
    expect(before, 'an empty rig should not be hit by anything').toHaveLength(0);

    // Once somebody is wearing it, the ray finds them and the body knows who it is.
    crowd.pose([agent('alice', 0, 0)], new THREE.Vector3(), 1 / 30, 0.16);
    crowd.group.updateMatrixWorld(true);
    const after: THREE.Intersection[] = [];
    expect(() => ray.intersectObject(crowd.group, true, after)).not.toThrow();
    expect(after.length, 'a dressed person should be tappable').toBeGreaterThan(0);
    expect(after[0]!.object.userData.ref).toBe('alice');

    // And when they are dropped again, the rig goes quiet rather than answering.
    crowd.pose([], new THREE.Vector3(), 1 / 30, 0.16);
    const gone: THREE.Intersection[] = [];
    expect(() => ray.intersectObject(crowd.group, true, gone)).not.toThrow();
    expect(gone, 'a retired rig is still answering taps').toHaveLength(0);
    crowd.dispose();
  });

  it('honours a per-frame limit, so the two worlds can spend differently', async () => {
    // The city can afford 24 walking figures and the park only 12, because in the park
    // far more of the crowd is genuinely in front of you and each one is 331 pixels
    // tall rather than 13. One pool, two budgets, decided per frame.
    const crowd = makeCrowd(await fresh(), manifest, 6);
    const people = Array.from({ length: 6 }, (_, i) => agent(`p${i}`, i * 0.5, 0));
    const focus = new THREE.Vector3();

    crowd.pose(people, focus, 1 / 30, 0.16, 2);
    expect(crowd.stats.rigs, 'asked for two bodies').toBe(2);
    expect(crowd.drawn.size).toBe(2);

    crowd.pose(people, focus, 1 / 30, 0.16, 5);
    expect(crowd.stats.rigs, 'asked for five').toBe(5);

    // No limit means the whole pool, and the pool is still the hard ceiling.
    crowd.pose(people, focus, 1 / 30, 0.16);
    expect(crowd.stats.rigs).toBe(6);
    crowd.pose(people, focus, 1 / 30, 0.16, 99);
    expect(crowd.stats.rigs, 'a limit cannot conjure rigs that were never built').toBe(6);
    crowd.dispose();
  });

  it('puts glasses, a cap, earrings or a scarf on the head bone', async () => {
    // THE REGRESSION THIS EXISTS FOR. Rigged bodies silently dropped everything from
    // the Extra tab -- four items priced at 50 to 80 points that bought nothing --
    // while the flat avatar and the capsules went on showing them.
    const crowd = makeCrowd(await fresh(), manifest, 1);
    const wornMesh = () => {
      let found: THREE.Mesh | null = null;
      crowd.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!found && m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) found = m;
      });
      return found as THREE.Mesh | null;
    };

    crowd.pose([agent('a', 0, 0, { look: look({ accessory: 0 }) })], new THREE.Vector3(), 1 / 30, 0.16);
    expect(wornMesh()?.visible, 'wearing nothing should show nothing').toBe(false);

    const shapes = new Set<string>();
    for (const [i, name] of [[1, 'glasses'], [2, 'cap'], [3, 'earrings'], [4, 'scarf']] as const) {
      crowd.pose([agent('a', 0, 0, { look: look({ accessory: i }) })], new THREE.Vector3(), 1 / 30, 0.16);
      const m = wornMesh();
      expect(m?.visible, `${name} is not shown`).toBe(true);
      expect(m!.geometry.attributes.position!.count, `${name} has no geometry`).toBeGreaterThan(10);
      shapes.add(m!.geometry.uuid);
      // It has to hang off the head, or it will not move when they walk.
      let onHead = false;
      for (let p = m!.parent; p; p = p.parent) if (p.name === 'Head') onHead = true;
      expect(onHead, `${name} is not parented to the head bone`).toBe(true);
    }
    expect(shapes.size, 'the four items are not four different shapes').toBe(4);

    // Back to nothing, and it goes away again.
    crowd.pose([agent('a', 0, 0, { look: look({ accessory: 0 }) })], new THREE.Vector3(), 1 / 30, 0.16);
    expect(wornMesh()?.visible).toBe(false);
    crowd.dispose();
  });

  it('puts each extra ON the head rather than inside it', async () => {
    // THE SECOND HALF OF THE SAME BUG. Hanging the things off the head bone was not
    // enough: placed with numbers read off the armature's stored pose instead of its
    // bind pose, the glasses sat 0.04 too high and 0.05 too far back -- first on the
    // forehead, then buried in the skull, where they drew nothing at all. Nothing
    // logged either time, because a mesh inside another mesh is not an error.
    const head = await headEnvelope();
    const crowd = makeCrowd(await fresh(), manifest, 1);
    const boxOf = (accessory: number) => {
      crowd.pose([agent('a', 0, 0, { look: look({ accessory }) })], new THREE.Vector3(), 1 / 30, 0.16);
      let worn: THREE.Mesh | null = null;
      crowd.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!worn && m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && m.visible) worn = m;
      });
      const m = worn as THREE.Mesh | null;
      expect(m, `nothing is worn for accessory ${accessory}`).not.toBeNull();
      m!.geometry.computeBoundingBox();
      return m!.geometry.boundingBox!;
    };

    const glasses = boxOf(1);
    expect(glasses.min.z, 'the glasses are behind the face').toBeGreaterThan(head.faceAtEyes);
    const eyeHeight = (glasses.min.y + glasses.max.y) / 2;
    expect(eyeHeight, 'the glasses are not at eye height').toBeGreaterThan(0.10);
    expect(eyeHeight, 'the glasses are not at eye height').toBeLessThan(0.14);

    const cap = boxOf(2);
    expect(cap.max.y, 'the cap does not cover the top of the head').toBeGreaterThan(head.skullTop);
    expect(cap.min.y, 'the cap comes down over the eyes').toBeGreaterThan(0.13);
    expect(Math.max(-cap.min.x, cap.max.x), 'the cap is narrower than the head').toBeGreaterThan(head.widest);

    const earrings = boxOf(3);
    expect(Math.max(-earrings.min.x, earrings.max.x), 'the earrings are not out at the ears')
      .toBeGreaterThan(head.widest - 0.01);

    const scarf = boxOf(4);
    expect(scarf.max.y, 'the scarf is over the chin, not under it').toBeLessThan(head.chin);
    crowd.dispose();
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

  it('scales to the town, not to human size', async () => {
    const crowd = makeCrowd(await fresh(), manifest, 1);
    crowd.pose([agent('a', 3, -4)], new THREE.Vector3(), 1 / 30, 0.16);
    let holder: THREE.Object3D | null = null;
    crowd.group.traverse((o) => { if (!holder && o.visible && o.parent === crowd.group) holder = o; });
    const h = holder as unknown as THREE.Object3D;
    expect(h.position.x).toBe(3);
    expect(h.position.z).toBe(-4);
    // 0.16 is PERSON in canvas.tsx, times the model's own correction.
    expect(h.scale.y).toBeCloseTo(0.16 * 0.72, 5);
    crowd.dispose();
  });
});
