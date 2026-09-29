/**
 * The crowd drawn by the graphics chip: every person a real, walking body, dressed
 * exactly as the builder dresses them, at three levels of detail.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28): "even at 1000 people the gameplay should be
 * smooth. I don't want users to be shown as capsules." Measured before: a 35 ms frame
 * with 1000 people, all of it on the JavaScript thread (crowd-gpu.ts has the numbers).
 *
 * WHAT IS PINNED HERE, on the real model (assets/characters/people.glb):
 *   - the baked animation is three's own skinning: a vertex skinned from the bake lands
 *     where three's CPU skinning of the same clip at the same time puts it;
 *   - a person wears exactly the parts `partsOf` gives them -- no more, no fewer -- at
 *     the near level, and at the middle level the same parts, merged smaller; what
 *     they wear on top is there, one of each, and a bag is the one made for their top;
 *   - a hairstyle grown for a bigger skull is drawn grown, and hair under a hat is
 *     pulled in by the same numbers the builder uses;
 *   - the far level is the same choices merged harder, without the small things; the
 *     tiny level one outfit per top, merged hardest, for people a few pixels tall;
 *   - the frame's buffers hold exactly what update() was given, nearest first, per
 *     level, and a person keeps no body in two levels at once;
 *   - only the people written are sent to the GPU, not each buffer's whole capacity;
 *   - the build comes in steps, a look at a time, so the phone can draw between them,
 *     and the stepped build is the same geometry as the one done at once;
 *   - on the map, where nobody shrinks with distance, everybody is at the level their
 *     size on screen says, and the nearest to the middle get the near level.
 * The shader cannot run in node: `wears` and `skinFromBake` are the shader's rules in
 * JavaScript, and the last test holds the shader text to them (SOURCE SHAPE).
 *
 * Negative controls, run 2026-09-28 (and 2026-09-29 for the new options), each
 * restored byte-identical:
 *   - the bake without each bone's inverse bind matrix -> "lands where three puts it" fails
 *   - fixedOf() choosing the plain hair where it is grown -> "grows the hair" fails
 *   - fixedOf() choosing the bag made for the Tee for everybody -> "a bag made for their top" fails
 *   - update() not moving past a full level            -> "per level" fails
 *   - update() without its update range                -> "only the people written" fails
 *   - levelSteps() without its yield per look          -> "comes in steps" fails
 *   - mergePieces() without the index offset           -> "exactly what three's own merge makes" fails
 *   - tagged() taking the model's interleaved normals as they are -> "each normal is a real direction" fails
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { EXTRA_PARTS, HARD_HAT, LOOK_SIZES, SHAVED, STARTER, type Look } from '@clone/shared';
import type { Manifest } from '../src/features/world/character-mesh';
import type * as Gpu from '../src/features/world/crowd-gpu';

type Ctor = { new (type: string, init?: Record<string, unknown>): Event };
(globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) { super(type); Object.assign(this, init); }
} as unknown as Ctor;

const ASSETS = join(import.meta.dirname, '..', 'assets', 'characters');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as Manifest;
const look = (over: Partial<Look> = {}): Look => ({ ...STARTER, outfitColor: 0, ...over });
type Gltf = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
async function fresh(): Promise<Gltf> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = readFileSync(join(ASSETS, 'people.glb'));
  return new Promise((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as never, rej));
}

let gpu: typeof Gpu;
let character: typeof import('../src/features/world/character');
beforeAll(async () => {
  gpu = await import('../src/features/world/crowd-gpu');
  character = await import('../src/features/world/character');
});

describe('the baked animation', () => {
  it('lands a vertex where three skins it, for walk and idle', async () => {
    const gltf = await fresh();
    const meshes: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    const sample = meshes[5]!;
    const names = sample.skeleton.bones.map((b) => b.name);
    const bake = gpu.bakeClips(gltf.scene, names, sample.skeleton.boneInverses,
      new Map(gltf.animations.map((c) => [c.name, c])));
    expect(bake.rows).toBe(bake.walk.frames + bake.idle.frames + bake.sit.frames);

    // three's own answer: the same clip on the model's own skeleton, at the same time.
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const pos = sample.geometry.attributes.position!;
    const si = sample.geometry.attributes.skinIndex!;
    const sw = sample.geometry.attributes.skinWeight!;
    for (const [clip, at] of [['walk', bake.walk], ['idle', bake.idle]] as const) {
      const action = mixer.clipAction(gltf.animations.find((c) => c.name === clip)!);
      action.reset().play();
      for (const frame of [0, 7, at.frames - 1]) {
        mixer.setTime(frame / gpu.BAKE_FPS);
        gltf.scene.updateMatrixWorld(true);
        sample.skeleton.update();
        for (const v of [0, 101, pos.count - 1]) {
          const three = sample.applyBoneTransform(v, new THREE.Vector3().fromBufferAttribute(pos, v));
          const ours = gpu.skinFromBake(bake, at.row + frame,
            [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)], [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)],
            new THREE.Vector3().fromBufferAttribute(pos, v));
          expect(ours.distanceTo(three), `${clip} frame ${frame} vertex ${v}`).toBeLessThan(1e-4);
        }
      }
      action.stop();
    }
  });
});

describe('sitting', () => {
  it('sits: lower, thighs forward, feet on the ground and still on the legs', async () => {
    // The pack has no sitting clip; sitPose makes one from idle. The rig's feet hang
    // off the root, not the shins -- moved with the legs, or the shoes stay behind.
    const gltf = await fresh();
    const meshes = new Map<string, THREE.SkinnedMesh>();
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.set(o.name, o as THREE.SkinnedMesh); });
    const any = [...meshes.values()][0]!;
    const bake = gpu.bakeClips(gltf.scene, any.skeleton.bones.map((b) => b.name), any.skeleton.boneInverses,
      new Map(gltf.animations.map((c) => [c.name, c])));
    const points = (name: string, row: number) => {
      const m = meshes.get(name)!;
      const pos = m.geometry.attributes.position!, si = m.geometry.attributes.skinIndex!, sw = m.geometry.attributes.skinWeight!;
      return Array.from({ length: pos.count }, (_, v) => gpu.skinFromBake(bake, row,
        [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)], [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)],
        new THREE.Vector3().fromBufferAttribute(pos, v)));
    };
    const box = (name: string, row: number) => new THREE.Box3().setFromPoints(points(name, row));
    /** How far forward the soles are: the lowest few centimetres of the shoes. */
    const soles = (row: number) => {
      const ps = points('m_casual_2_b1', row);
      const low = Math.min(...ps.map((q) => q.y));
      const sole = ps.filter((q) => q.y < low + 0.03);
      return sole.reduce((n, q) => n + q.z, 0) / sole.length;
    };
    const idle = bake.idle.row, sit = bake.sit.row;
    const legs = { idle: box('m_casual_2_b3', idle), sit: box('m_casual_2_b3', sit) };
    const feet = { idle: box('m_casual_2_b1', idle), sit: box('m_casual_2_b1', sit) };
    // Where a bone's joint is, in a row of the bake.
    const names = any.skeleton.bones.map((b) => b.name);
    const joint = (bone: string, row: number) => {
      const i = names.indexOf(bone);
      const bind = new THREE.Vector3().setFromMatrixPosition(any.skeleton.boneInverses[i]!.clone().invert());
      return gpu.skinFromBake(bake, row, [i, 0, 0, 0], [1, 0, 0, 0], bind);
    };
    expect(legs.idle.max.y - legs.sit.max.y, 'the body did not come down').toBeGreaterThan(0.3);
    // Thighs forward and level, hip to knee. (This once compared how far forward the
    // whole leg reached, which the bent-out shins below made pass on their own.)
    for (const side of ['L', 'R'] as const) {
      const thigh = joint(`LowerLeg${side}`, sit).sub(joint(`UpperLeg${side}`, sit));
      expect(thigh.z / thigh.length(), `the ${side} thigh is not forward and level`).toBeGreaterThan(0.95);
    }
    expect(Math.abs(feet.sit.min.y - feet.idle.min.y), 'the feet left the ground').toBeLessThan(0.06);
    // The SOLES, not the whole shoe: a high-top's upper follows the shin wherever the
    // foot is, so only the soles say whether the feet came with the legs.
    expect(soles(sit) - soles(idle), 'the feet stayed where the standing feet were').toBeGreaterThan(0.25);
    // Shoes on the legs: the trousers reach down to the top of the shoes, as standing.
    expect(legs.sit.min.y - feet.sit.max.y, 'a gap between the trousers and the shoes').toBeLessThan(legs.idle.min.y - feet.idle.max.y + 0.05);
    // SHINS STRAIGHT DOWN UNDER THE KNEES: nothing of the legs further forward than a
    // knee and its kneecap. sitPose once aimed each shin by the foot -- which hangs off
    // the root and so stays where the standing foot was -- and the shins stuck out
    // forward, 38 cm past the knees, with the ankles stretched back to the ground (a
    // couple drawn on a bench, scripts/render-bench.mts, 2026-09-29).
    const front = Math.max(joint('LowerLegL', sit).z, joint('LowerLegR', sit).z);
    expect(legs.sit.max.z - front, 'the shins stick out past the knees').toBeLessThan(0.12);
  });
});

describe('the levels', () => {
  let levels: THREE.BufferGeometry[];
  const pieces = (k: import('../src/features/world/character').LookKey) => manifest.looks[k];
  const beards = manifest.beards ?? [];
  let byName: Map<string, THREE.BufferGeometry>;

  beforeAll(async () => {
    const gltf = await fresh();
    const meshes: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    byName = new Map(meshes.map((m) => [m.name, m.geometry]));
    const colour = new Map(meshes.map((m) => [m.name, ((m.material as THREE.MeshStandardMaterial).color).clone()]));
    const skeleton = meshes[0]!.skeleton;
    const bone = (name: string) => {
      const index = skeleton.bones.findIndex((b) => b.name === name);
      return { index, bind: skeleton.boneInverses[index]!.clone().invert() };
    };
    levels = gpu.buildLevels({
      geometry: byName, colour, pieces, beards, bones: { Head: bone('Head'), Neck: bone('Neck'), Chest: bone('Chest') },
    });
  });

  /** The kept vertices of one slot at a level, for a person: where they are in bind space. */
  const keptIn = (g: THREE.BufferGeometry, f: Float32Array, slot: number): THREE.Box3 => {
    const meta = g.attributes.aMeta!;
    const pos = g.attributes.position!;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < meta.count; i++) {
      if (meta.getY(i) !== slot || !gpu.wears([meta.getX(i), meta.getY(i), meta.getZ(i)], f)) continue;
      box.expandByPoint(v.fromBufferAttribute(pos, i));
    }
    return box;
  };

  /** Triangles a person keeps at a level: the shader's choice, vertex by vertex. */
  const kept = (g: THREE.BufferGeometry, f: Float32Array): number => {
    const meta = g.attributes.aMeta!;
    const idx = g.index!;
    let n = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const v = idx.getX(t);
      if (gpu.wears([meta.getX(v), meta.getY(v), meta.getZ(v)], f)) n++;
    }
    return n;
  };
  const trisOf = (mesh: string) => (byName.get(mesh)!.index!.count) / 3;

  it('dresses a person in exactly the parts partsOf gives them, near and middle', () => {
    const looks: Look[] = [
      look(),
      look({ head: 3, hair: 5, top: 5, legs: 7, feet: 9, beard: 2 }),
      // A shaved head on a face that ends at the hairline: the scalp is a part.
      look({ head: 4, hair: SHAVED, figure: 0, top: 4, legs: 4, feet: 4 }),
      // A grown hairstyle, and the pack's hard hat.
      look({ head: 0, hair: 3, hat: HARD_HAT }),
      look({ head: 8, hair: 8, top: 8, legs: 8, feet: 8, beard: 4 }),
    ];
    for (const l of looks) {
      const f = gpu.fixedOf(l, pieces, beards);
      const who = character.partsOf(l, pieces, beards);
      expect(who.extras, 'these looks wear nothing on top').toEqual([]);
      const want = who.parts.reduce((n, p) => n + trisOf(p.mesh), 0);
      const near = kept(levels[0]!, f);
      expect(near, `look ${JSON.stringify(l)}`).toBe(want);
      const middle = kept(levels[1]!, f);
      expect(middle).toBeGreaterThan(0);
      expect(middle, 'the middle level is not smaller').toBeLessThan(near * 0.75);
    }
  });

  it('wears what goes on top, one of each, near and middle', () => {
    const bare = look({ head: 1, hair: 1, figure: 1, top: 1, legs: 1, feet: 1 });
    const base = kept(levels[0]!, gpu.fixedOf(bare, pieces, beards));
    for (const part of EXTRA_PARTS) {
      for (let i = 1; i < LOOK_SIZES[part]; i++) {
        const l = { ...bare, [part]: i };
        const f = gpu.fixedOf(l, pieces, beards);
        const more = kept(levels[0]!, f) - base;
        // The hard hat is a mesh of the pack's and is counted with the parts.
        const hard = part === 'hat' && i === HARD_HAT
          ? character.partsOf(l, pieces, beards).parts.filter((p) => p.worn === 'hat').reduce((n, p) => n + trisOf(p.mesh), 0) : 0;
        expect(more, `${part} ${i} drew nothing`).toBeGreaterThan(hard > 0 ? hard - 1 : 3);
        expect(more, `${part} ${i} drew more than one thing`).toBeLessThan(hard + 2500);
        expect(kept(levels[1]!, f) - kept(levels[1]!, gpu.fixedOf(bare, pieces, beards)), `${part} ${i} is gone in the middle`)
          .toBeGreaterThan(0);
      }
    }
    // Everything at once is the sum of each on its own.
    const all = { ...bare, hat: 1, glasses: 2, earrings: 1, neck: 3, bag: 2 };
    const each = EXTRA_PARTS.reduce((n, part) => n + kept(levels[0]!, gpu.fixedOf({ ...bare, [part]: all[part] }, pieces, beards)) - base, 0);
    expect(kept(levels[0]!, gpu.fixedOf(all, pieces, beards)) - base).toBe(each);
  });

  it('hangs a bag made for their top, on every top', () => {
    // Each bag is built to lie on one top's surface (buildBag); somebody in the hoodie
    // wears the hoodie's backpack, not the tee's.
    for (let top = 0; top < 10; top++) {
      const l = look({ top, legs: top, bag: 1 });
      const f = gpu.fixedOf(l, pieces, beards);
      expect(f[22], `top ${top}`).toBe(gpu.bagVariant('backpack', top));
      const box = keptIn(levels[0]!, f, gpu.SLOT_ID.bag);
      expect(box.isEmpty(), `top ${top} has no bag`).toBe(false);
      const other = keptIn(levels[0]!, gpu.fixedOf({ ...l, top: (top + 1) % 10, legs: (top + 1) % 10 }, pieces, beards), gpu.SLOT_ID.bag);
      expect(box.equals(other), `tops ${top} and ${(top + 1) % 10} share a bag`).toBe(false);
    }
  });

  it('grows the hair the builder grows, and only there', () => {
    // The Bob on a whole skull is drawn 1.12 times its size about the middle of the
    // skull; on its own face it is drawn as it is.
    const grown = keptIn(levels[0]!, gpu.fixedOf(look({ head: 0, hair: 3 }), pieces, beards), gpu.SLOT_ID.hair);
    const plain = keptIn(levels[0]!, gpu.fixedOf(look({ head: 3, hair: 3, figure: 1 }), pieces, beards), gpu.SLOT_ID.hair);
    const size = (b: THREE.Box3) => b.getSize(new THREE.Vector3());
    const ratio = size(grown).x / size(plain).x;
    expect(ratio).toBeCloseTo(character.HAIR_FIT[3]![0]!, 3);
    // The scalp is the crew cut's shell, in skin, and nothing else in the hair slot.
    const scalp = gpu.fixedOf(look({ head: 4, hair: SHAVED }), pieces, beards);
    expect(scalp[13]).toBe(gpu.SCALP_VARIANT);
    expect(gpu.fixedOf(look({ head: 0, hair: SHAVED }), pieces, beards)[13]).toBe(gpu.NONE);
  });

  it('pulls hair in under a hat by the builder\'s own numbers', () => {
    const u = gpu.hatUniform();
    for (let v = 0; v < u.length; v++) {
      const h = character.HAT_INSIDE[v === 6 ? HARD_HAT : v];
      if (!h) { expect(u[v]!.x, `variant ${v} pulls hair in with no hat`).toBeGreaterThan(10); continue; }
      expect(u[v]!.toArray()).toEqual([h.rim, ...h.radii]);
    }
    // The women's hard hat is its own variant, and pulls in like the men's.
    expect(gpu.fixedOf(look({ head: 1, figure: 1, hat: HARD_HAT }), pieces, beards)[18]).toBe(6);
    expect(gpu.fixedOf(look({ head: 0, hat: HARD_HAT }), pieces, beards)[18]).toBe(HARD_HAT);
  });

  it('keeps the artist\'s colour on trousers and shoes nobody has coloured', () => {
    // "As made" is the vertex colour (paintOf's `own`): the fabric's vertices must
    // carry the artist's colour, not the white the always-painted pieces carry. They
    // carried white for a day and every pair of trousers left as made came out white.
    const meta = levels[0]!.attributes.aMeta!;
    const col = levels[0]!.attributes.color!;
    for (const role of ['legs', 'feet'] as const) {
      const f = gpu.fixedOf(look({ head: 1, figure: 1, top: 1, legs: 1, feet: 1 }), pieces, beards);
      let seen = 0, white = 0;
      for (let i = 0; i < meta.count; i++) {
        if (meta.getX(i) !== gpu.ROLE[role] || !gpu.wears([meta.getX(i), meta.getY(i), meta.getZ(i)], f)) continue;
        seen++;
        if (col.getX(i) > 0.99 && col.getY(i) > 0.99 && col.getZ(i) > 0.99) white++;
      }
      expect(seen, `no ${role} fabric drawn`).toBeGreaterThan(10);
      expect(white, `${role} left as made is white`).toBe(0);
      // ...and it is the artist's colour: the as-made paint is the vertex colour.
      const as = gpu.paintOf(gpu.ROLE[role], [0.2, 0.3, 0.4], f);
      expect(as).toEqual([0.2, 0.3, 0.4]);
    }
  });

  it('paints every part the colour partsOf gives it', () => {
    const l = look({ skin: 7, hairColor: 11, eyes: 3, outfitColor: 9, legsColor: 4, feetColor: 17, head: 2, hair: 2, hat: 2, neck: 1, bag: 1 });
    const f = gpu.fixedOf(l, pieces, beards);
    const who = character.partsOf(l, pieces, beards);
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    for (const p of who.parts) {
      if (!p.tint) continue;
      const got = gpu.paintOf(gpu.ROLE[p.role], [1, 1, 1], f);
      const want = hex(p.tint);
      // Brows are a shade of the hair in both, by the same factor.
      for (let k = 0; k < 3; k++) expect(got[k], `${p.mesh} (${p.role})`).toBeCloseTo(want[k]!, 1);
    }
    for (const e of who.extras) {
      // This look wears a beanie, a scarf and a backpack: the three worn things that
      // take their colour from the person.
      const role = e.kind === 'scarf' ? gpu.ROLE.neck : e.kind === 'backpack' ? gpu.ROLE.bag : gpu.ROLE.hat;
      expect(['beanie', 'scarf', 'backpack']).toContain(e.kind);
      const got = gpu.paintOf(role, [1, 1, 1], f);
      const want = hex(e.tint);
      for (let k = 0; k < 3; k++) expect(got[k], e.kind).toBeCloseTo(want[k]!, 5);
    }
  });

  it('lights every body right: each normal is a real direction, at every level', () => {
    // The model's normals are interleaved (three bytes padded to four). Read as packed,
    // every vertex took another's bytes and the middle and far bodies were lit wrong.
    // A normal read from the right bytes is a unit vector, give or take the byte.
    for (const [i, g] of levels.entries()) {
      const nrm = g.attributes.normal!;
      let bad = 0;
      for (let v = 0; v < nrm.count; v++) {
        const len = Math.hypot(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
        if (len < 0.95 || len > 1.05) bad++;
      }
      expect(bad, `level ${i}: ${bad} of ${nrm.count} normals are not directions`).toBe(0);
    }
  });

  it("merges pieces into exactly what three's own merge makes", async () => {
    // mergePieces replaces mergeGeometries only for speed (417 ms of index pushes on
    // the phone); the result must be the same arrays, byte for byte.
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    // Plain copies of the model's own pieces (its normals are interleaved; the build
    // unpacks them before merging, and so does this).
    const sample = [...byName.values()].slice(0, 12).map((g) => {
      const c = new THREE.BufferGeometry();
      for (const n of ['position', 'normal', 'skinIndex', 'skinWeight']) {
        const a = g.attributes[n]!;
        c.setAttribute(n, new THREE.BufferAttribute(new (a.array.constructor as Float32ArrayConstructor)(
          Array.from({ length: a.count * a.itemSize }, (_, j) => a.getComponent(Math.floor(j / a.itemSize), j % a.itemSize) *
            (a.normalized ? (a.array instanceof Int8Array ? 127 : 255) : 1))), a.itemSize, a.normalized));
      }
      c.setIndex(g.index);
      return c;
    });
    const ours = gpu.mergePieces(sample);
    const three = mergeGeometries(sample, false)!;
    for (const n of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      expect(Array.from(ours.attributes[n]!.array), n).toEqual(Array.from(three.attributes[n]!.array));
      expect(ours.attributes[n]!.normalized).toBe(three.attributes[n]!.normalized);
    }
    expect(Array.from(ours.index!.array)).toEqual(Array.from(three.index!.array));
    expect(() => gpu.mergePieces([sample[0]!, new THREE.BoxGeometry()])).toThrow(/did not merge/);
  });

  it('the far level is the same choices merged harder, without the small things', () => {
    const f = gpu.fixedOf(look({ head: 4, hair: 7, top: 1, legs: 1, feet: 3, glasses: 1, bag: 1 }), pieces, beards);
    const near = kept(levels[0]!, f);
    const far = kept(levels[2]!, f);
    expect(far).toBeGreaterThan(100);
    expect(far).toBeLessThan(near * 0.4);
    const slots = new Set<number>();
    const meta = levels[2]!.attributes.aMeta!;
    for (let i = 0; i < meta.count; i++) slots.add(meta.getY(i));
    const { face, hair, top, legs, feet, hat } = gpu.SLOT_ID;
    expect([...slots].sort((a, b) => a - b)).toEqual([face, hair, top, legs, feet, hat]);
  });

  it('the tiny level is the same outfit, a small fraction of the far one', () => {
    // For people a few pixels tall: the whole city zoomed out. 55 vertices an outfit.
    const f = gpu.fixedOf(look({ head: 4, top: 1, legs: 1, feet: 3 }), pieces, beards);
    const far = kept(levels[2]!, f);
    const tiny = kept(levels[3]!, f);
    expect(tiny).toBeGreaterThan(20);
    expect(tiny).toBeLessThan(far * 0.3);
    expect(levels[3]!.attributes.position!.count).toBeLessThan(levels[2]!.attributes.position!.count * 0.25);
    const slots = new Set<number>();
    const meta = levels[3]!.attributes.aMeta!;
    for (let i = 0; i < meta.count; i++) slots.add(meta.getY(i));
    expect([...slots]).toEqual([gpu.SLOT_ID.outfit]);
  });
});

describe('the build', () => {
  it('comes in steps, a look at a time, and makes the same meshes as building at once', async () => {
    const steps = gpu.prepareSteps(await fresh(), manifest);
    let n = 0;
    let r = steps.next();
    while (!r.done) { n++; r = steps.next(); }
    const { LOOKS } = await import('../src/features/world/character');
    // At least one stop per look per level: the phone draws a frame at every stop.
    expect(n).toBeGreaterThanOrEqual(3 * LOOKS.length);
    const once = gpu.prepareCrowd(await fresh(), manifest);
    expect(r.value.levels.map((g) => [g.attributes.position!.count, g.index!.count]))
      .toEqual(once.levels.map((g) => [g.attributes.position!.count, g.index!.count]));
    expect(r.value.bake.data).toEqual(once.bake.data);
  });
});

describe('a frame', () => {
  const frame = (over: Partial<Gpu.CrowdFrame> = {}): Gpu.CrowdFrame =>
    ({ eyeX: 0, eyeZ: 0, flat: 0, time: 1, dt: 1 / 60, scale: 0.16, ...over });
  const line = (n: number): Gpu.CrowdPerson[] => Array.from({ length: n }, (_, i) => ({
    ref: `p${i}`, x: i * 0.2, z: 0, facing: 0, look: look({ top: i % 10 }),
    state: i % 2 === 0 ? 'walking' : 'idle', ghost: i % 4 === 0, seed: i,
  }));

  it('writes each person once, nearest first, into the right level', async () => {
    const crowd = gpu.makeGpuCrowd(await fresh(), manifest);
    const people = line(200);
    const drawn = crowd.update(people, people.length, frame());
    const [near, middle, far] = gpu.LEVELS;
    // 0.2 apart from the eye: 23 are inside near's 4.5 but near holds 12; everybody is
    // inside far's 40.
    expect(crowd.stats).toEqual({ near: near.max, middle: 71 - near.max + 0, far: 200 - 71 + 0, tiny: 0, dropped: 0 });
    expect(drawn).toBe(200);
    expect(crowd.stats.near + crowd.stats.middle + crowd.stats.far).toBe(200);
    expect(crowd.stats.middle).toBeLessThanOrEqual(middle.max);
    expect(crowd.stats.far).toBeLessThanOrEqual(far.max);
    // Each person's place and walk, in order: the third near body is people[2].
    const nearBuf = crowd.buffers[0]!.array as Float32Array;
    expect(nearBuf[2 * gpu.STRIDE]).toBe(Math.fround(people[2]!.x));
    expect(nearBuf[2 * gpu.STRIDE + 6], 'a walking person stands still').toBe(1);
    expect(nearBuf[3 * gpu.STRIDE + 6], 'an idle person walks').toBe(0);
    crowd.dispose();
  });

  it('draws the nearest when there are more than the levels hold, and says how many', async () => {
    const crowd = gpu.makeGpuCrowd(await fresh(), manifest);
    // Near full at 12, middle to its 14 units (71 people in), far to its 40 (201 in),
    // then tiny to its cap.
    const cap = 201 + gpu.LEVELS[3].max;
    const people = line(cap + 81);
    const drawn = crowd.update(people, people.length, frame());
    expect(crowd.stats).toEqual({ near: 12, middle: 59, far: 130, tiny: gpu.LEVELS[3].max, dropped: 81 });
    expect(drawn).toBe(cap);
    // The last one drawn is the last one of the tiny level: nobody further got a body.
    const tinyBuf = crowd.buffers[3]!.array as Float32Array;
    expect(tinyBuf[(gpu.LEVELS[3].max - 1) * gpu.STRIDE]).toBe(Math.fround(people[cap - 1]!.x));
    crowd.dispose();
  });

  it('sends the GPU only the people written, not the whole buffer', async () => {
    const crowd = gpu.makeGpuCrowd(await fresh(), manifest);
    const people = line(40);
    crowd.update(people, people.length, frame());
    const ranges = crowd.buffers.map((b) => b.updateRanges.map((r) => ({ ...r })));
    expect(ranges).toEqual([
      [{ start: 0, count: crowd.stats.near * gpu.STRIDE }],
      [{ start: 0, count: crowd.stats.middle * gpu.STRIDE }],
      [],
      [],
    ]);
    // A second frame replaces the range rather than piling another on.
    crowd.update(people, people.length, frame({ time: 2 }));
    expect(crowd.buffers[1]!.updateRanges).toHaveLength(1);
    crowd.dispose();
  });

  it('on the map, sizes everybody by how big a person is on screen', async () => {
    const crowd = gpu.makeGpuCrowd(await fresh(), manifest);
    const people = line(60);
    // Zoomed right in: a person is big, the twelve nearest the middle get the full body.
    crowd.update(people, people.length, frame({ flat: 2 }));
    expect(crowd.stats).toEqual({ near: 12, middle: 48, far: 0, tiny: 0, dropped: 0 });
    // Nearer the street: everybody is middle, however far from the camera they stand.
    crowd.update(people, people.length, frame({ flat: 12, eyeX: 1000 }));
    expect(crowd.stats).toEqual({ near: 0, middle: 60, far: 0, tiny: 0, dropped: 0 });
    // The street view proper, then the whole city.
    crowd.update(people, people.length, frame({ flat: 25 }));
    expect(crowd.stats).toEqual({ near: 0, middle: 0, far: 60, tiny: 0, dropped: 0 });
    crowd.update(people, people.length, frame({ flat: 150 }));
    expect(crowd.stats).toEqual({ near: 0, middle: 0, far: 0, tiny: 60, dropped: 0 });
    crowd.dispose();
  });

  it('the shader says what wears(), paintOf(), underHat() and skinFromBake() say', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'crowd-gpu.ts'), 'utf8');
    // wears(): a vertex is kept when its variant is the one its slot wants.
    expect(src).toContain('if (abs(aMeta.z - crowdWant) > 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vGhost = 0.0; return; }');
    // ...and each slot reads its own lane, in fixedOf's order.
    expect(src).toContain('float crowdWant = crowdSlot < 0.5 ? aSel1.x : crowdSlot < 1.5 ? aSel1.y : crowdSlot < 2.5 ? aSel1.z : crowdSlot < 3.5 ? aSel1.w');
    // paintOf(): worn things multiply the colour their vertices carry.
    expect(src).toContain('else if (crowdRole < 8.5) crowdPaint = color * crowdUnpack(aCol2.z);');
    expect(src).toContain('else if (crowdRole < 4.5) crowdPaint = aCol1.w < 0.0 ? color : crowdUnpack(aCol1.w);');
    // underHat(): onto the shape, above the rim, for the hair slot only.
    expect(src).toContain('if (crowdSlot > 0.5 && crowdSlot < 1.5) {');
    expect(src).toContain('if (crowdQ > 1.0) transformed = crowdRim + crowdD / crowdQ;');
    expect(src).toContain('mat4 crowdWorld = crowdPlace * crowdSkin;');
  });
});
