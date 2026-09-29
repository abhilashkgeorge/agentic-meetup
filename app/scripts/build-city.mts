/**
 * Write the city round Cubbon Park -- its road, pavements, buildings and traffic lanes
 * -- to assets/venues/cubbon-park/city.json, from the park's outline.
 *
 *     npx tsx scripts/build-city.mts
 *
 * The plan is city-plan.ts, pure and seeded; this only runs it and writes it down, so
 * the phone reads a file rather than working out a distance field on the way into the
 * park. tests/city-plan.test.ts fails if the file and a fresh plan ever disagree.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planCity } from '../src/features/world/city-plan';
import { makeCubbon } from '../src/features/world/cubbon';
import { APP } from './raster.mts';

const t0 = Date.now();
const plan = planCity(makeCubbon().outline);
const out = join(APP, 'assets', 'venues', 'cubbon-park', 'city.json');
writeFileSync(out, JSON.stringify(plan));
const pts = (rs: { outer: unknown[]; holes: unknown[][] }[]) => rs.reduce((n, r) => n + r.outer.length + r.holes.reduce((m, h) => m + h.length, 0), 0);
console.log(`city.json: ${plan.road.length} road rings (${pts(plan.road)} points), ${plan.pavement.length} pavement rings, `
  + `lanes of ${plan.lanes.map((l) => l.loop.length).join(' and ')} points, ${plan.buildings.length} buildings, in ${Date.now() - t0} ms`);
