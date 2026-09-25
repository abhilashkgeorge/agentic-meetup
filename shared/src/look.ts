/**
 * The character: ten small numbers that say how a person is drawn.
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
 * head 5 is the beach one.
 *
 * THERE IS NO "FACE" ANY MORE. It offered six expressions -- Calm, Bright, Sleepy and
 * three at thirty points -- and moved the eyes a fraction of a well apart on the flat
 * avatar. On the rigged body, which is what the town and the builder actually draw, it
 * did nothing and could not: these heads have no morph targets, and the eyes are a
 * twenty-four-triangle mesh baked into the head. Three of the six were priced. Taken
 * out rather than left looking like a choice. Anything already bought stays in
 * `look_items` and is simply no longer in the catalog.
 *
 * ONE OUTFIT USED TO BE ONE CHOICE. A person picked "Suit" and got the suit's shoes,
 * the suit's trousers, the suit's jacket, take it or leave it -- eight outfits, and
 * that was the whole wardrobe. The art was never like that: every set in the pack is
 * modelled in four separate pieces on one shared skeleton, so any set's boots fit any
 * set's legs. So the choice is now per slot -- feet, legs, top, head -- off the same
 * ten sets, which is ten thousand combinations instead of eight, with no new art and
 * not one byte more to download.
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

/** The last head is no head at all: the face, and nothing else on it. */
export const BALD = WARDROBE.length;

export const LOOK_SIZES = {
  figure: 2, skin: 8, body: 3,
  head: WARDROBE.length + 1, hairColor: 8, beard: 5,
  top: WARDROBE.length, legs: WARDROBE.length, feet: WARDROBE.length,
  outfitColor: 12, accessory: 5,
} as const;
export type LookPart = keyof typeof LOOK_SIZES;
export const LOOK_PARTS = Object.keys(LOOK_SIZES) as readonly LookPart[];

/** The four parts that come off the wardrobe, so a caller can treat them alike. */
export const SLOT_PARTS = ['head', 'top', 'legs', 'feet'] as const;
export type SlotPart = (typeof SLOT_PARTS)[number];
export const isSlot = (part: LookPart): part is SlotPart => (SLOT_PARTS as readonly string[]).includes(part);

const idx = (n: number) => z.number().int().min(0).max(n - 1);

export const Look = z.object({
  figure: idx(LOOK_SIZES.figure),
  skin: idx(LOOK_SIZES.skin),
  body: idx(LOOK_SIZES.body),
  head: idx(LOOK_SIZES.head),
  hairColor: idx(LOOK_SIZES.hairColor),
  beard: idx(LOOK_SIZES.beard),
  top: idx(LOOK_SIZES.top),
  legs: idx(LOOK_SIZES.legs),
  feet: idx(LOOK_SIZES.feet),
  outfitColor: idx(LOOK_SIZES.outfitColor),
  accessory: idx(LOOK_SIZES.accessory),
}).strict();
export type Look = z.infer<typeof Look>;

/** What each index is called, in the order it is drawn in the builder. */
export const LOOK_LABELS: Record<LookPart, readonly string[]> = {
  figure: ['Man', 'Woman'],
  skin: ['Porcelain', 'Fair', 'Light', 'Olive', 'Tan', 'Brown', 'Deep', 'Ebony'],
  body: ['Slim', 'Average', 'Broad'],
  head: [...WARDROBE, 'Bald'],
  hairColor: ['Black', 'Dark brown', 'Brown', 'Auburn', 'Grey', 'Blonde', 'Red', 'Blue'],
  beard: ['Clean', 'Jawline', 'Moustache', 'Goatee', 'Full beard'],
  top: WARDROBE,
  legs: WARDROBE,
  feet: WARDROBE,
  outfitColor: ['Sand', 'Slate', 'Navy', 'Forest', 'Plum', 'Rust', 'Teal', 'Mustard', 'Coral', 'Lilac', 'Mint', 'Gold'],
  accessory: ['Nothing', 'Glasses', 'Cap', 'Earrings', 'Scarf'],
};

/** Presentation colours, shared by the 3D town and the 2D avatar so they agree. */
export const SKIN_HEX = ['#f6e2d0', '#f1cfb3', '#e5b48f', '#caa073', '#b07f55', '#8d5a3b', '#66402a', '#3e2a1e'] as const;
export const HAIR_HEX = ['#1d1a1a', '#3b2a20', '#6b4a32', '#8f4a2a', '#9a9a9a', '#d9b56a', '#b83a2a', '#3b5bdb'] as const;
export const OUTFIT_HEX = ['#d9c9a8', '#5d6470', '#2e3f6e', '#2f5d3f', '#6b3d6b', '#a0522d', '#2a7f7f', '#c9a227', '#e0705f', '#a58ad1', '#8fd1b3', '#d4a017'] as const;

/**
 * Cost per index. Zero is the starter set: every part has at least one, so a person
 * who has earned nothing still has a whole character -- and the free five sets cover
 * both figures, so "free" is not a men's wardrobe.
 *
 * A whole outfit at the top of the ladder is 340, about five dates. The ladder is per
 * SLOT now, so the expensive sets can be worn a piece at a time: the suit trousers
 * with a free tee is 80, which is the point of splitting them.
 */
const COSTS: Record<LookPart, readonly number[]> = {
  figure: [0, 0],
  skin: [0, 0, 0, 0, 0, 0, 0, 0],
  body: [0, 0, 0],
  head: [0, 0, 0, 0, 0, 40, 40, 60, 80, 80, 0],
  hairColor: [0, 0, 0, 0, 0, 30, 30, 30],
  beard: [0, 0, 30, 30, 60],
  top: [0, 0, 0, 0, 0, 40, 60, 60, 120, 120],
  legs: [0, 0, 0, 0, 0, 30, 40, 40, 80, 80],
  feet: [0, 0, 0, 0, 0, 20, 30, 30, 60, 60],
  outfitColor: [0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 30],
  accessory: [0, 50, 50, 80, 80],
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

/** The items a look wears. */
export const itemsOf = (look: Look): LookItem[] => LOOK_PARTS.map((part) => itemAt(part, look[part]));

/** What this look wears that costs something and is not owned. Empty means it can be saved. */
export const lockedIn = (look: Look, owned: ReadonlySet<string>): LookItem[] =>
  itemsOf(look).filter((i) => i.cost > 0 && !owned.has(i.id));

/**
 * Which indices a slot offers somebody who has said which figure they are.
 *
 * Mostly not a rule about what anybody may wear -- every piece fits every body, and
 * mixing is the whole point -- just what is shown first. A woman looking for a top
 * should not have to scroll past six men's ones to find hers, and the "show
 * everything" toggle in the builder gets her the rest.
 *
 * BALD IS THE ONE EXCEPTION, and it is a rule: it is offered to the men only. The
 * founder's call (2026-09-23), and it does cost a real look -- plenty of women shave
 * their heads. What it buys is that nobody has to like the bald head this pack can
 * give a woman: her head is modelled as a face with no skull behind it, so hers is
 * one the build invents rather than one the artist drew.
 */
export function offeredFor(part: SlotPart, figure: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOOK_SIZES[part]; i++) {
    if (i === BALD ? figure === 0 : WARDROBE_FIGURE[i] === figure) out.push(i);
  }
  return out;
}

/** Everything at a free index: the character everybody starts from. */
export const STARTER: Look = {
  figure: 0, skin: 3, body: 1, head: 0, hairColor: 0, beard: 0,
  top: 0, legs: 0, feet: 0, outfitColor: 2, accessory: 0,
};

/**
 * The same person, dressed off the other figure's rail.
 *
 * Answering "which figure" late must not leave somebody in a man's suit with a
 * woman's face, so every slot moves to the first FREE set of the figure they chose.
 * Colours, build and what they are wearing on their head stay theirs.
 */
export function forFigure(look: Look, figure: number): Look {
  // Facial hair is cut from the men's face and is only offered to them, so it comes
  // off with the rest of the men's wardrobe. So does a bald head.
  const out = { ...look, figure, beard: figure === 0 ? look.beard : 0 };
  for (const part of SLOT_PARTS) {
    const here = offeredFor(part, figure);
    if (here.includes(look[part])) continue;
    out[part] = here.find((i) => (COSTS[part][i] ?? 0) === 0) ?? here[0] ?? 0;
  }
  return out;
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

/**
 * A look from anything: an old row after the catalog grew, a hand-edited blob, a
 * missing field. Renderers must never throw over a hat, so an unknown or oversized
 * index wraps and a missing one falls back to the starter.
 *
 * This is also the migration. Rows written before the wardrobe was split carry
 * `outfit` and `hair`, which no longer mean anything -- an outfit index chose a whole
 * body and a hair index chose a head, and neither maps onto a slot without lying
 * about what somebody picked. They are dropped, and those people are dressed in the
 * starter set again. Two phones and a table of practice people, so nobody loses
 * anything they paid for: what was BOUGHT lives in its own table and is untouched.
 */
export function clampLook(raw: unknown): Look {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...STARTER };
  for (const part of LOOK_PARTS) {
    const v = src[part];
    if (typeof v === 'number' && Number.isFinite(v)) out[part] = ((Math.trunc(v) % LOOK_SIZES[part]) + LOOK_SIZES[part]) % LOOK_SIZES[part];
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
 */
export function lookFor(seed: number): Look {
  const rnd = lcg(seed);
  const out = { ...STARTER };
  for (const part of LOOK_PARTS) out[part] = Math.floor(rnd() * LOOK_SIZES[part]);
  for (const part of SLOT_PARTS) {
    const here = offeredFor(part, out.figure);
    out[part] = here[Math.floor(rnd() * here.length)] ?? 0;
  }
  if (out.figure !== 0) out.beard = 0;
  return out;
}

/** Free items only: a real person who has not built one yet. */
export function starterLookFor(seed: number): Look {
  const rnd = lcg(seed);
  const out = { ...STARTER };
  const free = (part: LookPart, from: readonly number[]) =>
    from.filter((i) => (COSTS[part][i] ?? 0) === 0);
  for (const part of LOOK_PARTS) {
    const all = Array.from({ length: LOOK_SIZES[part] }, (_, i) => i);
    const pick = free(part, all);
    out[part] = pick[Math.floor(rnd() * pick.length)] ?? 0;
  }
  for (const part of SLOT_PARTS) {
    const pick = free(part, offeredFor(part, out.figure));
    out[part] = pick[Math.floor(rnd() * pick.length)] ?? 0;
  }
  if (out.figure !== 0) out.beard = 0;
  return out;
}
