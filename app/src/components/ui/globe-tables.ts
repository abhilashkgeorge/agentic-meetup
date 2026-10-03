/**
 * THE "SEARCHING" ORB AS TABLES, for the native animation driver (globe-orb.tsx).
 *
 * WHY. The town's loading screen shows while the JavaScript thread is busiest -- the app
 * starting, the 3D code loading, the city being built -- and an orb drawn from JavaScript
 * (orb-gl.tsx) stops dead then: the one place a loading animation must not. The native
 * driver keeps animating on the UI thread whatever JavaScript is doing, but it can only
 * interpolate numbers along tables and add or multiply them. The globe fits that exactly:
 *
 *   - every dot sits on a fixed lattice on the sphere, and the sphere only turns, so where
 *     a dot is on screen, how near it is, and its ink are functions of one turning angle
 *     -- a table each, sampled round one turn;
 *   - the scan is a meridian sweeping round the sphere at its own pace, so how much it
 *     lifts a dot is a function of a second angle -- one more table -- times how near the
 *     front the dot is.
 *
 * The lattice, the sizes, the inks and the two paces are the library's own
 * (vendor/thinking-orbs lattice.ts frameGlobe, at the tuned 64 design). One thing is left
 * out: the library rocks the tilt by 0.06 radians over 18 seconds; this holds it at 0.4.
 * tests/orb.test.ts compares the two at the instants their tilts agree.
 *
 * Pure: numbers only.
 */
import { resolvePreset } from '../../vendor/thinking-orbs';
import { radiusScale } from '../../vendor/thinking-orbs/core';
import { scaleCounts } from '../../vendor/thinking-orbs/profiles';

/** The library's globe: its spin, the scan's base pace, and the held tilt. */
const SPIN = 0.5;
const SCAN_BASE = 1.7;
export const GLOBE_TILT = 0.4;

const { speed: PACE, opts: O } = resolvePreset('searching', 64);

/**
 * How many more dots a big globe has than the 64 design: like orb-frame.ts densityFor,
 * but held to twice -- every dot here is a view the native driver moves each frame, and
 * twice is about 400 of them, which the Pixel 6a turns at full rate.
 */
export const globeDensity = (size: number): number => (size < 120 ? 1 : Math.min(2, 1 + (size - 120) / 200));

/** How long one turn of the sphere takes, and one sweep of the scan round it, in ms. */
export const GLOBE_TURN_MS = ((2 * Math.PI) / SPIN / PACE) * 1000;
const SCAN_RATE = (SCAN_BASE - SPIN) * (O.scanMul ?? 1);
export const GLOBE_SWEEP_MS = ((2 * Math.PI) / SCAN_RATE / PACE) * 1000;

/** Samples round a turn, and round a sweep: fine enough that the straight runs between them never show. */
export const TURN_SAMPLES = 48;
export const SWEEP_SAMPLES = 64;

export interface GlobeDot {
  /** Where on the sphere. */
  lat: number;
  lon: number;
  /** Round one turn (0 to 1, TURN_SAMPLES + 1 values, the last equal to the first): */
  x: number[];
  y: number[];
  /** The dot's radius before the scan lifts it. */
  r: number[];
  /** How far to the front, 0 at the rim and behind -- what the scan's lift is multiplied by. */
  front: number[];
  /** The ink's strength: how dark on a light page, how bright on a dark one (1 - the library's `white`). */
  ink: number[];
  /** Round one sweep (0 to 1, SWEEP_SAMPLES + 1 values): how close the scan is, 0 to 1. */
  scan: number[];
}

export interface Globe {
  size: number;
  dots: GlobeDot[];
  /** The scan's lift: radius += rLift * scan * front. */
  rLift: number;
  /** Alpha = dimBase + (1 - dimBase) * scan * front. */
  dimBase: number;
  /** The largest a dot gets: each is drawn this big and scaled down. */
  rMax: number;
  /** Radii never go below this (the library's floor). */
  rMin: number;
}

const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Where a point of the sphere is on screen at `yaw`, and how near (z, -1 back to 1 front). */
export function globePoint(lat: number, lon: number, yaw: number, size: number): [number, number, number] {
  const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y1 = y * Math.cos(GLOBE_TILT) - z1 * Math.sin(GLOBE_TILT);
  const z2 = y * Math.sin(GLOBE_TILT) + z1 * Math.cos(GLOBE_TILT);
  const radius = (size / 2) * 0.82;
  return [size / 2 + x1 * radius, size / 2 - y1 * radius, z2];
}

/** The globe `size` dp across, as tables. */
export function globeTables(size: number, density = globeDensity(size)): Globe {
  const o = density === 1 ? O : scaleCounts(O, density);
  const rs = radiusScale(size, O.rsPow ?? 0.6);
  const rBase = O.rBase ?? 0.6, rDepth = O.rDepth ?? 1.7, rBoost = O.rBoost ?? 1;
  const inkFar = O.inkFar ?? 0.62, inkSpan = O.inkSpan ?? 0.54;
  const latRings = o.latRings ?? 17, lonDensity = o.lonDensity ?? 44;
  const dots: GlobeDot[] = [];
  for (let li = 0; li <= latRings; li++) {
    const lat = -Math.PI / 2 + (li / latRings) * Math.PI;
    const lonCount = Math.max(1, Math.round(Math.abs(Math.cos(lat)) * lonDensity));
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * 2 * Math.PI;
      const d: GlobeDot = { lat, lon, x: [], y: [], r: [], front: [], ink: [], scan: [] };
      for (let k = 0; k <= TURN_SAMPLES; k++) {
        const [px, py, z] = globePoint(lat, lon, (k / TURN_SAMPLES) * 2 * Math.PI, size);
        const depth = (z + 1) / 2;
        d.x.push(px);
        d.y.push(py);
        d.r.push((rBase + rDepth * depth) * rs);
        d.front.push(Math.max(0, z));
        d.ink.push(1 - Math.min(1, Math.max(0, inkFar - inkSpan * depth)));
      }
      for (let k = 0; k <= SWEEP_SAMPLES; k++) {
        // The scan meridian, in the sphere's own longitude, goes round at SCAN_RATE.
        const delta = angleDelta(lon, (k / SWEEP_SAMPLES) * 2 * Math.PI);
        d.scan.push(Math.exp(-(delta * delta) / 0.18));
      }
      dots.push(d);
    }
  }
  return {
    size, dots, rLift: rBoost * rs, dimBase: O.dimBase ?? 1,
    rMax: (rBase + rDepth + rBoost) * rs, rMin: O.rMin ?? 0.3,
  };
}

/** Where the turn and the sweep are at `t` seconds of the library's own clock (its time, before the preset's pace). */
export function globePhases(t: number): { turn: number; sweep: number } {
  const frac = (x: number) => x - Math.floor(x);
  return { turn: frac((t * SPIN) / (2 * Math.PI)), sweep: frac((t * SCAN_RATE) / (2 * Math.PI)) };
}

/** A table read the way the native driver reads it: straight lines between samples. */
export function sampleAt(table: readonly number[], phase: number): number {
  const n = table.length - 1;
  const at = Math.min(n, Math.max(0, phase * n));
  const i = Math.min(n - 1, Math.floor(at));
  return table[i]! + (table[i + 1]! - table[i]!) * (at - i);
}
