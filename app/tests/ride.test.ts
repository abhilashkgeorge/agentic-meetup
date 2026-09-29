/**
 * The car ride to somebody who said yes: in order, never through you, and you arrive
 * beside them facing them.
 *
 * Negative control, run by hand and recorded in the commit: show you during the drive
 * -> "you are in the car while it drives" fails.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVE, DOOR, MAX_DRIVE, MIN_DRIVE, besideThem, driveTime, rideAt, rideLength, type Ride } from '../src/features/world/ride';

const ride: Ride = { from: [0, 0], to: [10, 0], start: 100 };

describe('the ride', () => {
  it('goes through its phases in order, and ends', () => {
    const seen: string[] = [];
    for (let t = 100; t <= 100 + rideLength(ride) + 0.5; t += 0.05) {
      const ph = rideAt(ride, t).phase;
      if (seen[seen.length - 1] !== ph) seen.push(ph);
    }
    expect(seen).toEqual(['arriving', 'boarding', 'driving', 'alighting', 'departing', 'done']);
  });

  it('you are in the car while it drives, and out of it either end', () => {
    for (let t = 100; t <= 100 + rideLength(ride); t += 0.05) {
      const f = rideAt(ride, t);
      if (f.phase === 'driving') {
        expect(f.you.visible, `you walk beside the car at ${t}`).toBe(false);
        expect(f.you).toMatchObject({ x: f.car.x, z: f.car.z });
        expect(f.follow).toEqual([f.car.x, f.car.z]);
      }
      if (f.phase === 'arriving') expect(f.you).toMatchObject({ x: 0, z: 0, visible: true });
      if (f.phase === 'departing' || f.phase === 'done') expect(f.you).toMatchObject({ x: 10, z: 0, visible: true });
    }
    expect(rideAt(ride, 100 + rideLength(ride) + 1).car.visible).toBe(false);
  });

  it('pulls up beside you, not on top of you, and points where it is going', () => {
    const f = rideAt(ride, 100 + ARRIVE + DOOR / 4);
    expect(Math.hypot(f.car.x - 0, f.car.z - 0)).toBeGreaterThan(0.2);
    expect(f.car.heading).toBeCloseTo(Math.PI / 2, 5);          // along +x
  });

  it('takes a sensible time however far', () => {
    expect(driveTime({ from: [0, 0], to: [0.1, 0], start: 0 })).toBe(MIN_DRIVE);
    expect(driveTime({ from: [0, 0], to: [500, 0], start: 0 })).toBe(MAX_DRIVE);
  });

  it('drops you a step short of them, so you arrive facing them', () => {
    const [x, z] = besideThem([0, 0], [10, 0]);
    expect(x).toBeCloseTo(9.5, 5);
    expect(z).toBeCloseTo(0, 5);
    expect(besideThem([0, 0], [0.2, 0])).toEqual([0, 0]);
  });
});
