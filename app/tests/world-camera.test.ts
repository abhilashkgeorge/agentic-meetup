/**
 * The isometric camera's maths, with no renderer: where the ground lands on the
 * screen and back, and that a drag, a pinch and a fly do what a thumb expects.
 *
 * Negative controls, run by hand: replace √6 with √2 in toScreenOffset's second
 * component (drop the foreshortening) -> the vertical drag and the pinch tests fail;
 * drop the zoomMax clamp in pinch -> the clamp test fails.
 */
import { describe, expect, it } from 'vitest';
import {
  CITY_ELEVATION, ISO_VERTICAL, STREET_ELEVATION, WALK_AIM, WALK_BACK, WALK_RISE, ZOOM_MAX,
  bandOf, cityPose, clampTarget, driveVector, elevationFor, eyeOffset, flyAt, followPose,
  fromScreen, pan, pinch, tileZoom, toScreen, turnToward, verticalOf, type Pose,
} from '../src/features/world/camera';
import { MAP } from '../src/features/world/map';

const size = { width: 390, height: 800 };
const pose: Pose = { tx: 3, tz: -2, zoom: 30 };

describe('the isometric map', () => {
  it('puts the target at the screen centre and screen-right at (1,0,-1)/√2', () => {
    expect(toScreen(pose.tx, pose.tz, pose, size)).toEqual([195, 400]);
    const [px, py] = toScreen(pose.tx + 1 / Math.SQRT2, pose.tz - 1 / Math.SQRT2, pose, size);
    expect(px).toBeCloseTo(195 + 30, 6);
    expect(py).toBeCloseTo(400, 6);
    // Up the screen is (-1, 0, -1)/√2, foreshortened to 0.577 of a unit.
    const [ux, uy] = toScreen(pose.tx - 1 / Math.SQRT2, pose.tz - 1 / Math.SQRT2, pose, size);
    expect(ux).toBeCloseTo(195, 6);
    expect(uy).toBeCloseTo(400 - 30 * (2 / Math.sqrt(12)), 6);
    // And back.
    const [x, z] = fromScreen(px, py, pose, size);
    expect(x).toBeCloseTo(pose.tx + 1 / Math.SQRT2, 9); expect(z).toBeCloseTo(pose.tz - 1 / Math.SQRT2, 9);
  });

  it('keeps the ground under the finger through a drag, sideways and up', () => {
    for (const [dx, dy] of [[57, 0], [0, -80], [-30, 45]] as const) {
      const under = fromScreen(120, 300, pose, size);
      const moved = pan(pose, dx, dy);
      const [px, py] = toScreen(under[0], under[1], moved, size);
      expect(px).toBeCloseTo(120 + dx, 6);
      expect(py).toBeCloseTo(300 + dy, 6);
      expect(moved.zoom).toBe(pose.zoom);
    }
  });

  it('keeps the ground under the fingers\' midpoint through a pinch, and clamps the zoom', () => {
    const mid: [number, number] = [250, 520];
    const under = fromScreen(mid[0], mid[1], pose, size);
    const zoomed = pinch(pose, mid, 1.3, size, 8);
    expect(zoomed.zoom).toBeCloseTo(39, 9);
    const [px, py] = toScreen(under[0], under[1], zoomed, size);
    expect(px).toBeCloseTo(mid[0], 6); expect(py).toBeCloseTo(mid[1], 6);
    expect(pinch(pose, mid, 100, size, 8).zoom).toBe(ZOOM_MAX);
    expect(pinch(pose, mid, 0.01, size, 8).zoom).toBe(8);
  });

  it('holds the target over the city', () => {
    const b = { minX: -10, maxX: 10, minZ: -5, maxZ: 5 };
    expect(clampTarget({ tx: 40, tz: -40, zoom: 30 }, b)).toEqual({ tx: 10, tz: -5, zoom: 30 });
    expect(clampTarget(pose, b)).toEqual(pose);
  });

  it('fits the whole outline between the HUD insets at the city pose', () => {
    const insets = { top: 140, bottom: 120, side: 12 };
    const city = cityPose(MAP.outline, size, insets);
    expect(city.zoom).toBeGreaterThan(3); expect(city.zoom).toBeLessThan(12);
    for (const [x, z] of MAP.outline) {
      const [px, py] = toScreen(x, z, city, size);
      expect(px).toBeGreaterThanOrEqual(insets.side - 1e-6); expect(px).toBeLessThanOrEqual(size.width - insets.side + 1e-6);
      expect(py).toBeGreaterThanOrEqual(insets.top - 1e-6); expect(py).toBeLessThanOrEqual(size.height - insets.bottom + 1e-6);
    }
    expect(bandOf(city.zoom, city.zoom)).toBe('city');
    expect(bandOf(city.zoom * 1.5, city.zoom)).toBe('mid');
    expect(bandOf(30, city.zoom), 'over the neighbourhood').toBe('mid');
    expect(bandOf(150, city.zoom), 'down in the streets').toBe('near');
    expect(tileZoom(5, size)).toBe(30);
    expect(tileZoom(14, size), 'a huge tile still shows people').toBe(18);
    expect(tileZoom(1, size), 'a tiny tile is never closer than the cap').toBe(30);
  });

  it('flies out of the start, eases, and lands exactly on the target at the end', () => {
    // Times that are exact in floating point: 10.5 - 10 is 0.5, 10.6 - 10 is not 0.6.
    const fly = { from: pose, to: { tx: 20, tz: 15, zoom: 6 }, start: 10, secs: 0.5 };
    expect(flyAt(fly, 10).pose).toEqual(pose);
    const mid = flyAt(fly, 10.25);
    expect(mid.done).toBe(false);
    expect(mid.pose.tx).toBeGreaterThan(pose.tx); expect(mid.pose.tx).toBeLessThan(20);
    // Ease-out: more than half the way at half the time.
    expect((mid.pose.tx - pose.tx) / (20 - pose.tx)).toBeGreaterThan(0.5);
    const end = flyAt(fly, 10.5);
    expect(end.done).toBe(true);
    expect(end.pose).toEqual(fly.to);
    expect(flyAt(fly, 12).pose).toEqual(fly.to);
  });

  it('tips from a map to a game camera as you zoom in, and back', () => {
    // Control: return CITY_ELEVATION whatever the zoom -> the street view goes back to
    // the top-down map the founder complained about, and this test's middle case fails.
    const city = 7;
    expect(elevationFor(city, city)).toBeCloseTo(CITY_ELEVATION, 9);
    expect(elevationFor(city / 3, city), 'further out than the city still reads as a map').toBeCloseTo(CITY_ELEVATION, 9);
    expect(elevationFor(200, city), 'right down in the streets').toBeCloseTo(STREET_ELEVATION, 9);
    const mid = elevationFor(30, city);
    expect(mid).toBeLessThan(CITY_ELEVATION);
    expect(mid).toBeGreaterThan(STREET_ELEVATION);
    // A lower angle flattens the screen: a step away from the camera covers less height.
    expect(verticalOf(STREET_ELEVATION)).toBeLessThan(verticalOf(CITY_ELEVATION));
    expect(verticalOf(CITY_ELEVATION)).toBeCloseTo(ISO_VERTICAL, 12);
    expect(ISO_VERTICAL).toBeCloseTo(1 / Math.sqrt(6), 12);
  });

  it('puts the eye on the diagonal at the angle it was given, at the distance it was given', () => {
    for (const elev of [CITY_ELEVATION, STREET_ELEVATION, 0.9]) {
      const [x, y, z] = eyeOffset(elev, 220);
      expect(Math.hypot(x, y, z)).toBeCloseTo(220, 9);
      expect(x, 'the compass bearing never changes, only the height').toBeCloseTo(z, 12);
      expect(Math.atan2(y, Math.hypot(x, z))).toBeCloseTo(elev, 9);
    }
    // The isometric angle is the familiar equal-thirds eye.
    const [ix, iy] = eyeOffset(CITY_ELEVATION, Math.sqrt(3));
    expect(ix).toBeCloseTo(1, 9); expect(iy).toBeCloseTo(1, 9);
  });

  it('keeps the ground under the finger at the flatter street angle too', () => {
    const vert = verticalOf(STREET_ELEVATION);
    const street: Pose = { tx: 3, tz: -2, zoom: 85 };
    for (const [dx, dy] of [[57, 0], [0, -80], [-30, 45]] as const) {
      const under = fromScreen(120, 300, street, size, vert);
      const moved = pan(street, dx, dy, vert);
      const [px, py] = toScreen(under[0], under[1], moved, size, vert);
      expect(px).toBeCloseTo(120 + dx, 6);
      expect(py).toBeCloseTo(300 + dy, 6);
    }
    const mid: [number, number] = [250, 520];
    const at = fromScreen(mid[0], mid[1], street, size, vert);
    const zoomed = pinch(street, mid, 1.4, size, 7, ZOOM_MAX, vert);
    const [px, py] = toScreen(at[0], at[1], zoomed, size, vert);
    expect(px).toBeCloseTo(mid[0], 6); expect(py).toBeCloseTo(mid[1], 6);
  });

  it('sends the stick where the camera is looking, not where the agent is facing', () => {
    // Control: swap the screen-right vector for the (cos, -sin) the right-hand rule
    // suggests and the left/right cases come out mirrored.
    const near = (a: readonly number[], b: readonly number[]) =>
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
    // Facing +z: up the stick is +z, right is -x (three builds its basis that way).
    near(driveVector(0, -1, 0), [0, 1]);
    near(driveVector(1, 0, 0), [-1, 0]);
    // Turned a quarter: up is +x.
    near(driveVector(0, -1, Math.PI / 2), [1, 0]);
    near(driveVector(1, 0, Math.PI / 2), [0, 1]);
    // Half a turn back on itself.
    near(driveVector(0, -1, Math.PI), [0, -1]);
    // A stick held on the diagonal keeps its length.
    const d = driveVector(0.6, -0.8, 1.1);
    expect(Math.hypot(d[0], d[1])).toBeCloseTo(1, 9);
  });

  it('puts the camera behind the shoulder and looks past them down the street', () => {
    const { eye, look } = followPose(4, -2, 0);
    expect(eye[0]).toBeCloseTo(4, 9);
    expect(eye[2]).toBeCloseTo(-2 - WALK_BACK, 9);     // behind somebody facing +z
    expect(eye[1]).toBeCloseTo(WALK_RISE, 9);           // and above them
    expect(look[2]).toBeCloseTo(-2 + WALK_AIM, 9);      // looking past them
    expect(look[1]).toBeLessThan(eye[1]);               // slightly down
    // Turned round, it is on the other side.
    const behind = followPose(0, 0, Math.PI).eye;
    expect(behind[2]).toBeCloseTo(WALK_BACK, 9);
    // Pulled in against a wall, it comes closer and rides higher.
    const tight = followPose(0, 0, 0, 0.1, 0.9, 0.3);
    expect(Math.hypot(tight.eye[0], tight.eye[2])).toBeCloseTo(0.1, 9);
    expect(tight.eye[1]).toBe(0.9);
  });

  it('turns the short way round and stays inside one turn', () => {
    // Control: drop the wrap and this climbs past seven radians instead of settling.
    const wrapped = (a: number) => a > -Math.PI - 1e-9 && a < Math.PI + 1e-9;
    expect(turnToward(3.0, -3.0, 1)).toBeCloseTo(-3.0, 9);      // over the seam, not the long way
    expect(turnToward(-3.0, 3.0, 1)).toBeCloseTo(3.0, 9);
    expect(turnToward(0, 1, 0.5)).toBeCloseTo(0.5, 9);          // halfway
    expect(turnToward(1, 1, 1)).toBeCloseTo(1, 9);              // already there
    let a = 0;
    for (let i = 0; i < 400; i++) { a = turnToward(a, a + 2.5, 1); expect(wrapped(a)).toBe(true); }
  });
});
