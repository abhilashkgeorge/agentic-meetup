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
 *     in the model" fails (the Tee has no face, top, trousers or shoes) and so does
 *     "knows about exactly the sets the build wrote".
 *   - take every slot from `look.top` -> "wears five sets at once" fails.
 *   - drop the scalp in `partsOf` -> "a shaved head" fails: the workwear face has no
 *     back to its head.
 *   - drop `fit` in `partsOf` -> "grows a hairstyle only where the face needs it" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EYE_HEX, EXTRA_PARTS, HAIR_HEX, HARD_HAT, HEIGHT_SCALE, LOOK_SIZES, OUTFIT_HEX, SHAVED, SKIN_HEX, SLOT_PARTS, STARTER,
  WARDROBE, WARDROBE_FIGURE, type Look,
} from '@clone/shared';
import {
  CLASS, FITTED_HAIR, FULL_SKULL, HAIR_FIT, HAT_INSIDE, HEAD_BIND, LOOKS, SCALP, SLOTS, buildScale, clipFor, partsOf,
  roleOf, underHat, type LookKey, type LookPieces,
} from '../src/features/world/character';

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

const look = (over: Partial<Look> = {}): Look => ({ ...STARTER, outfitColor: 0, ...over });
const beards = (manifest as unknown as { beards: string[] }).beards;

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
  for (const part of [...SLOT_PARTS, 'hair', 'beard', ...EXTRA_PARTS] as const) {
    for (let i = 0; i < LOOK_SIZES[part]; i++) {
      // Every face with it, because what goes on a head depends on the face.
      for (let head = 0; head < LOOK_SIZES.head; head++) yield look({ [part]: i, ...(part === 'head' ? {} : { head }) });
    }
  }
};

describe('dressing a person', () => {
  it('every mesh it can ask for is really in the model', () => {
    let checked = 0;
    for (const l of everyChoice()) {
      const { parts } = partsOf(l, pieces, beards);
      for (const p of parts) {
        expect(inFile.has(p.mesh), `head ${l.head} top ${l.top}: ${p.mesh} is not in people.glb`).toBe(true);
        checked++;
      }
      // A set the model does not have gives no pieces at all, which the names alone
      // would never notice: everybody has a face, a top, trousers and shoes.
      for (const worn of ['head', 'top', 'legs', 'feet'] as const) {
        expect(parts.some((p) => p.worn === worn), `${JSON.stringify(l)} has no ${worn}`).toBe(true);
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

  it('knows what every classed piece is, and every name is a real mesh in the right slot', () => {
    const slotOf = new Map<string, string>();
    for (const [key, v] of Object.entries(manifest.looks)) for (const slot of SLOTS) for (const p of v[slot]) slotOf.set(p.mesh, `${key}:${slot}`);
    for (const [mesh, what] of Object.entries(CLASS)) {
      expect(inFile.has(mesh), `${mesh} is not in people.glb`).toBe(true);
      const slot = slotOf.get(mesh)?.split(':')[1];
      const want = what === 'legs' ? 'legs' : what === 'feet' ? 'feet' : 'head';
      expect(slot, `${mesh} (${what}) is on the ${slot}`).toBe(want);
    }
    // Every set: a face with eyes, hair, one fabric for its trousers and one for its
    // shoes -- or picking a colour for them would do nothing on that set.
    for (const key of LOOKS) {
      const v = manifest.looks[key]!;
      const roles = (slot: 'head' | 'legs' | 'feet') => v[slot].map((p) => roleOf(p));
      expect(roles('head').filter((r) => r === 'eyes'), `${key} has no eyes to colour`).toHaveLength(1);
      expect(roles('head').includes('hair'), `${key} has no hair`).toBe(true);
      expect(roles('legs').filter((r) => r === 'legs'), `${key}'s trousers have no fabric`).toHaveLength(1);
      expect(roles('feet').filter((r) => r === 'feet'), `${key}'s shoes have no fabric`).toHaveLength(1);
    }
    // The two hard hats are the only hats in the pack, on the two workwear heads.
    const hats = Object.entries(CLASS).filter(([, w]) => w === 'hat').map(([m]) => m).sort();
    expect(hats).toEqual(['m_worker_h3', 'w_worker_h4']);
    expect(inFile.has(SCALP), 'the scalp is not in the model').toBe(true);
    expect(CLASS[SCALP], 'the scalp is not the crew cut').toBe('hair');
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

  it('wears five sets at once, one per choice', () => {
    // THE WHOLE FEATURE. The pack models every set in four pieces on one shared
    // skeleton, and the head's face and hair are separate meshes: a person wears the
    // casual woman's face, the punk's mohawk, the suit jacket, the punk's jeans and
    // the overalls' shoes, and nothing else of any of them.
    const c = partsOf(look({ head: 1, hair: 7, top: 8, legs: 7, feet: 3 }), pieces, beards);
    expect(c.wearing).toEqual({ head: 'w_casual', hair: 'm_punk', top: 'm_suit', legs: 'm_punk', feet: 'w_worker' });
    const of = (worn: string) => c.parts.filter((p) => p.worn === worn).map((p) => p.mesh);
    expect(of('head').every((m) => m.startsWith('w_casual_'))).toBe(true);
    expect(of('hair').every((m) => m.startsWith('m_punk_'))).toBe(true);
    expect(of('top')).toEqual(manifest.looks['m_suit']!.top.map((p) => p.mesh));
    expect(of('legs')).toEqual(manifest.looks['m_punk']!.legs.map((p) => p.mesh));
    expect(of('feet')).toEqual(manifest.looks['w_worker']!.feet.map((p) => p.mesh));
    // The face is its set's head without the hair; the hair is the other set's hair.
    expect(of('head').length + manifest.looks['w_casual']!.head.filter((p) => roleOf(p) === 'hair').length)
      .toBe(manifest.looks['w_casual']!.head.length);
    expect(of('hair')).toEqual(manifest.looks['m_punk']!.head.filter((p) => roleOf(p) === 'hair').map((p) => p.mesh));
  });

  it('wears facial hair as one more mesh, in their hair colour', () => {
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

  it('a shaved head has no hair on it, still has eyes, and always has a back', () => {
    // Bald once dropped everything on the head that was not skin -- the eyes and brows
    // too -- and gave a smooth skull with a blank face.
    for (let head = 0; head < LOOK_SIZES.head; head++) {
      const c = partsOf(look({ head, hair: SHAVED }), pieces, beards);
      expect(c.parts.some((p) => p.role === 'hair'), `face ${head} kept hair`).toBe(false);
      expect(c.parts.filter((p) => p.role === 'eyes'), `face ${head} has no eyes`).toHaveLength(1);
      // The faces that end at the hairline -- whose hair was the back of their head --
      // get the pack's own scalp, in their skin; the whole skulls need nothing.
      const scalp = c.parts.filter((p) => p.mesh === SCALP);
      if (FULL_SKULL.has(head)) expect(scalp, `face ${head} has a second skull`).toHaveLength(0);
      else {
        expect(scalp, `face ${head} has no back to its head`).toHaveLength(1);
        expect(scalp[0]).toMatchObject({ role: 'skin', worn: 'hair', tint: SKIN_HEX[STARTER.skin] });
      }
    }
    // ...and hair on, no scalp at all: the hair is the back of the head.
    expect(partsOf(look({ head: 4, hair: 0 }), pieces).parts.some((p) => p.mesh === SCALP)).toBe(false);
  });

  it('grows a hairstyle only where the face needs it', () => {
    for (let head = 0; head < LOOK_SIZES.head; head++) {
      for (let hair = 0; hair < LOOK_SIZES.hair; hair++) {
        const c = partsOf(look({ head, hair }), pieces);
        const fits = new Set(c.parts.filter((p) => p.worn === 'hair' && p.role === 'hair').map((p) => p.fit));
        const want = HAIR_FIT[hair]?.[head];
        if (hair === SHAVED) { expect(fits.size).toBe(0); continue; }
        expect([...fits], `hair ${hair} on face ${head}`).toEqual([want]);
        if (want !== undefined) expect(FITTED_HAIR.some((f) => f.hair === hair && f.fit === want)).toBe(true);
      }
    }
    // Every fit is a few percent, never a shrink: the hair is made to cover more.
    for (const { fit } of FITTED_HAIR) { expect(fit).toBeGreaterThan(1); expect(fit).toBeLessThan(1.15); }
    expect(new Set(FITTED_HAIR.map((f) => `${f.hair}:${f.fit}`)).size).toBe(FITTED_HAIR.length);
  });

  it('pulls hair in under a hat, above its rim and nowhere else', () => {
    for (const [hat, inside] of Object.entries(HAT_INSIDE)) {
      const rimY = HEAD_BIND[1] + inside.rim;
      const midZ = HEAD_BIND[2] + 0.014;
      // Far out above the rim: onto the shape.
      const up = underHat(0, rimY + 0.3, midZ, Number(hat))!;
      expect(up, `hat ${hat} left a crest standing`).not.toBeNull();
      expect(up[1] - rimY).toBeCloseTo(inside.radii[1], 6);
      const side = underHat(HEAD_BIND[0] + 0.3, rimY + 0.01, midZ, Number(hat))!;
      expect(side[0] - HEAD_BIND[0]).toBeLessThanOrEqual(inside.radii[0] + 1e-9);
      // Inside it, and below the rim: where it was.
      expect(underHat(HEAD_BIND[0], rimY + 0.01, midZ, Number(hat))).toBeNull();
      expect(underHat(HEAD_BIND[0] + 0.3, rimY - 0.001, midZ, Number(hat))).toBeNull();
    }
    // No hat: nothing moves. Every hat the catalog has is covered.
    expect(underHat(0, 3, 0, 0)).toBeNull();
    for (let hat = 1; hat < LOOK_SIZES.hat; hat++) expect(HAT_INSIDE[hat], `hat ${hat} has no inside`).toBeDefined();
    // The hard hat is the pack's own mesh, off the workwear head of the face's figure.
    const hard = partsOf(look({ head: 1, hat: HARD_HAT }), pieces).parts.filter((p) => p.worn === 'hat');
    expect(hard.map((p) => p.mesh)).toEqual(['w_worker_h4']);
    expect(partsOf(look({ head: 0, hat: HARD_HAT }), pieces).parts.filter((p) => p.worn === 'hat').map((p) => p.mesh))
      .toEqual(['m_worker_h3']);
  });

  it('paints everything a person chose, and leaves the rest as the artist made it', () => {
    const c = partsOf(look({ skin: 5, hairColor: 6, eyes: 4, outfitColor: 2, top: 8, head: 1, hair: 1 }), pieces);
    const of = (role: string) => c.parts.filter((p) => p.role === role);
    expect(of('skin').every((p) => p.tint === SKIN_HEX[5])).toBe(true);
    expect(of('hair').every((p) => p.tint === HAIR_HEX[6])).toBe(true);
    expect(of('eyes').every((p) => p.tint === EYE_HEX[4])).toBe(true);
    // Brows follow the hair, a shade darker.
    for (const b of of('brows')) {
      const [h, t] = [HAIR_HEX[6]!, b.tint!].map((x) => parseInt(x.slice(1), 16));
      expect(t! >> 16).toBeLessThan(h! >> 16);
    }
    expect(of('top')).toHaveLength(1);
    expect(of('top')[0]!.tint).toBe(OUTFIT_HEX[2]);
    // Trousers and shoes are "as made" unless a colour is chosen for each...
    expect(of('legs').every((p) => p.tint === null)).toBe(true);
    expect(of('feet').every((p) => p.tint === null)).toBe(true);
    const coloured = partsOf(look({ legsColor: 3, feetColor: 13 }), pieces);
    expect(coloured.parts.filter((p) => p.role === 'legs').map((p) => p.tint)).toEqual([OUTFIT_HEX[2]]);
    expect(coloured.parts.filter((p) => p.role === 'feet').map((p) => p.tint)).toEqual([OUTFIT_HEX[12]]);
    // ...and soles, stripes and belts are always the artist's.
    expect(of('plain').length, 'a person is more than a top and a face').toBeGreaterThan(2);
    expect(of('plain').every((p) => p.tint === null)).toBe(true);
  });

  it('wears what goes on top in its own place, several at once', () => {
    const all = partsOf(look({ hat: 1, glasses: 2, earrings: 1, neck: 3, bag: 1 }), pieces);
    expect(all.extras.map((e) => e.kind).sort()).toEqual(['backpack', 'bowtie', 'cap', 'studs', 'sunglasses']);
    expect(partsOf(look(), pieces).extras).toEqual([]);
    // Every choice of every place is something, bar "None" -- and the hard hat, which
    // is a mesh of the pack's, not a shape.
    for (const part of EXTRA_PARTS) {
      for (let i = 1; i < LOOK_SIZES[part]; i++) {
        const e = partsOf(look({ [part]: i }), pieces).extras;
        if (part === 'hat' && i === HARD_HAT) { expect(e).toEqual([]); continue; }
        expect(e, `${part} ${i}`).toHaveLength(1);
        expect(e[0]!.tint).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('is the same person every time, and a different one when one slot changes', () => {
    const a = partsOf(look({ top: 2, head: 4 }), pieces);
    expect(partsOf(look({ top: 2, head: 4 }), pieces)).toEqual(a);
    expect(partsOf(look({ top: 3, head: 4 }), pieces)).not.toEqual(a);
    expect(partsOf(look({ top: 2, head: 4, feet: 5 }), pieces)).not.toEqual(a);
    expect(partsOf(look({ top: 2, head: 4, hair: 6 }), pieces)).not.toEqual(a);
  });

  it('scales by build and by height, each on its own', () => {
    for (let b = 0; b < LOOK_SIZES.body; b++) {
      const [x, y, z] = buildScale(look({ body: b }));
      expect(y, 'build changed their height').toBe(1);
      expect(x).toBeGreaterThan(0.5);
      expect(z).toBeGreaterThan(0.5);
    }
    expect(buildScale(look({ body: 0 }))[0]).toBeLessThan(buildScale(look({ body: 2 }))[0]);
    // A few percent either way, no more: people who differ more at this scale read as
    // standing at different distances.
    for (let h = 0; h < LOOK_SIZES.height; h++) {
      const [x, y] = buildScale(look({ height: h }));
      expect(y).toBe(HEIGHT_SCALE[h]);
      expect(Math.abs(y - 1)).toBeLessThan(0.061);
      expect(x, 'height changed their build').toBe(1);
    }
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
