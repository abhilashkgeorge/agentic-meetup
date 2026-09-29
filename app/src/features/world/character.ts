/**
 * Which meshes a person is wearing, and what colour to paint them.
 *
 * THIS FILE IMPORTS NO THREE, on purpose. It is the whole of the dressing logic, so
 * "picking the punk boots gives you the punk's boots and nothing else of his" is a
 * thing a test can assert with no renderer in the room -- the same trick `garden.ts`
 * plays.
 *
 * The art is `assets/characters/people.glb`, built by `scripts/build-characters.mjs`
 * from Quaternius' two free modular packs. Ten complete sets, all rigged to ONE
 * skeleton (the two packs genuinely share it, which the build verifies), so any piece
 * of any set fits any body.
 *
 * A SLOT IS NOT ONE MESH. The build writes each slot as a list of pieces with a role,
 * because a pair of legs is trousers AND whatever skin shows below them, and a head is
 * a face AND hair AND eyes AND brows. Every piece is worn.
 *
 * THE HEAD IS TWO CHOICES NOW (2026-09-29): the face -- skin, eyes, brows -- comes off
 * one set and the hair off another, because in this pack they were always separate
 * meshes. `CLASS` below says which piece of a head is which, including the three the
 * build could only call "plain": the workwear man's crew cut and the punk's shaved
 * sides are hair, and the two hard hats are a hat.
 *
 * WHAT TAKES A COLOUR FROM THE PERSON: their skin, their hair (and their brows, a shade
 * darker), their eyes, their top, and -- if they choose one -- the fabric of their
 * trousers and of their shoes. Everything else keeps the artist's colour: soles,
 * stripes, belts, earrings, the hard hat.
 */
import {
  EYE_HEX, HAIR_HEX, HARD_HAT, HEIGHT_SCALE, OUTFIT_HEX, SHAVED, SKIN_HEX, SLOT_PARTS,
  WARDROBE_FIGURE, type Look, type SlotPart,
} from '@clone/shared';

/** Every set in the file, in the order `WARDROBE` names them in the catalog. */
export const LOOKS = [
  'm_casual_2',       // Tee
  'w_casual',         // Casual
  'm_casual_hoodie',  // Hoodie
  'w_worker',         // Overalls
  'm_worker',         // Workwear
  'm_beach',          // Beach
  'w_formal',         // Formal
  'm_punk',           // Punk
  'm_suit',           // Suit
  'w_suit',           // Trouser suit
] as const;
export type LookKey = (typeof LOOKS)[number];

/** What a piece is for, as the build wrote it. */
export type BuildRole = 'skin' | 'hair' | 'top' | 'plain';
/** What a piece is for, as the app paints it: the build's roles, told apart further. */
export type Role = BuildRole | 'eyes' | 'brows' | 'legs' | 'feet' | 'hat';

export interface Piece {
  readonly mesh: string;
  readonly role: BuildRole;
  /** The pack's own name for it ("Punk_Feet"), kept so a person can be told apart. */
  readonly from?: string;
}

/** One set's pieces, split the way the builder asks for them: one list per slot. */
export type LookPieces = Readonly<Record<SlotPart, readonly Piece[]>>;

/**
 * The four facial-hair meshes the build cut out of the face, in catalog order after
 * "Clean". They are not part of any set -- a beard goes on whatever face you picked.
 */
export type Beards = readonly string[];

/** The slot a `Look` field names, in the order a person is drawn from the floor up. */
export const SLOTS = SLOT_PARTS;

/**
 * The pieces the app treats as something more particular than the build said. Named
 * by mesh, because that is what they are; tests/character.test.ts checks every name
 * against the model and every class against what the piece actually is -- eyes are
 * small and dark and in front of the face, a hat sits above the crown, the fabric of
 * a pair of trousers is its biggest plain piece.
 */
export const CLASS: Readonly<Record<string, Exclude<Role, BuildRole> | 'hair'>> = {
  // Eyes: a little dark mesh each face has had all along.
  m_casual_2_h5: 'eyes', w_casual_h3: 'eyes', m_casual_hoodie_h3: 'eyes', w_worker_h3: 'eyes', m_worker_h5: 'eyes',
  m_beach_h3: 'eyes', w_formal_h2: 'eyes', m_punk_h2: 'eyes', m_suit_h4: 'eyes', w_suit_h3: 'eyes',
  // Brows, which follow the hair colour, a shade darker.
  m_casual_2_h3: 'brows', w_casual_h2: 'brows', m_casual_hoodie_h2: 'brows', m_beach_h2: 'brows',
  m_punk_h3: 'brows', m_suit_h2: 'brows', w_suit_h2: 'brows',
  // Hair the build could only call plain: the workwear man's crew cut, the punk's sides.
  m_worker_h2: 'hair', m_punk_h4: 'hair',
  // The two hard hats. A hat now, for anybody (`HARD_HAT`).
  m_worker_h3: 'hat', w_worker_h4: 'hat',
  // The fabric of every pair of trousers: its biggest plain piece.
  m_casual_2_b3: 'legs', w_casual_b3: 'legs', m_casual_hoodie_b4: 'legs', w_worker_b3: 'legs', m_worker_b3: 'legs',
  m_beach_b4: 'legs', w_formal_b4: 'legs', m_punk_b4: 'legs', m_suit_b2: 'legs', w_suit_b3: 'legs',
  // ...and of every pair of shoes: the upper, not the sole.
  m_casual_2_b1: 'feet', w_casual_b2: 'feet', m_casual_hoodie_b1: 'feet', w_worker_b2: 'feet', m_worker_b1: 'feet',
  m_beach_b2: 'feet', w_formal_b2: 'feet', m_punk_b2: 'feet', m_suit_b1: 'feet', w_suit_b2: 'feet',
};

/** What a piece is for, as the app paints it. */
export const roleOf = (p: Piece): Role => {
  const c = CLASS[p.mesh];
  return c ?? p.role;
};

/** Which part of the look a piece answers to, for pieces off the head. */
export type Worn = SlotPart | 'hair' | 'beard' | 'hat';

export interface Part {
  /** The mesh's name in people.glb. */
  readonly mesh: string;
  /** What it is for. Carried through so callers can reason about a piece by meaning. */
  readonly role: Role;
  /** Hex colour to paint it, or null to keep the colour the artist gave it. */
  readonly tint: string | null;
  /** Which choice it came from. */
  readonly worn: Worn;
  /** Drawn this much bigger about SKULL_MIDDLE, in the model's bind space: see HAIR_FIT. */
  readonly fit?: number;
}

/**
 * The faces with a whole skull under their hair. The others -- the two workwear-cut
 * men and every woman -- end at the hairline, and their own hair is the back of their
 * head (measured 2026-09-29: their skin stops at z -0.004 to -0.049 behind the head
 * bone, a whole skull goes back to -0.105).
 */
export const FULL_SKULL: ReadonlySet<number> = new Set([0, 2, 5, 8]);

/**
 * The hairstyles modelled on a smaller skull than some faces have, and how much bigger
 * each is drawn on those faces, about SKULL_MIDDLE: HAIR_FIT[hairstyle][face].
 *
 * FOUND BY LOOKING (render-looks.mts hair-face, front and back, 2026-09-29): on the
 * four FULL_SKULL faces the Bob's crown showed bare skull, the Crew cut and the
 * Mohawk's shaved sides -- thin shells the pack models ON the skull -- came out as
 * stripes where two surfaces shared a depth, and Wavy left a bald patch at the crown;
 * the Bob also showed skull on the three other women's faces and flecks on the two
 * short-skulled men's. Every other pairing is fine as it is. Each number is the
 * smallest that covered the skull in that sheet; tests/character.test.ts holds every
 * pairing to it.
 */
const fitOn = (faces: readonly number[], fit: number) => Object.fromEntries(faces.map((f) => [f, fit]));
export const HAIR_FIT: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  3: { ...fitOn([0, 2, 5, 8], 1.12), ...fitOn([1, 6, 9], 1.05), ...fitOn([4, 7], 1.02) },
  4: fitOn([0, 2, 5, 8], 1.02),
  6: fitOn([0, 2, 5, 8], 1.10),
  7: fitOn([0, 2, 5, 8], 1.02),
};

/** Every hairstyle-and-fit there is, in one fixed order: what the GPU crowd bakes. */
export const FITTED_HAIR: readonly { readonly hair: number; readonly fit: number }[] = Object.entries(HAIR_FIT)
  .flatMap(([hair, byFace]) => [...new Set(Object.values(byFace))].map((fit) => ({ hair: Number(hair), fit })));

/** The middle of the skull in the model's bind space: what a fitted hairstyle grows about. */
export const SKULL_MIDDLE: readonly [number, number, number] = [0, 1.717, 0.053];

/**
 * What a shaved head is on a face that ends at the hairline: the Crew cut's shell,
 * which is exactly a whole skull, painted in their skin.
 */
export const SCALP = 'm_worker_h2';

/**
 * The things worn on top of the clothes that the pack does not model: built from
 * simple shapes in character-mesh.ts `buildExtras`, and hung off the head, the neck or
 * the chest so they move with them.
 */
export type ExtraKind =
  | 'cap' | 'beanie' | 'bucket' | 'beret'
  | 'round' | 'sunglasses' | 'square'
  | 'studs' | 'hoops'
  | 'scarf' | 'necklace' | 'bowtie'
  | 'backpack' | 'shoulderbag';
export const EXTRA_KINDS: readonly ExtraKind[] = [
  'cap', 'beanie', 'bucket', 'beret', 'round', 'sunglasses', 'square', 'studs', 'hoops',
  'scarf', 'necklace', 'bowtie', 'backpack', 'shoulderbag',
];

/** Each extra part's choices, in LOOK_LABELS order after "None". The hard hat is a mesh. */
const EXTRA_OF = {
  hat: ['cap', 'beanie', 'bucket', null, 'beret'],
  glasses: ['round', 'sunglasses', 'square'],
  earrings: ['studs', 'hoops'],
  neck: ['scarf', 'necklace', 'bowtie'],
  bag: ['backpack', 'shoulderbag'],
} as const satisfies Record<string, readonly (ExtraKind | null)[]>;

/**
 * What a thing is when the person's own colours do not decide it. A cap, a beanie, a
 * scarf, a bow tie and a backpack take a shade off the cloth wheel (`extraTint`);
 * glasses and jewellery do not, because tinted spectacles and a matching earring look
 * like a costume.
 */
export const EXTRA_OWN_COLOUR: Record<ExtraKind, string> = {
  cap: '#ffffff', beanie: '#ffffff', bucket: '#ffffff', beret: '#ffffff',
  round: '#2f333a', sunglasses: '#1c1f24', square: '#3a2f26',
  studs: '#d9a441', hoops: '#d9a441',
  scarf: '#ffffff', necklace: '#d9a441', bowtie: '#ffffff',
  backpack: '#ffffff', shoulderbag: '#6b4a32',
};

/** How far round the cloth wheel from the top each wheel-coloured thing sits. */
const WHEEL_OFFSET: Partial<Record<ExtraKind, number>> = {
  cap: 3, beanie: 3, bucket: 3, beret: 5, scarf: 6, bowtie: 9, backpack: 4,
};

export interface Worn2 { readonly kind: ExtraKind; readonly tint: string }

export interface Character {
  /** Which set each choice came from; hair is null when there is none to draw. */
  readonly wearing: Readonly<Record<SlotPart, LookKey>> & { readonly hair: LookKey | null };
  /** Every mesh to show, with its colour. */
  readonly parts: readonly Part[];
  /** What they are wearing on top of all that, and what colour each thing is. */
  readonly extras: readonly Worn2[];
}

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length]!;

/** A hex colour a shade darker: brows under hair. */
function darker(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * A person's own colours, by what they paint. Trousers and shoes are null when left
 * "as made": they keep the artist's colour.
 */
export function coloursOf(look: Look): {
  skin: string; hair: string; brows: string; eyes: string; top: string; legs: string | null; feet: string | null;
} {
  const hair = HAIR_HEX[look.hairColor] ?? HAIR_HEX[0]!;
  const cloth = (i: number) => OUTFIT_HEX[i] ?? OUTFIT_HEX[0]!;
  return {
    skin: SKIN_HEX[look.skin] ?? SKIN_HEX[3]!,
    hair,
    brows: darker(hair, 0.55),
    eyes: EYE_HEX[look.eyes] ?? EYE_HEX[0]!,
    top: cloth(look.outfitColor),
    legs: look.legsColor > 0 ? cloth(look.legsColor - 1) : null,
    feet: look.feetColor > 0 ? cloth(look.feetColor - 1) : null,
  };
}

/** Whose hard hat a face wears: the one modelled for a head of its figure. */
export const hardHatSet = (face: number): LookKey => (WARDROBE_FIGURE[face] === 1 ? 'w_worker' : 'm_worker');

/** Where the head bone is bound, in the model's bind space. It is square to the model. */
export const HEAD_BIND: readonly [number, number, number] = [-0.0003, 1.5873, 0.0431];

/**
 * The inside of each hat, in the head bone's bind space: the upper half of an
 * ellipsoid standing on the hat's rim, centred over the middle of the head (z 0.014),
 * a few millimetres inside the hat everywhere.
 *
 * HAT HAIR. Any hairstyle goes under any hat. Where the hair above the rim reaches
 * outside this shape it is drawn pulled onto it, so it stays under the hat, and below
 * the rim it hangs as it always did. What it replaced: a rule that took the two tall
 * hairstyles off under a hat -- which left a bald head under the cap on the faces that
 * have a whole skull -- and nothing at all for the rest, and six of the nine others
 * came through the crown of every hat (render-looks.mts hat-hair, 2026-09-29). The
 * numbers come off the shapes in character-mesh.ts and, for the hard hat, off the
 * pack's own mesh; tests/character-mesh.test.ts checks each is inside its hat.
 */
export const HAT_INSIDE: Readonly<Record<number, { readonly rim: number; readonly radii: readonly [number, number, number] }>> = {
  1: { rim: 0.145, radii: [0.116, 0.14, 0.116] },    // cap
  2: { rim: 0.148, radii: [0.118, 0.16, 0.122] },    // beanie
  3: { rim: 0.149, radii: [0.116, 0.145, 0.116] },   // bucket hat
  4: { rim: 0.12, radii: [0.098, 0.145, 0.1] },      // hard hat (the pack's; both figures' are this size)
  5: { rim: 0.175, radii: [0.11, 0.07, 0.11] },      // beret
};
const HAT_MID_Z = 0.014;

/**
 * A hair vertex under a hat: where it is drawn, in the model's bind space, or null if
 * it stays where it is. The GPU crowd does the same in its vertex shader.
 */
export function underHat(x: number, y: number, z: number, hat: number): [number, number, number] | null {
  const h = HAT_INSIDE[hat];
  if (!h) return null;
  const cx = HEAD_BIND[0], cy = HEAD_BIND[1] + h.rim, cz = HEAD_BIND[2] + HAT_MID_Z;
  const dy = y - cy;
  if (dy <= 0) return null;
  const dx = x - cx, dz = z - cz;
  const q = Math.hypot(dx / h.radii[0], dy / h.radii[1], dz / h.radii[2]);
  return q > 1 ? [cx + dx / q, cy + dy / q, cz + dz / q] : null;
}

/**
 * Dress somebody.
 *
 * `pieces` is the list of meshes each set is made of, which the renderer reads from
 * the manifest the build script writes beside the model. Passing it in rather than
 * importing it is what keeps this file free of anything a test cannot run.
 */
export function partsOf(
  look: Look,
  pieces: (key: LookKey) => LookPieces | undefined,
  beards: Beards = [],
): Character {
  const shaved = look.hair === SHAVED;
  const wearing = {
    head: pick(LOOKS, look.head),
    hair: shaved ? null : pick(LOOKS, look.hair),
    top: pick(LOOKS, look.top),
    legs: pick(LOOKS, look.legs),
    feet: pick(LOOKS, look.feet),
  } as const;

  const colours = coloursOf(look);
  const tintFor = (role: Role): string | null => {
    switch (role) {
      case 'skin': case 'hair': case 'brows': case 'eyes': case 'top': case 'legs': case 'feet': return colours[role];
      default: return null;
    }
  };

  const parts: Part[] = [];
  const put = (p: Piece, worn: Worn) => {
    const role = roleOf(p);
    parts.push({ mesh: p.mesh, role, tint: tintFor(role), worn });
  };
  // The face: everything on its head that is neither hair nor a hat.
  for (const p of pieces(wearing.head)?.head ?? []) {
    const role = roleOf(p);
    if (role !== 'hair' && role !== 'hat') put(p, 'head');
  }
  // The hair: everything on the hair set's head that IS hair -- grown to fit a whole
  // skull where it was modelled on a smaller one. No hair on a face that ends at the
  // hairline is the pack's own scalp, or they would have no back to their head.
  if (wearing.hair) {
    const fit = HAIR_FIT[look.hair]?.[look.head];
    for (const p of pieces(wearing.hair)?.head ?? []) {
      if (roleOf(p) === 'hair') parts.push({ mesh: p.mesh, role: 'hair', tint: colours.hair, worn: 'hair', ...(fit ? { fit } : {}) });
    }
  } else if (!FULL_SKULL.has(look.head)) {
    parts.push({ mesh: SCALP, role: 'skin', tint: colours.skin, worn: 'hair' });
  }
  for (const slot of ['top', 'legs', 'feet'] as const) {
    for (const p of pieces(wearing[slot])?.[slot] ?? []) put(p, slot);
  }

  // Facial hair rides on top of whatever face they chose, in their hair colour, and is
  // only ever offered to the men -- it is cut from the men's face.
  const beard = look.beard > 0 ? beards[look.beard - 1] : undefined;
  if (beard) parts.push({ mesh: beard, role: 'hair', tint: colours.hair, worn: 'beard' });

  // The hard hat is the pack's own, the one modelled for a head of this face's figure.
  if (look.hat === HARD_HAT) {
    for (const p of pieces(hardHatSet(look.head))?.head ?? []) if (roleOf(p) === 'hat') put(p, 'hat');
  }

  const extras: Worn2[] = [];
  const wheel = OUTFIT_HEX.length;
  for (const part of Object.keys(EXTRA_OF) as (keyof typeof EXTRA_OF)[]) {
    const kind = look[part] > 0 ? (EXTRA_OF[part] as readonly (ExtraKind | null)[])[look[part] - 1] : null;
    if (!kind) continue;
    const off = WHEEL_OFFSET[kind];
    extras.push({ kind, tint: off === undefined ? EXTRA_OWN_COLOUR[kind] : OUTFIT_HEX[(look.outfitColor + off) % wheel]! });
  }

  return { wearing, parts, extras };
}

/**
 * How broad and how tall to draw somebody, from the build and height they chose.
 *
 * The pack ships one figure per gender, so build is a scale rather than a mesh -- the
 * same three numbers the capsule renderer used. Height is a few percent either way:
 * people who differ more than that at this scale read as standing at different
 * distances.
 */
export const BUILD_SCALE: readonly (readonly [number, number, number])[] = [
  [0.92, 1, 0.92],
  [1, 1, 1],
  [1.1, 1, 1.08],
];

export const buildScale = (look: Look): readonly [number, number, number] => {
  const [x, , z] = BUILD_SCALE[look.body] ?? BUILD_SCALE[1]!;
  return [x, HEIGHT_SCALE[look.height] ?? 1, z];
};

/** The two clips in the file. A person is either going somewhere or they are not. */
export const clipFor = (moving: boolean) => (moving ? 'walk' : 'idle');
