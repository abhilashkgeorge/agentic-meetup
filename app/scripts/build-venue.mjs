/**
 * Build the free art shipped with the first walkable date venue.
 *
 * Source: "Park Furnitures" by loafbrr, published under CC0. The archive contains
 * Blender, engine and large texture sources; the supplied GLB is already a compact
 * 752 KB, one-material library. We ship only that GLB and instantiate a small subset
 * of its meshes at runtime, so the source's forty-five objects do not become
 * forty-five draw calls.
 *
 * Run from app/:
 *   node scripts/build-venue.mjs
 *   node scripts/build-venue.mjs --offline
 */
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const CACHE = join(APP, '.venue-cache');
const SOURCE = join(CACHE, 'source');
const OUT = join(APP, 'assets', 'venues', 'cubbon-park');
const ARCHIVE = join(CACHE, 'parkfurnitures.zip');
const SOURCE_GLB = join(SOURCE, 'glb', 'parkfurnitures.glb');
const SOURCE_README = join(SOURCE, 'README.txt');
const URL = 'https://opengameart.org/sites/default/files/parkfurnitures.zip';
const PAGE = 'https://opengameart.org/content/park-furniture';
const OFFLINE = process.argv.includes('--offline');
const MAX_BYTES = 1_000_000;
const MAX_TRIANGLES = 20_000;

async function download() {
  if (existsSync(ARCHIVE) && statSync(ARCHIVE).size > 0) return;
  if (OFFLINE) throw new Error(`${ARCHIVE} is missing in --offline mode`);
  mkdirSync(CACHE, { recursive: true });
  const r = await fetch(URL);
  if (!r.ok) throw new Error(`${r.status} downloading ${URL}`);
  writeFileSync(ARCHIVE, Buffer.from(await r.arrayBuffer()));
}

await download();
if (!existsSync(SOURCE_GLB) || !existsSync(SOURCE_README)) {
  mkdirSync(SOURCE, { recursive: true });
  execFileSync('unzip', ['-o', ARCHIVE, 'glb/parkfurnitures.glb', 'README.txt', '-d', SOURCE], { stdio: 'inherit' });
}

const bytes = readFileSync(SOURCE_GLB);
const gltf = await new Promise((resolve, reject) =>
  new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));

const meshes = [];
let triangles = 0;
gltf.scene.traverse((o) => {
  if (!o.isMesh) return;
  const tris = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  triangles += tris;
  meshes.push({ name: o.name, triangles: Math.round(tris) });
});

for (const required of ['ParkFurn_Bench_A', 'ParkFurn_Lamp_A', 'ParkFurn_TrashCan_C', 'ParkFurn_Table_I']) {
  if (!meshes.some((m) => m.name === required)) throw new Error(`source pack lost required mesh ${required}`);
}
if (bytes.byteLength > MAX_BYTES) throw new Error(`venue source is ${bytes.byteLength} bytes; budget is ${MAX_BYTES}`);
if (triangles > MAX_TRIANGLES) throw new Error(`venue source is ${triangles} triangles; budget is ${MAX_TRIANGLES}`);

mkdirSync(OUT, { recursive: true });
copyFileSync(SOURCE_GLB, join(OUT, 'furniture.glb'));
const sourceNotice = readFileSync(SOURCE_README, 'utf8').trim();
writeFileSync(join(OUT, 'LICENCE.txt'),
  `Park Furnitures by loafbrr\n${PAGE}\n\n${sourceNotice}\n\n` +
  'CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/\n');
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({
  id: 'cubbon-park',
  source: PAGE,
  download: URL,
  license: 'CC0-1.0',
  file: 'furniture.glb',
  bytes: bytes.byteLength,
  sourceMeshes: meshes.length,
  sourceTriangles: Math.round(triangles),
  runtime: {
    meshes: ['ParkFurn_Bench_A', 'ParkFurn_Lamp_A', 'ParkFurn_TrashCan_C', 'ParkFurn_Table_I'],
    maxDrawCalls: 4,
    maxTriangles: 20_000,
  },
}, null, 2)}\n`);

console.log(`Cubbon Park furniture: ${Math.round(bytes.byteLength / 1024)} KB, ${meshes.length} source meshes, ${Math.round(triangles)} triangles`);
