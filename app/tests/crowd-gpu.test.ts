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
 *     the near level, and at the middle level the same parts, merged smaller;
 *   - the far level is one outfit per head, and far fewer triangles than near; the
 *     tiny level the same outfit merged hardest, for people a few pixels tall;
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
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - the bake without each bone's inverse bind matrix -> "lands where three puts it" fails
 *   - wears() ignoring the bald flag                   -> "exactly the parts" fails
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
import { BALD, type Look } from '@clone/shared';
import type { Manifest } from '../src/features/world/character-mesh';
import type * as Gpu from '../src/features/world/crowd-gpu';

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
    expect(bake.rows).toBe(bake.walk.frames + bake.idle.frames);

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
    const bones = meshes[0]!.skeleton;
    const head = bones.bones.findIndex((b) => b.name === 'Head');
    levels = gpu.buildLevels({
      geometry: byName, colour, pieces, beards, head, headBind: bones.boneInverses[head]!.clone().invert(),
    });
  });

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
      look(), look({ head: 3, top: 5, legs: 7, feet: 9, beard: 2, accessory: 2 }),
      look({ head: BALD, figure: 1, top: 1, legs: 6, feet: 3, accessory: 4 }),
      look({ head: 8, top: 8, legs: 8, feet: 8, beard: 4, accessory: 1 }),
    ];
    for (const l of looks) {
      const f = gpu.fixedOf(l, pieces, beards);
      const who = character.partsOf(l, pieces, beards);
      const want = who.parts.reduce((n, p) => n + trisOf(p.mesh), 0);
      const extra = who.extra === 'none' ? 0 : 1;
      const near = kept(levels[0]!, f);
      // Every body triangle partsOf names, plus the accessory's own few.
      expect(near - want, `look ${JSON.stringify(l)}`).toBeGreaterThanOrEqual(0);
      expect(near - want).toBeLessThanOrEqual(extra ? 400 : 0);
      if (!extra) expect(near).toBe(want);
      const middle = kept(levels[1]!, f);
      expect(middle).toBeGreaterThan(0);
      expect(middle, 'the middle level is not smaller').toBeLessThan(near * 0.75);
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

  it('the far level is one merged outfit per head, much lighter than near', () => {
    const f = gpu.fixedOf(look({ head: 4, top: 1, legs: 2, feet: 3 }), pieces, beards);
    const near = kept(levels[0]!, f);
    const far = kept(levels[2]!, f);
    expect(far).toBeGreaterThan(100);
    expect(far).toBeLessThan(near * 0.4);
    const slots = new Set<number>();
    const meta = levels[2]!.attributes.aMeta!;
    for (let i = 0; i < meta.count; i++) slots.add(meta.getY(i));
    expect([...slots]).toEqual([gpu.SLOT_ID.outfit]);
  });

  it('the tiny level is the same outfit, a small fraction of the far one', () => {
    // For people a few pixels tall: the whole city zoomed out. 55 vertices an outfit.
    const f = gpu.fixedOf(look({ head: 4, top: 1, legs: 2, feet: 3 }), pieces, beards);
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

  it('the shader says what wears() and skinFromBake() say', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'crowd-gpu.ts'), 'utf8');
    expect(src).toContain('if (abs(aMeta.z - crowdWant) > 0.5 || crowdBald)');
    expect(src).toContain('bool crowdBald = aSel2.z > 0.5 && crowdRole > 0.5 && crowdRole < 1.5 && (crowdSlot < 0.5 || crowdSlot > 5.5);');
    expect(src).toContain('mat4 crowdWorld = crowdPlace * crowdSkin;');
  });
});
