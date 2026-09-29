/**
 * What a set looks like in one word, for the two renderers that cannot show the art.
 *
 * The town draws people with the real meshes out of `people.glb`. Two places cannot:
 * the flat avatar in every list (`character-avatar.tsx`), which is a handful of Views
 * and must not start a GL context, and the capsule fallback in `canvas.tsx`, which is
 * what everybody is until the model has finished loading. Both of those have to say
 * something about what somebody is wearing, and both used to do it by testing the
 * outfit index against a magic number -- `look.outfit === 4` meaning the sari, in two
 * files, with nothing tying them together.
 *
 * Splitting the wardrobe into slots would have doubled that: a collar now comes off
 * the TOP a person chose and a skirt off their LEGS, which are different answers. So
 * the shapes live here once, as words, and both renderers read them.
 *
 * NOTHING IS IMPORTED HERE BUT THE CATALOG. It is a lookup table with tests.
 */
import { SHAVED, WARDROBE, type Look } from '@clone/shared';

export type HairKind = 'short' | 'buzz' | 'curly' | 'long' | 'bob' | 'bun' | 'ponytail' | 'mohawk' | 'bald';

/** Roughly what each hairstyle is, in `HAIRSTYLES` order (Shaved is 'bald'). */
const HAIR: readonly HairKind[] = [
  'short',      // Swept back
  'long',       // Long
  'short',      // Tousled
  'bob',        // Bob
  'buzz',       // Crew cut
  'curly',      // Spiky
  'long',       // Wavy
  'mohawk',     // Mohawk
  'short',      // Side part
  'long',       // Long (straight)
];

export type TopKind = 'plain' | 'collar' | 'straps' | 'open';

/** Roughly what each set's top has at the neck, in `WARDROBE` order. */
const TOP: readonly TopKind[] = [
  'plain',      // Tee
  'plain',      // Casual
  'collar',     // Hoodie
  'straps',     // Overalls
  'collar',     // Workwear
  'plain',      // Beach
  'plain',      // Formal
  'open',       // Punk
  'collar',     // Suit
  'collar',     // Trouser suit
];

/** The one set whose legs are a skirt rather than trousers. */
const SKIRT_LEGS = WARDROBE.indexOf('Formal');

/**
 * Facial hair, in `LOOK_LABELS.beard` order. The flat avatar is a 52-point circle, so
 * all it can say is how much of the lower face is covered.
 */
export type BeardKind = 'none' | 'jaw' | 'moustache' | 'goatee' | 'full';
const BEARD: readonly BeardKind[] = ['none', 'jaw', 'moustache', 'goatee', 'full'];

export const hairOf = (look: Look): HairKind => (look.hair === SHAVED ? 'bald' : HAIR[look.hair] ?? 'short');
export const beardOf = (look: Look): BeardKind => BEARD[look.beard] ?? 'none';
export const topOf = (look: Look): TopKind => TOP[look.top] ?? 'plain';
export const skirtOf = (look: Look): boolean => look.legs === SKIRT_LEGS;
