/**
 * Where the camera stands to show one character, per part being chosen.
 *
 * Pure numbers, no three: the preview (character-canvas.tsx) eases between these, and
 * tests/character-preview.test.ts holds each one to a real camera without a phone.
 */
/** What the camera frames: the whole person, or the part of them being chosen. */
export type Focus = 'body' | 'card' | 'head' | 'top' | 'legs' | 'feet' | 'bust';

/**
 * Where the camera stands and what it looks at, per focus. The model stands 1.35
 * units tall at full size (1.87 x MODEL_SCALE): eyes at about 1.22, chest 0.95, hips
 * 0.70, knees 0.40, soles 0. Measured on the Seeker's builder stage, fov 32.
 */
export const FRAMING: Record<Focus, { eye: readonly [number, number, number]; at: readonly [number, number, number] }> = {
  body: { eye: [0, 0.8, 3.9], at: [0, 0.67, 0] },
  // A small well on the You tab: the whole person, filling it.
  card: { eye: [0, 0.74, 2.75], at: [0, 0.68, 0] },
  bust: { eye: [0, 1.1, 1.75], at: [0, 1.05, 0] },
  head: { eye: [0, 1.24, 1.15], at: [0, 1.18, 0] },
  top: { eye: [0, 1.0, 2.05], at: [0, 0.93, 0] },
  legs: { eye: [0, 0.55, 2.2], at: [0, 0.42, 0] },
  feet: { eye: [0, 0.32, 1.35], at: [0, 0.1, 0] },
};
