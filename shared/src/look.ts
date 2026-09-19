/**
 * The character: eight small numbers that say how a person is drawn.
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
 * hair 5 is a bun.
 */
import { z } from 'zod';

export const LOOK_SIZES = {
  skin: 8, body: 3, hair: 8, hairColor: 8, face: 6, outfit: 8, outfitColor: 12, accessory: 5,
} as const;
export type LookPart = keyof typeof LOOK_SIZES;
export const LOOK_PARTS = Object.keys(LOOK_SIZES) as readonly LookPart[];

const idx = (n: number) => z.number().int().min(0).max(n - 1);

export const Look = z.object({
  skin: idx(LOOK_SIZES.skin),
  body: idx(LOOK_SIZES.body),
  hair: idx(LOOK_SIZES.hair),
  hairColor: idx(LOOK_SIZES.hairColor),
  face: idx(LOOK_SIZES.face),
  outfit: idx(LOOK_SIZES.outfit),
  outfitColor: idx(LOOK_SIZES.outfitColor),
  accessory: idx(LOOK_SIZES.accessory),
}).strict();
export type Look = z.infer<typeof Look>;

/** What each index is called, in the order it is drawn in the builder. */
export const LOOK_LABELS: Record<LookPart, readonly string[]> = {
  skin: ['Porcelain', 'Fair', 'Light', 'Olive', 'Tan', 'Brown', 'Deep', 'Ebony'],
  body: ['Slim', 'Average', 'Broad'],
  hair: ['Short', 'Buzz', 'Curly', 'Long', 'Bun', 'Ponytail', 'Mohawk', 'Bald'],
  hairColor: ['Black', 'Dark brown', 'Brown', 'Auburn', 'Grey', 'Blonde', 'Red', 'Blue'],
  face: ['Calm', 'Bright', 'Sleepy', 'Wide-eyed', 'Wry', 'Serious'],
  outfit: ['Tee', 'Hoodie', 'Kurta', 'Dress', 'Sari', 'Jacket', 'Suit', 'Sporty'],
  outfitColor: ['Sand', 'Slate', 'Navy', 'Forest', 'Plum', 'Rust', 'Teal', 'Mustard', 'Coral', 'Lilac', 'Mint', 'Gold'],
  accessory: ['Nothing', 'Glasses', 'Cap', 'Earrings', 'Scarf'],
};

/** Presentation colours, shared by the 3D town and the 2D avatar so they agree. */
export const SKIN_HEX = ['#f6e2d0', '#f1cfb3', '#e5b48f', '#caa073', '#b07f55', '#8d5a3b', '#66402a', '#3e2a1e'] as const;
export const HAIR_HEX = ['#1d1a1a', '#3b2a20', '#6b4a32', '#8f4a2a', '#9a9a9a', '#d9b56a', '#b83a2a', '#3b5bdb'] as const;
export const OUTFIT_HEX = ['#d9c9a8', '#5d6470', '#2e3f6e', '#2f5d3f', '#6b3d6b', '#a0522d', '#2a7f7f', '#c9a227', '#e0705f', '#a58ad1', '#8fd1b3', '#d4a017'] as const;

/**
 * Cost per index. Zero is the starter set: every part has at least one, so a person
 * who has earned nothing still has a whole character. The rest is what points buy.
 * Everything together is about 700, ten dates or so -- bounded on purpose.
 */
const COSTS: Record<LookPart, readonly number[]> = {
  skin: [0, 0, 0, 0, 0, 0, 0, 0],
  body: [0, 0, 0],
  hair: [0, 0, 0, 40, 40, 40, 80, 80],
  hairColor: [0, 0, 0, 0, 0, 30, 30, 30],
  face: [0, 0, 0, 30, 30, 30],
  outfit: [0, 0, 0, 60, 60, 60, 120, 120],
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

/** The eight items a look wears. */
export const itemsOf = (look: Look): LookItem[] => LOOK_PARTS.map((part) => itemAt(part, look[part]));

/** What this look wears that costs something and is not owned. Empty means it can be saved. */
export const lockedIn = (look: Look, owned: ReadonlySet<string>): LookItem[] =>
  itemsOf(look).filter((i) => i.cost > 0 && !owned.has(i.id));

/** Everything at a free index: the character everybody starts from. */
export const STARTER: Look = { skin: 3, body: 1, hair: 0, hairColor: 0, face: 0, outfit: 0, outfitColor: 2, accessory: 0 };

/** A stable string for React keys and memoisation. */
export const lookKey = (look: Look): string => LOOK_PARTS.map((p) => look[p].toString(36)).join('');

/**
 * A look from anything: an old row after the catalog grew, a hand-edited blob, a
 * missing field. Renderers must never throw over a hat, so an unknown or oversized
 * index wraps and a missing one falls back to the starter.
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

/** Any item at all: practice people wear the whole catalog. */
export function lookFor(seed: number): Look {
  const rnd = lcg(seed);
  const out = { ...STARTER };
  for (const part of LOOK_PARTS) out[part] = Math.floor(rnd() * LOOK_SIZES[part]);
  return out;
}

/** Free items only: a real person who has not built one yet. */
export function starterLookFor(seed: number): Look {
  const rnd = lcg(seed);
  const out = { ...STARTER };
  for (const part of LOOK_PARTS) {
    const free = COSTS[part].map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0);
    out[part] = free[Math.floor(rnd() * free.length)] ?? 0;
  }
  return out;
}
