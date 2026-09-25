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
 * a face AND hair AND brows. An earlier version assumed the second mesh in a group was
 * an alternative and dropped it, which left everybody walking around with no chest and
 * two floating sleeves. There are no alternatives in this pack. Every piece is worn.
 *
 * Only three things take a colour from the person: their skin, their hair, and the one
 * piece the build marked as the top. Trousers and shoes keep what the artist gave
 * them, because a figure painted one colour from collar to sole is a skittle.
 */
import { BALD, HAIR_HEX, OUTFIT_HEX, SKIN_HEX, SLOT_PARTS, offeredFor, type Look, type SlotPart } from '@clone/shared';

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

/** What a piece is for, which is the only thing that decides its colour. */
export type Role = 'skin' | 'hair' | 'top' | 'plain';

export interface Piece {
  readonly mesh: string;
  readonly role: Role;
  /** The pack's own name for it ("Punk_Feet"), kept so a person can be told apart. */
  readonly from?: string;
}

/** One set's pieces, split the way the builder asks for them: one list per slot. */
export type LookPieces = Readonly<Record<SlotPart, readonly Piece[]>>;

/**
 * The four facial-hair meshes the build cut out of the face, in catalog order after
 * "Clean". They are not part of any set -- a beard goes on whatever head you picked.
 */
export type Beards = readonly string[];

/** The slot a `Look` field names, in the order a person is drawn from the floor up. */
export const SLOTS = SLOT_PARTS;

export interface Part {
  /** The mesh's name in people.glb. */
  readonly mesh: string;
  /** What it is for. Carried through so callers can reason about a piece by meaning. */
  readonly role: Role;
  /** Hex colour to paint it, or null to keep the colour the artist gave it. */
  readonly tint: string | null;
}

/**
 * The one thing somebody is wearing that is not part of the body.
 *
 * The pack has no accessories at all, so these are the same primitives the capsule
 * renderer has always drawn -- a pair of rings, a cap, two studs, a loop at the
 * throat -- hung off the head bone so they move with it. They were silently lost the
 * day rigged bodies landed, which meant four items priced at 50 to 80 points bought
 * nothing at all; the flat avatar and the capsules had gone on showing them.
 */
export type Extra = 'none' | 'glasses' | 'cap' | 'earrings' | 'scarf';

/** LOOK_LABELS.accessory order: Nothing, Glasses, Cap, Earrings, Scarf. */
const EXTRAS: readonly Extra[] = ['none', 'glasses', 'cap', 'earrings', 'scarf'];

export interface Character {
  /** Which set each slot came from, which is now usually four different answers. */
  readonly wearing: Readonly<Record<SlotPart, LookKey>>;
  /** Every mesh to show, with its colour. */
  readonly parts: readonly Part[];
  /** What they are wearing on top of all that, and what colour it is. */
  readonly extra: Extra;
  readonly extraTint: string | null;
}

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length]!;

/**
 * Whose face a bald person wears.
 *
 * Bald is not a set, so it has to borrow a head from one, and it used to borrow the
 * FIRST ONE IN THE FILE every time -- a man's. The men in this pack are modelled with
 * a darker patch of skin over the jaw, which with hair on is a jawline and with a
 * bald head on a woman is a beard. So it borrows from the first set of the person's
 * own figure instead.
 */
export const baldBase = (figure: number): number =>
  offeredFor('head', figure).find((i) => i !== BALD) ?? 0;

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
  const bald = look.head === BALD;
  const wearing = {
    head: pick(LOOKS, bald ? baldBase(look.figure) : look.head),
    top: pick(LOOKS, look.top),
    legs: pick(LOOKS, look.legs),
    feet: pick(LOOKS, look.feet),
  } as const;

  const skin = SKIN_HEX[look.skin] ?? SKIN_HEX[3]!;
  const hair = HAIR_HEX[look.hairColor] ?? HAIR_HEX[0]!;
  const cloth = OUTFIT_HEX[look.outfitColor] ?? OUTFIT_HEX[0]!;
  const tintFor = (role: Role): string | null =>
    role === 'skin' ? skin : role === 'hair' ? hair : role === 'top' ? cloth : null;

  const parts: Part[] = [];
  for (const slot of SLOTS) {
    for (const p of pieces(wearing[slot])?.[slot] ?? []) {
      // Bald drops the HAIR and nothing else.
      //
      // It used to drop everything that was not skin, on the grounds that a pair of
      // eyebrows is twenty-four triangles nobody can see at town size. In the
      // builder, where the head fills a third of the screen, what it actually did was
      // take the person's eyes and eyebrows off: a blank face on a smooth skull.
      // Bald always comes off the first set, which has no hat to worry about.
      if (slot === 'head' && bald && p.role === 'hair') continue;
      parts.push({ mesh: p.mesh, role: p.role, tint: tintFor(p.role) });
    }
  }

  // Facial hair rides on top of whatever head they chose, in their hair colour, and
  // is only ever offered to the men -- it is cut from the men's face. It is a normal
  // mesh in the model, so it merges into the body like everything else and costs no
  // extra draw call.
  const beard = look.beard > 0 ? beards[look.beard - 1] : undefined;
  if (beard) parts.push({ mesh: beard, role: 'hair', tint: hair });

  // Offsets, not the outfit colour itself: a cap in exactly the shade of the shirt
  // reads as part of the shirt. The capsule renderer picked +3 and +6 around the
  // twelve-colour wheel for the same reason, and this keeps people looking the same.
  const extra = EXTRAS[look.accessory] ?? 'none';
  const wheel = OUTFIT_HEX.length;
  const extraTint =
    extra === 'cap' ? (OUTFIT_HEX[(look.outfitColor + 3) % wheel] ?? null)
    : extra === 'scarf' ? (OUTFIT_HEX[(look.outfitColor + 6) % wheel] ?? null)
    : null;   // glasses and earrings keep their own colour

  return { wearing, parts, extra, extraTint };
}

/**
 * How broad to draw somebody, from the build they chose.
 *
 * The pack ships one figure per gender, so build is a scale rather than a mesh -- the
 * same three numbers the capsule renderer used, so nobody's agent changes shape on the
 * day this lands. Height is left alone: people who differ in height at this scale read
 * as being at different distances, which is worse than them all being the same.
 */
export const BUILD_SCALE: readonly (readonly [number, number, number])[] = [
  [0.92, 1, 0.92],
  [1, 1, 1],
  [1.1, 1, 1.08],
];

export const buildScale = (look: Look) => BUILD_SCALE[look.body] ?? BUILD_SCALE[1]!;

/** The two clips in the file. A person is either going somewhere or they are not. */
export const clipFor = (moving: boolean) => (moving ? 'walk' : 'idle');
