/**
 * Dressing a person, checked against the model file itself.
 *
 * The point of this file is that `character.ts` names meshes as STRINGS -- `m_suit_b1`
 * -- and a string is exactly the kind of thing that goes quietly wrong when the build
 * script is changed. So the names are not compared against a list written here; they
 * are compared against the names inside `assets/characters/people.glb`, read out of the
 * binary. Rename a mesh in the build and this fails, which is the whole idea.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the `_2` from 'm_casual_2' in LOOKS -> "every mesh it can ask for is really
 *     in the model" fails: nothing named `m_casual_*` is in the file.
 *   - make Bald fall through to the normal branch -> "a bald head has no hair" fails.
 *   - take every slot from `look.top` -> "wears four sets at once" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BALD, HAIR_HEX, LOOK_SIZES, OUTFIT_HEX, SKIN_HEX, SLOT_PARTS, WARDROBE, WARDROBE_FIGURE,
  type Look,
} from '@clone/shared';
import { LOOKS, SLOTS, buildScale, clipFor, partsOf, type LookKey, type LookPieces } from '../src/features/world/character';

const ASSETS = join(import.meta.dirname, '..', 'assets', 'characters');

/**
 * Every mesh name in a .glb, without a renderer.
 *
 * A .glb is a 12-byte header then length-prefixed chunks, the first of which is the
 * glTF JSON. Reading that is a dozen lines and means this test opens the file that
 * actually ships rather than a description of it.
 */
function meshNames(file: string): Set<string> {
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(0), 'not a .glb').toBe(0x46546c67); // "glTF"
  const len = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16), 'first chunk is not JSON').toBe(0x4e4f534a); // "JSON"
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  return new Set((json.nodes ?? []).filter((n: { mesh?: number }) => n.mesh !== undefined)
    .map((n: { name?: string }) => n.name ?? ''));
}

const manifest = JSON.parse(readFileSync(join(ASSETS, 'people.json'), 'utf8')) as {
  bones: number; clips: string[]; dropped: string[];
  looks: Record<string, { tris: number } & LookPieces>;
};
const inFile = meshNames(join(ASSETS, 'people.glb'));
const pieces = (key: LookKey): LookPieces | undefined => manifest.looks[key];
const every = (v: { tris: number } & LookPieces) => SLOTS.flatMap((s) => v[s]);

const look = (over: Partial<Look> = {}): Look => ({
  figure: 0, skin: 3, body: 1, head: 0, hairColor: 0, beard: 0,
  top: 0, legs: 0, feet: 0, outfitColor: 0, accessory: 0, ...over,
});

/**
 * Every choice the builder can make, one slot at a time.
 *
 * ONE SLOT AT A TIME IS THE WHOLE COMBINATION. Which meshes a slot contributes depends
 * on that slot's index and nothing else -- that independence is the point of splitting
 * the wardrobe -- so sweeping each slot through its whole range covers all ten thousand
 * combinations without building them. The cross-product is checked separately, once,
 * by "wears four sets at once".
 */
const everyChoice = function* () {
  for (const part of SLOT_PARTS) {
    for (let i = 0; i < LOOK_SIZES[part]; i++) {
      for (let skin = 0; skin < LOOK_SIZES.skin; skin++) yield look({ [part]: i, skin });
    }
  }
};

describe('dressing a person', () => {
  it('every mesh it can ask for is really in the model', () => {
    let checked = 0;
    for (const l of everyChoice()) {
      for (const p of partsOf(l, pieces).parts) {
        expect(inFile.has(p.mesh), `head ${l.head} top ${l.top}: ${p.mesh} is not in people.glb`).toBe(true);
        checked++;
      }
    }
    // Guard the guard: if the loop above ever iterates nothing, it proves nothing.
    expect(checked, 'no parts were checked').toBeGreaterThan(1000);
  });

  it('knows about exactly the sets the build wrote, in the catalog\'s own order', () => {
    expect([...LOOKS].sort()).toEqual(Object.keys(manifest.looks).sort());
    // The catalog names the sets and this file names their meshes, and the two are
    // tied by POSITION -- index 7 is "Punk" in the shop and `m_punk` in the model. A
    // set inserted in one list and not the other silently dresses people in somebody
    // else's clothes, so the length and the figure of every entry are checked.
    expect(LOOKS).toHaveLength(WARDROBE.length);
    LOOKS.forEach((key, i) => {
      const figure = key.startsWith('w_') ? 1 : 0;
      expect(figure, `${WARDROBE[i]} is ${key}, which is the other figure`).toBe(WARDROBE_FIGURE[i]);
    });
  });

  it('gives every set a torso, exactly one thing to colour, and a face', () => {
    // THE BUG THIS TEST EXISTS FOR (2026-09-22): the build used to treat the second
    // mesh in a slot as an alternative and drop it. The body slot is an arms mesh and
    // a torso mesh, so everybody walked around with no chest and two floating sleeves.
    for (const [key, v] of Object.entries(manifest.looks)) {
      const tops = v.top.filter((p) => p.role === 'top');
      expect(tops, `${key} has no top, so it has no torso`).toHaveLength(1);
      expect(v.head.some((p) => p.role === 'skin'), `${key} has no face`).toBe(true);
      for (const slot of SLOTS) {
        expect(v[slot].length, `${key} has nothing for its ${slot}`).toBeGreaterThan(0);
      }
      for (const p of every(v)) {
        expect(['skin', 'hair', 'top', 'plain']).toContain(p.role);
        expect(inFile.has(p.mesh), `${p.mesh} is in the manifest but not the model`).toBe(true);
      }
    }
  });

  it('gives every head hair to colour, bar the one wearing a hard hat', () => {
    // The workwear head is modelled with a helmet on and nothing the build can call
    // hair, so hair colour does nothing to it. That is the art, not a bug -- but it
    // is named here so that a head QUIETLY losing its hair is still caught.
    const bare = LOOKS.filter((key) => !manifest.looks[key]!.head.some((p) => p.role === 'hair'));
    expect(bare, 'a head lost its hair').toEqual(['m_worker']);
    expect(BALD, 'Bald is not the last head').toBe(LOOKS.length);
  });

  it('ships nobody carrying a weapon', () => {
    // THE ONE THIS EXISTS FOR. `man/Suit.gltf` contains a node called "Pistol": a
    // rigged handgun, weighted into the right hand. The build used to sort meshes by
    // how high off the ground they sat, had no idea what it was, and filed it under
    // "body" -- so every man in a suit walked around the town holding a gun. In a
    // dating app. It was found by reading the asset, not by using the app.
    const banned = /pistol|gun|weapon|rifle|knife|sword|blade|axe|holster/i;
    for (const name of inFile) {
      expect(banned.test(name), `${name} is in the shipped model`).toBe(false);
    }
    for (const [key, v] of Object.entries(manifest.looks)) {
      for (const p of every(v)) {
        expect(banned.test(p.mesh), `${key} is wearing ${p.mesh}`).toBe(false);
        expect(banned.test(p.from ?? ''), `${key} is wearing ${p.from}`).toBe(false);
      }
    }
    // ...and the build says out loud that it threw it away, so this cannot pass by
    // the art quietly changing underneath.
    expect(manifest.dropped.join(' '), 'the build no longer reports dropping the pistol')
      .toMatch(/pistol/i);
  });

  it('wears more than a handful of pieces, arms and all', () => {
    const c = partsOf(look(), pieces);
    expect(c.parts.length, 'a dressed person is not four meshes').toBeGreaterThan(5);
  });

  it('wears four sets at once, one per slot', () => {
    // THE WHOLE FEATURE. The pack models every set in four pieces on one shared
    // skeleton, and until this landed a person could only wear a set whole: picking
    // "Suit" bought the suit's shoes whether or not they wanted them.
    const c = partsOf(look({ head: 1, top: 8, legs: 7, feet: 3 }), pieces);
    expect(c.wearing).toEqual({ head: 'w_casual', top: 'm_suit', legs: 'm_punk', feet: 'w_worker' });
    const from = (key: string) => c.parts.filter((p) => p.mesh.startsWith(`${key}_`)).length;
    for (const key of ['w_casual', 'm_suit', 'm_punk', 'w_worker']) {
      expect(from(key), `nothing came from ${key}`).toBeGreaterThan(0);
    }
    // ...and nothing came from anywhere else.
    expect(c.parts.every((p) => ['w_casual', 'm_suit', 'm_punk', 'w_worker'].some((k) => p.mesh.startsWith(`${k}_`))))
      .toBe(true);
    // Each slot contributes exactly the pieces the manifest lists for it.
    expect(c.parts.filter((p) => p.mesh.startsWith('m_suit_')).length)
      .toBe(manifest.looks['m_suit']!.top.length);
  });

  it('wears facial hair as one more mesh, in their hair colour', () => {
    const beards = (manifest as unknown as { beards: string[] }).beards;
    expect(beards.length, 'the build wrote no beards').toBeGreaterThan(2);
    const clean = partsOf(look({ beard: 0 }), pieces, beards);
    for (let i = 1; i <= beards.length; i++) {
      const worn = partsOf(look({ beard: i, hairColor: 6 }), pieces, beards);
      const extra = worn.parts.filter((p) => !clean.parts.some((c) => c.mesh === p.mesh));
      expect(extra.map((p) => p.mesh), `beard ${i} put on the wrong mesh`).toEqual([beards[i - 1]]);
      expect(extra[0]!.tint, 'facial hair is not in their hair colour').toBe(HAIR_HEX[6]);
      expect(inFile.has(extra[0]!.mesh), `${extra[0]!.mesh} is not in people.glb`).toBe(true);
    }
    // ...and with none, nothing is added at all.
    expect(clean.parts.some((p) => beards.includes(p.mesh))).toBe(false);
  });

  it('a bald head has no hair on it, and still has eyes', () => {
    // THE BUG THIS EXISTS FOR: bald used to drop everything on the head that was not
    // skin. That is not just the hair -- it is the eyes and the eyebrows, which are
    // their own little meshes -- so picking Bald gave you a smooth skull with a blank
    // face. Invisible at town size, which is why it shipped; unmissable in the
    // builder, where the head fills a third of the screen.
    const bald = partsOf(look({ head: BALD }), pieces);
    const onHead = bald.parts.filter((p) => /_h\d+$/.test(p.mesh));
    expect(bald.parts.some((p) => p.role === 'hair')).toBe(false);
    expect(onHead.some((p) => p.role === 'skin'), 'a bald person still has a face').toBe(true);
    expect(onHead.filter((p) => p.role === 'plain').length, 'a bald person has no eyes or brows')
      .toBeGreaterThanOrEqual(2);
    expect(bald.parts.some((p) => p.role === 'top'), 'and is still dressed').toBe(true);
    // Everything the head had, bar the hair itself.
    const head = manifest.looks[LOOKS[0]!]!.head;
    expect(onHead).toHaveLength(head.filter((x) => x.role !== 'hair').length);
    // ...and a head that is not bald does have some.
    expect(partsOf(look({ head: 0 }), pieces).parts.some((p) => p.role === 'hair')).toBe(true);
  });

  it('paints skin, hair and the top from the look, and leaves the rest alone', () => {
    const c = partsOf(look({ skin: 5, hairColor: 6, outfitColor: 2, top: 8, head: 1 }), pieces);
    const of = (role: string) => c.parts.filter((p) => p.role === role);
    expect(of('skin').every((p) => p.tint === SKIN_HEX[5])).toBe(true);
    expect(of('hair').every((p) => p.tint === HAIR_HEX[6])).toBe(true);
    expect(of('top')).toHaveLength(1);
    expect(of('top')[0]!.tint).toBe(OUTFIT_HEX[2]);
    // Trousers and shoes keep the artist's colours; one flat colour head to toe is
    // what made the old capsules look like skittles.
    expect(of('plain').length, 'a person is more than a top and a face').toBeGreaterThan(2);
    expect(of('plain').every((p) => p.tint === null)).toBe(true);
  });

  it('is the same person every time, and a different one when one slot changes', () => {
    const a = partsOf(look({ top: 2, head: 4 }), pieces);
    expect(partsOf(look({ top: 2, head: 4 }), pieces)).toEqual(a);
    expect(partsOf(look({ top: 3, head: 4 }), pieces)).not.toEqual(a);
    expect(partsOf(look({ top: 2, head: 4, feet: 5 }), pieces)).not.toEqual(a);
  });

  it('scales by build without changing anybody\'s height', () => {
    for (let b = 0; b < LOOK_SIZES.body; b++) {
      const [x, y, z] = buildScale(look({ body: b }));
      expect(y, 'height must not vary, or people read as being further away').toBe(1);
      expect(x).toBeGreaterThan(0.5);
      expect(z).toBeGreaterThan(0.5);
    }
    expect(buildScale(look({ body: 0 }))[0]).toBeLessThan(buildScale(look({ body: 2 }))[0]);
  });

  it('walks when moving and idles when not, and the model has both clips', () => {
    expect(clipFor(true)).toBe('walk');
    expect(clipFor(false)).toBe('idle');
    for (const c of [clipFor(true), clipFor(false)]) expect(manifest.clips).toContain(c);
  });

  it('draws a person in a few thousand triangles, not a few tens of thousands', () => {
    // 64 people on screen is the canvas's cap. The whole map is 32k triangles, so a
    // crowd an order of magnitude past that is the thing to notice before a phone does.
    for (const [key, v] of Object.entries(manifest.looks)) {
      expect(v.tris, `${key} is heavy`).toBeLessThan(8000);
    }
    // The pack ships 62 bones and 40 of them are finger and toe joints, on people
    // drawn twenty pixels tall. The build welds those to the wrists and feet, because
    // every bone is a matrix recomputed for every person every frame -- measured at
    // 1.7 ms a person on a Pixel 6a, which is the whole frame budget at twelve people.
    expect(manifest.bones, 'the finger bones are back').toBeLessThanOrEqual(24);
    expect(manifest.bones, 'something has eaten the skeleton').toBeGreaterThanOrEqual(20);
  });
});
