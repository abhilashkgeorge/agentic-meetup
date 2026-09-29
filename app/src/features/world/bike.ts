/**
 * A bicycle for getting round Cubbon Park, and where a rider's body goes on it.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "get bicycles that the couples can ride on",
 * then "bicycles should also be used for travel around the park". So anybody in the
 * park can get on one, anywhere, and go faster than walking; a couple can ride side by
 * side.
 *
 * ONE SET OF NUMBERS FOR THE BIKE AND THE RIDER. The frame (bike-mesh.ts) is drawn
 * from these points, and the pedalling pose (crowd-gpu.ts ridePose) puts the rider's
 * seat on the saddle, hands on the grips and ankles over the pedals as the cranks go
 * round -- from the same points, so the two cannot drift apart. All in the character
 * model's own units (a person 1.87 tall; the crowd draws them at MODEL_SCALE x
 * PERSON), facing +z, standing on y 0, the rider's left at +x.
 *
 * PURE: no three. tests/bike.test.ts holds the baked pose to these points, and
 * park-scale.test.ts the bike to a real one's size.
 */

export const BIKE = {
  /** Wheels: a 26-inch rim, 0.62 m across, axles 1.05 m apart. */
  wheelR: 0.33,
  rearAxle: [0, 0.33, -0.55] as const,
  frontAxle: [0, 0.33, 0.5] as const,
  /** The crank's middle, how long each crank is, and how far out the pedals are. */
  bottomBracket: [0, 0.3, 0] as const,
  crank: 0.16,
  pedalX: 0.13,
  /** The top of the saddle, where the seat of the trousers sits. */
  saddle: [0, 0.9, -0.24] as const,
  /** Where each hand holds the bars (the left at +x). */
  grip: [0.24, 1.17, 0.3] as const,
  /** The head tube, top and bottom: the fork turns about it. */
  headTop: [0, 0.95, 0.4] as const,
  headBottom: [0, 0.74, 0.44] as const,
} as const;

/**
 * Where the foot's own joint rides on each pedal: in this rig that joint is at the
 * sole (a standing foot's is 2 cm off the ground), so just above the pedal's spindle,
 * and a little behind it -- the ball of the foot on the pedal.
 */
export const ANKLE_ABOVE_PEDAL = [0, 0.02, -0.04] as const;

/**
 * Where the wrist is when the hand holds a grip: above it and behind it, the hand
 * wrapping forward over the bar.
 */
export const WRIST_ON_GRIP = [0, 0.045, -0.06] as const;

/** Frames in one turn of the cranks, baked at 60 a second: a turn in 0.6 s. */
export const RIDE_FRAMES = 36;

/** How much faster than walking a bicycle goes. */
export const BIKE_PACE = 2;

/**
 * Where a pedal is, `phase` of a turn round (0: the left crank straight up), as
 * [x, y, z]. The cranks turn forward -- the top of the circle moving towards the front
 * wheel -- and the right one is half a turn behind the left.
 */
export function pedal(side: 'L' | 'R', phase: number): [number, number, number] {
  const a = (phase + (side === 'R' ? 0.5 : 0)) * Math.PI * 2;
  const [bx, by, bz] = BIKE.bottomBracket;
  return [bx + (side === 'L' ? BIKE.pedalX : -BIKE.pedalX), by + Math.cos(a) * BIKE.crank, bz + Math.sin(a) * BIKE.crank];
}

/** Where an ankle goes, over its pedal. */
export function ankleOn(side: 'L' | 'R', phase: number): [number, number, number] {
  const p = pedal(side, phase);
  return [p[0], p[1] + ANKLE_ABOVE_PEDAL[1], p[2] + ANKLE_ABOVE_PEDAL[2]];
}
