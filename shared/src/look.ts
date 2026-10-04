/**
 * The character: a couple of dozen small numbers that say how a person is drawn.
 *
 * Not a photo and not a likeness -- a Mii, chosen for exactly one purpose, being
 * seen: in the town as their agent, and on a card or a chat header until photos are
 * allowed. Because it is chosen to be seen it is the one thing about a stranger the
 * square may show that is the same to every viewer; refs stay per-viewer, and a look
 * carries no id, name, age, tag or coordinate.
 *
 * This file is the whole catalog: what the parts are, what each is called, what it
 * costs, and the colours the renderers use. The server validates against it and the
 * app draws from it, so a hat added here is a hat everywhere. Indices, not names, in
 * storage: the database keeps one jsonb blob per person and never needs to know that
 * head 5 is the beach one. Every list below only ever GROWS AT THE END, so an index
 * saved yesterday means the same thing today.
 *
 * WHAT CHANGED ON 2026-09-29 (the founder: "why do we have an option called colour,
 * how does the user know what it changes ... give much more options to customise").
 * The art had more in it than the builder offered:
 *   - HAIR IS ITS OWN CHOICE. Every head in the pack is a face and a separate hair
 *     mesh, so any hairstyle goes on any face -- ten faces and ten hairstyles, and
 *     "Bald" stops being a head and becomes a hairstyle, Shaved.
 *   - TROUSERS AND SHOES TAKE A COLOUR, each on its own, as well as the top. Each has
 *     one main fabric piece (character.ts CLOTH), so soles and stripes keep theirs.
 *     "As made" is the first choice, and is what everybody had before.
 *   - EYE COLOUR, tinting the eyes the heads always had.
 *   - HEIGHT, five steps a few percent apart.
 *   - THE ONE "EXTRA" BECOMES FIVE PLACES: something on your head, on your eyes, in
 *     your ears, round your neck and on your back -- worn together, not one at a
 *     time. The hard hat the two workwear heads wore is a hat now, for anybody.
 *   - MORE SKIN TONES, HAIR COLOURS AND CLOTH COLOURS.
 * A look saved before this reads exactly as it did (`clampLook`), and anything bought
 * keeps its meaning (`currentItem`).
 */
import { z } from 'zod';

/**
 * The ten sets every slot can be picked from, in catalog order.
 *
 * The order is the price ladder and nothing else: the free ones first, and both
 * figures among them, because free must dress a woman as completely as a man.
 */
export const WARDROBE = [
  'Tee', 'Casual', 'Hoodie', 'Overalls', 'Workwear', 'Beach', 'Formal', 'Punk', 'Suit', 'Trouser suit',
] as const;

/** Which figure each set was modelled on: 0 a man, 1 a woman. */
export const WARDROBE_FIGURE: readonly number[] = [0, 1, 0, 1, 0, 0, 1, 0, 0, 1];

/**
 * Hairstyles: one per set, in WARDROBE order, then Shaved. Named for what they look
 * like, because nobody knows what "Overalls hair" is.
 */
export const HAIRSTYLES = [
  'Swept back', 'Long', 'Tousled', 'Bob', 'Crew cut', 'Spiky', 'Wavy', 'Mohawk', 'Side part', 'Long (straight)', 'Shaved',
] as const;
/** The hairstyle that is no hair at all. */
export const SHAVED = WARDROBE.length;
/**
 * The trouser sets that leave the ankle bare (shorts, a skirt): the only ones where
 * which figure's shoes go under them shows, because the ankle is the join.
 */
export const BARE_ANKLES: ReadonlySet<number> = new Set([2, 5, 6]);

/**
 * Hats, in the order the builder shows them. 4 is the pack's own hard hat. Every hat
 * covers the crown, and any hairstyle goes under any of them: the renderers draw the
 * hair pulled in under the hat (character.ts HAT_INSIDE).
 */
export const HATS = ['None', 'Cap', 'Beanie', 'Bucket hat', 'Hard hat', 'Beret'] as const;
export const HARD_HAT = 4;

export const LOOK_SIZES = {
  figure: 2, skin: 12, body: 3, height: 5,
  head: WARDROBE.length, hair: HAIRSTYLES.length, hairColor: 14, eyes: 6, beard: 5,
  top: WARDROBE.length, outfitColor: 18,
  legs: WARDROBE.length, legsColor: 19,
  feet: WARDROBE.length, feetColor: 19,
  hat: HATS.length, glasses: 4, earrings: 3, neck: 4, bag: 3,
} as const;
export type LookPart = keyof typeof LOOK_SIZES;
export const LOOK_PARTS = Object.keys(LOOK_SIZES) as readonly LookPart[];

/** The four parts that come off the wardrobe, so a caller can treat them alike. */
export const SLOT_PARTS = ['head', 'top', 'legs', 'feet'] as const;
export type SlotPart = (typeof SLOT_PARTS)[number];
export const isSlot = (part: LookPart): part is SlotPart => (SLOT_PARTS as readonly string[]).includes(part);

/** The five things worn on top of the clothes. */
export const EXTRA_PARTS = ['hat', 'glasses', 'earrings', 'neck', 'bag'] as const;
export type ExtraPart = (typeof EXTRA_PARTS)[number];

const idx = (n: number) => z.number().int().min(0).max(n - 1);

export const Look = z.object({
  figure: idx(LOOK_SIZES.figure),
  skin: idx(LOOK_SIZES.skin),
  body: idx(LOOK_SIZES.body),
  height: idx(LOOK_SIZES.height),
  head: idx(LOOK_SIZES.head),
  hair: idx(LOOK_SIZES.hair),
  hairColor: idx(LOOK_SIZES.hairColor),
  eyes: idx(LOOK_SIZES.eyes),
  beard: idx(LOOK_SIZES.beard),
  top: idx(LOOK_SIZES.top),
  outfitColor: idx(LOOK_SIZES.outfitColor),
  legs: idx(LOOK_SIZES.legs),
  legsColor: idx(LOOK_SIZES.legsColor),
  feet: idx(LOOK_SIZES.feet),
  feetColor: idx(LOOK_SIZES.feetColor),
  hat: idx(LOOK_SIZES.hat),
  glasses: idx(LOOK_SIZES.glasses),
  earrings: idx(LOOK_SIZES.earrings),
  neck: idx(LOOK_SIZES.neck),
  bag: idx(LOOK_SIZES.bag),
}).strict();
export type Look = z.infer<typeof Look>;

/** Cloth colours, shared by the top, the trousers and the shoes. */
const CLOTH_NAMES = [
  'Sand', 'Slate', 'Navy', 'Forest', 'Plum', 'Rust', 'Teal', 'Mustard', 'Coral', 'Lilac', 'Mint', 'Gold',
  'Black', 'White', 'Charcoal', 'Red', 'Sky', 'Denim',
] as const;

/** What each index is called. */
export const LOOK_LABELS: Record<LookPart, readonly string[]> = {
  figure: ['Man', 'Woman'],
  skin: ['Porcelain', 'Fair', 'Light', 'Olive', 'Tan', 'Brown', 'Deep', 'Ebony', 'Ivory', 'Beige', 'Caramel', 'Mahogany'],
  body: ['Slim', 'Average', 'Broad'],
  height: ['Short', 'Shorter', 'Average', 'Taller', 'Tall'],
  head: WARDROBE,
  hair: HAIRSTYLES,
  hairColor: ['Black', 'Dark brown', 'Brown', 'Auburn', 'Grey', 'Blonde', 'Red', 'Blue', 'Platinum', 'Honey', 'Pink', 'Green', 'Purple', 'White'],
  eyes: ['Dark', 'Brown', 'Hazel', 'Green', 'Blue', 'Grey'],
  beard: ['Clean', 'Jawline', 'Moustache', 'Goatee', 'Full beard'],
  top: WARDROBE,
  outfitColor: CLOTH_NAMES,
  legs: WARDROBE,
  legsColor: ['As made', ...CLOTH_NAMES],
  feet: WARDROBE,
  feetColor: ['As made', ...CLOTH_NAMES],
  hat: HATS,
  glasses: ['None', 'Round glasses', 'Sunglasses', 'Square glasses'],
  earrings: ['None', 'Studs', 'Hoops'],
  neck: ['None', 'Scarf', 'Necklace', 'Bow tie'],
  bag: ['None', 'Backpack', 'Shoulder bag'],
};

/** Presentation colours, shared by the 3D town and the 2D avatar so they agree. */
export const SKIN_HEX = [
  '#f6e2d0', '#f1cfb3', '#e5b48f', '#caa073', '#b07f55', '#8d5a3b', '#66402a', '#3e2a1e',
  '#fbeee2', '#eac5a3', '#a8714a', '#54321f',
] as const;
export const HAIR_HEX = [
  '#1d1a1a', '#3b2a20', '#6b4a32', '#8f4a2a', '#9a9a9a', '#d9b56a', '#b83a2a', '#3b5bdb',
  '#e8dfcb', '#b8894a', '#d97aa0', '#3f8f5a', '#7a4fb0', '#f0efea',
] as const;
export const EYE_HEX = ['#31251c', '#5a3a22', '#7a5a2a', '#3f6b3a', '#3d6fa8', '#6c7680'] as const;
export const OUTFIT_HEX = [
  '#d9c9a8', '#5d6470', '#2e3f6e', '#2f5d3f', '#6b3d6b', '#a0522d', '#2a7f7f', '#c9a227', '#e0705f', '#a58ad1', '#8fd1b3', '#d4a017',
  '#232323', '#f2f2f2', '#3a3a3a', '#b8322f', '#7fb2e0', '#3f5e8c',
] as const;

/**
 * The order the builder shows skin tones and hair colours in: lightest to darkest,
 * whatever order they were added to the catalog in.
 */
export const SKIN_ORDER: readonly number[] = [8, 0, 1, 9, 2, 3, 4, 10, 5, 6, 11, 7];
export const HAIR_ORDER: readonly number[] = [13, 8, 5, 9, 4, 2, 3, 6, 1, 0, 10, 12, 7, 11];

/**
 * How tall, as a factor on the model's height. A few percent apart: at town scale
 * people who differ more read as standing at different distances.
 */
export const HEIGHT_SCALE: readonly number[] = [0.94, 0.97, 1, 1.03, 1.06];

/**
 * Cost per index. Zero is the starter set: every part has at least one, so a person
 * who has earned nothing still has a whole character -- and the free sets cover both
 * figures, so "free" is not a men's wardrobe.
 *
 * Faces are all free now; what made the dearer heads dear was their hair, so the
 * price moved to the hairstyle (and anything bought as a head is honoured as that
 * hairstyle, `currentItem`).
 */
const COSTS: Record<LookPart, readonly number[]> = {
  figure: [0, 0],
  skin: Array(12).fill(0),
  body: [0, 0, 0],
  height: [0, 0, 0, 0, 0],
  head: Array(10).fill(0),
  hair: [0, 0, 0, 0, 0, 40, 40, 60, 80, 80, 0],
  hairColor: [0, 0, 0, 0, 0, 30, 30, 30, 30, 0, 40, 40, 40, 30],
  eyes: [0, 0, 0, 20, 20, 20],
  beard: [0, 0, 30, 30, 60],
  top: [0, 0, 0, 0, 0, 40, 60, 60, 120, 120],
  outfitColor: [0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 30, 0, 0, 0, 0, 0, 0],
  legs: [0, 0, 0, 0, 0, 30, 40, 40, 80, 80],
  legsColor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 30, 0, 0, 0, 0, 0, 0],
  feet: [0, 0, 0, 0, 0, 20, 30, 30, 60, 60],
  feetColor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 30, 0, 0, 0, 0, 0, 0],
  hat: [0, 50, 40, 50, 0, 30],
  glasses: [0, 50, 60, 40],
  earrings: [0, 80, 60],
  neck: [0, 80, 60, 50],
  bag: [0, 60, 60],
};

export interface LookItem {
  part: LookPart;
  index: number;
  /** `${part}:${index}` -- the id stored when bought. */
  id: string;
  label: string;
  cost: number;
}

export const CATALOG: readonly LookItem[] = LOOK_PARTS.flatMap((part) =>
  LOOK_LABELS[part].map((label, index) => ({
    part, index, id: `${part}:${index}`, label, cost: COSTS[part][index] ?? 0,
  })),
);

export const itemAt = (part: LookPart, index: number): LookItem =>
  CATALOG.find((i) => i.part === part && i.index === index) ?? CATALOG[0]!;

/**
 * An item id bought before the catalog changed, as it is called now. The one
 * "Extra" (glasses, a cap, earrings, a scarf) became five places to wear things, and
 * the price of the dearer heads moved to their hair.
 */
const RENAMED: Record<string, string> = {
  'accessory:1': 'glasses:1', 'accessory:2': 'hat:1', 'accessory:3': 'earrings:1', 'accessory:4': 'neck:1',
  'head:5': 'hair:5', 'head:6': 'hair:6', 'head:7': 'hair:7', 'head:8': 'hair:8', 'head:9': 'hair:9',
};
export const currentItem = (id: string): string => RENAMED[id] ?? id;

/** The items a look wears. */
export const itemsOf = (look: Look): LookItem[] => LOOK_PARTS.map((part) => itemAt(part, look[part]));

/** What this look wears that costs something and is not owned. Empty means it can be saved. */
export const lockedIn = (look: Look, owned: ReadonlySet<string>): LookItem[] =>
  itemsOf(look).filter((i) => i.cost > 0 && !owned.has(i.id));

/**
 * Which indices a part offers somebody who has said which figure they are, their
 * own figure's first. For hair, "figure" is the FACE's: WARDROBE_FIGURE[look.head].
 *
 * Mostly not a rule about what anybody may wear -- every piece fits every body -- just
 * what is shown first: the builder's "show everything" gets the rest.
 *
 * SHAVED IS THE ONE RULE: it is offered on the men's faces only. The founder's call
 * (2026-09-23): the pack models a woman's head as a face with no skull behind it, so
 * a shaved one is invented rather than drawn. `fitted` keeps it that way when the
 * face changes.
 */
export function offeredFor(part: SlotPart | 'hair', figure: number): number[] {
  const out: number[] = [];
  if (part === 'hair') {
    // Hair is not a man's or a woman's, so every style is offered, the person's own
    // figure's first; Shaved is the men's (above).
    const own: number[] = [];
    const other: number[] = [];
    for (let i = 0; i < WARDROBE.length; i++) {
      if (NOT_OFFERED.hair.includes(i)) continue;
      (WARDROBE_FIGURE[i] === figure ? own : other).push(i);
    }
    return figure === 0 ? [...own, SHAVED, ...other] : [...own, ...other];
  }
  for (let i = 0; i < LOOK_SIZES[part]; i++) {
    if (WARDROBE_FIGURE[i] === figure && !(NOT_OFFERED[part] ?? []).includes(i)) out.push(i);
  }
  return out;
}

/**
 * Pieces the pack ships twice under two sets' names: never offered, still worn by
 * anybody who has them. Long (straight) is Long moved by a fifth of a millimetre, and
 * the trouser suit's shoes are the overalls' shoes -- the same 816-vertex mesh in the
 * same colour -- which the builder sold for 60 points beside the free ones (found by
 * tests/thumbs.test.ts, 2026-09-29, when their two pictures came out identical).
 */
export const NOT_OFFERED: Readonly<Partial<Record<SlotPart | 'hair', readonly number[]>>> & { hair: readonly number[] } = {
  hair: [9],
  feet: [9],
};

/**
 * What else has to change when one piece of clothing does, so the outfit still fits.
 *
 * MEASURED, NOT GUESSED (render-looks.mts, 2026-09-29). Every piece is rigged to one
 * skeleton, but the two figures' bodies are not the same shape: a woman's top ends
 * above where a man's trousers begin, leaving a see-through gap at the waist, and a
 * man's shirt pokes out through a woman's trousers. Every one of the forty
 * cross-figure top-and-trousers pairs showed one or the other; every same-figure pair
 * was clean. And under bare legs (shorts, a skirt) the other figure's shoes meet the
 * ankle with a step. So a top and its trousers come from the same figure, and so do
 * bare legs and their shoes -- the partner piece moves to the same set as the one
 * just picked, and everything else is left as it was.
 */
export function fitted(look: Look, changed: 'head' | 'top' | 'legs' | 'feet'): Look {
  const out = { ...look };
  const fig = (set: number) => WARDROBE_FIGURE[set] ?? 0;
  // Shaved and a beard belong to the men's faces: a woman's face in this pack ends at
  // the hairline with nothing behind it, and her jaw is not where a beard sits. So a
  // woman's face -- which a man may pick too -- takes a hairstyle, and no beard.
  if (fig(out.head) !== 0) {
    if (out.hair === SHAVED) {
      const own = COSTS.hair[out.head] === 0 ? out.head : undefined;
      out.hair = own ?? offeredFor('hair', 1).find((i) => (COSTS.hair[i] ?? 0) === 0) ?? 1;
    }
    out.beard = 0;
  }
  // New shoes under bare legs: the legs come to the shoes, not the other way round --
  // the shoes are what was just picked.
  if (changed === 'feet' && BARE_ANKLES.has(out.legs) && fig(out.feet) !== fig(out.legs)) out.legs = out.feet;
  if (fig(out.top) !== fig(out.legs)) {
    if (changed === 'top') out.legs = out.top;
    else out.top = out.legs;
  }
  if (BARE_ANKLES.has(out.legs) && fig(out.feet) !== fig(out.legs)) out.feet = out.legs;
  return out;
}

/** Everything at a free index: the character everybody starts from. */
export const STARTER: Look = {
  figure: 0, skin: 3, body: 1, height: 2, head: 0, hair: 0, hairColor: 0, eyes: 0, beard: 0,
  top: 0, outfitColor: 2, legs: 0, legsColor: 0, feet: 0, feetColor: 0,
  hat: 0, glasses: 0, earrings: 0, neck: 0, bag: 0,
};

/**
 * The same person, dressed off the other figure's rail.
 *
 * Answering "which figure" late must not leave somebody in a man's suit with a
 * woman's face, so every slot moves to the first FREE set of the figure they chose.
 * Colours, build, height and what they wear on top stay theirs.
 */
export function forFigure(look: Look, figure: number): Look {
  // Facial hair is cut from the men's face and is only offered to them, so it comes
  // off with the rest of the men's wardrobe. So does a shaved head (`fitted`).
  const out = { ...look, figure, beard: figure === 0 ? look.beard : 0 };
  for (const part of SLOT_PARTS) {
    const here = offeredFor(part, figure);
    if (here.includes(look[part])) continue;
    out[part] = here.find((i) => (COSTS[part][i] ?? 0) === 0) ?? here[0] ?? 0;
  }
  return fitted(out, 'top');
}

/**
 * A stable string for React keys and memoisation.
 *
 * Tolerant of a look that is missing a part, because it is the FIRST thing every
 * renderer touches and it must never be the thing that takes a screen down. An app
 * newer than the server it is talking to gets exactly that -- a blob with no `legs`
 * in it -- and a red screen over a pair of trousers is not a trade worth making.
 */
export const lookKey = (look: Look): string =>
  LOOK_PARTS.map((p) => (look[p] ?? 0).toString(36)).join('');

/** Whose face stands in for "Bald" from before hair was its own choice: the figure's first. */
const firstFace = (figure: number) => WARDROBE_FIGURE.findIndex((f) => f === figure);

/**
 * A look from anything: an old row after the catalog grew, a hand-edited blob, a
 * missing field. Renderers must never throw over a hat, so an unknown or oversized
 * index wraps and a missing one falls back to the starter.
 *
 * THIS IS ALSO THE MIGRATION, and it keeps what a person saw:
 *   - rows from before the wardrobe was split (2026-09-23) carry `outfit` and a
 *     head-choosing `hair`; those are dropped and the person is back in the starter
 *     set, as they already were;
 *   - rows from before 2026-09-29 have no `hair`: their hair is their head's own, and
 *     head 10 was "Bald" -- now the figure's first face with the hair Shaved;
 *   - their one `accessory` goes to where it is worn now;
 *   - a workwear head wore a hard hat, which is a hat now, so they keep it on (unless
 *     they had picked a cap, which is what they chose to wear).
 * Everything else new starts at its first value, which is how it always looked.
 */
export function clampLook(raw: unknown): Look {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined);
  const out = { ...STARTER };
  // Every row written since 2026-09-29 has a height; one without is older, and in an
  // older row `hair` either chose a whole head (before the split) or was not there.
  const legacy = !('height' in src);
  for (const part of LOOK_PARTS) {
    if (legacy && part === 'hair') continue;
    const v = num(src[part]);
    if (v !== undefined) out[part] = ((v % LOOK_SIZES[part]) + LOOK_SIZES[part]) % LOOK_SIZES[part];
  }
  if (legacy) {
    const head = num(src.head);
    if (head === WARDROBE.length) {                 // "Bald" was head 10
      out.head = Math.max(0, firstFace(out.figure));
      out.hair = SHAVED;
    } else {
      out.hair = out.head;                           // the hair their head always had
    }
    const accessory = num(src.accessory) ?? 0;
    if (accessory === 1) out.glasses = 1;
    if (accessory === 2) out.hat = 1;
    if (accessory === 3) out.earrings = 1;
    if (accessory === 4) out.neck = 1;
    // The workwear heads wore their hard hat; it is a hat now, so it stays on.
    if (head !== WARDROBE.length && (out.head === 3 || out.head === 4) && out.hat === 0) out.hat = HARD_HAT;
  }
  return out;
}

/** The same LCG as the town's sim and the synthetic seeder: one seed, one character, for ever. */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Any item at all: practice people wear the whole catalog.
 *
 * Dressed off ONE figure's rail, not four slots picked at random out of ten. A crowd
 * of agents wearing a man's suit jacket over a dress is a bug report, not variety --
 * a person choosing that for themselves is a person having fun, which is different.
 * And not everybody wears everything: each of the five extras is on one in four.
 */
export function lookFor(seed: number): Look {
  const rnd = lcg(seed);
  const out = { ...STARTER };
  for (const part of LOOK_PARTS) out[part] = Math.floor(rnd() * LOOK_SIZES[part]);
  for (const part of SLOT_PARTS) {
    const here = offeredFor(part, out.figure);
    out[part] = here[Math.floor(rnd() * here.length)] ?? 0;
  }
  const hairs = offeredFor('hair', out.figure);
  out.hair = hairs[Math.floor(rnd() * hairs.length)] ?? 0;
  for (const part of EXTRA_PARTS) if (rnd() > 0.25) out[part] = 0;
  if (out.figure !== 0) out.beard = 0;
  return fitted(out, 'top');
}

/** The figure for what a person said they are -- 'man' the first, 'woman' the second -- or none. */
export function figureForGender(gender: string | null | undefined): number | null {
  return gender === 'man' ? 0 : gender === 'woman' ? 1 : null;
}

/**
 * Free items only: a real person who has not built one yet -- on `figure` when given, the
 * figure for what they said they are (figureForGender). The figure used to be drawn like
 * the rest, so half of the people who skipped the builder walked the town and the park as
 * the other sex: a woman shown as a man, on the Pixel, 2026-10-04. Still drawn, then set,
 * so every other part draws as it did.
 */
export function starterLookFor(seed: number, figure: number | null = null): Look {
  const rnd = lcg(seed);
  const out = { ...STARTER };
  const free = (part: LookPart, from: readonly number[]) =>
    from.filter((i) => (COSTS[part][i] ?? 0) === 0);
  for (const part of LOOK_PARTS) {
    if ((EXTRA_PARTS as readonly string[]).includes(part)) continue;
    const all = Array.from({ length: LOOK_SIZES[part] }, (_, i) => i);
    const pick = free(part, all);
    out[part] = pick[Math.floor(rnd() * pick.length)] ?? 0;
  }
  if (figure !== null) out.figure = figure;
  for (const part of SLOT_PARTS) {
    const pick = free(part, offeredFor(part, out.figure));
    out[part] = pick[Math.floor(rnd() * pick.length)] ?? 0;
  }
  const hairs = free('hair', offeredFor('hair', out.figure));
  out.hair = hairs[Math.floor(rnd() * hairs.length)] ?? 0;
  if (out.figure !== 0) out.beard = 0;
  return fitted(out, 'top');
}
