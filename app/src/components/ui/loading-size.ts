/**
 * How big a waiting screen's orb is (loading.tsx). Plain numbers, so they are tested
 * without a phone (tests/orb.test.ts).
 *
 * The founder (2026-10-04): "the loading animations looks not well thought out. it is very
 * small ... cover the screen with it". A 64 dp orb sat in a page of white; now it is most
 * of the screen's width, in the middle of the screen.
 */

/** A screen-filling orb: this share of the screen's width, never wider than ORB_MAX. */
export const ORB_SHARE = 0.78;
export const ORB_MAX = 360;
/** How much of the screen's height a waiting screen keeps for the orb and its words. */
export const SCREEN_SHARE = 0.72;
/** The orb of a waiting section, inside its card. */
export const SECTION_ORB = 112;

/** How big the orb is on a screen `width` x `height` dp. */
export const screenOrb = (width: number, height: number): number =>
  Math.round(Math.min(width * ORB_SHARE, height * 0.45, ORB_MAX));
