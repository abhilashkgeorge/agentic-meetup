/**
 * The timing of the "You both said yes" moment. Plain, so it can be tested without a
 * phone (build list item 12: the reveal as a moment -- design only, no new data).
 *
 * Three beats: the two characters slide in from the edges and meet; they give one soft
 * pop together; then the words and the button rise. With the phone's reduce-motion
 * setting on, everything is simply there -- a moment should not cost anybody their
 * comfort.
 */
export interface MomentPlan {
  /** The two characters travelling in from the sides. */
  slideMs: number;
  /** One soft pop when they meet. */
  popMs: number;
  /** The words and the button rising, after the pop. */
  textMs: number;
  /** How far in from each edge the characters start, as a share of the screen width. */
  startShare: number;
}

export const momentPlan = (reduceMotion: boolean): MomentPlan =>
  reduceMotion
    ? { slideMs: 0, popMs: 0, textMs: 0, startShare: 0 }
    : { slideMs: 650, popMs: 320, textMs: 420, startShare: 0.36 };

/** The words, the same for everybody: nothing about how the two will get on. */
export const MOMENT_TITLE = 'You both said yes';
export const momentLine = (name: string | null | undefined): string =>
  `${name || 'They'} can message you now, and nobody else can.`;
