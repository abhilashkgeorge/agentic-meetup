/**
 * M0 spike: can a free face model on this machine tell a selfie from a stranger?
 *
 * Reads every photo under PHOTO_DIR, finds faces, embeds them, and prints the
 * similarity of every pair -- same person (positive) and different people (negative)
 * -- plus milliseconds per frame. No network: models load from node_modules. No
 * database writes. Nothing is stored.
 *
 * PASS (plan): some T in [0.4, 0.7] with every positive pair >= T and every negative
 * <= T - 0.10, median <= 3 s per frame. The printed table is the evidence.
 *
 *   FACE_BACKEND=tensorflow npx tsx scripts/face-spike.ts            # tfjs-node (default)
 *   FACE_BACKEND=wasm       npx tsx scripts/face-spike.ts            # fallback
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const backend = process.env.FACE_BACKEND ?? 'tensorflow';
const humanPkg = require.resolve('@vladmandic/human');           // dist/human.node.js
const modelsDir = resolve(humanPkg, '..', '..', 'models');
const photoDir = resolve(process.env.PHOTO_DIR ?? './var/photos');

async function main() {
  if (backend === 'tensorflow') require('@tensorflow/tfjs-node');
  const { Human } = await import('@vladmandic/human');
  const human = new Human({
    backend,
    modelBasePath: pathToFileURL(modelsDir).href + '/',
    debug: false,
    filter: { enabled: false },
    face: {
      enabled: true,
      detector: { rotation: true, maxDetected: 4 },
      mesh: { enabled: true },
      iris: { enabled: false },
      description: { enabled: true },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
    },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
  });
  const t0 = Date.now();
  await human.load();
  await human.warmup();
  console.log(`backend=${human.tf.getBackend()} models=${modelsDir} load+warmup=${Date.now() - t0}ms`);

  interface Face { owner: string; file: string; embedding: number[]; yaw: number; ms: number; faces: number }
  const faces: Face[] = [];
  const times: number[] = [];
  for (const owner of await readdir(photoDir)) {
    if (owner.startsWith('.')) continue;
    for (const file of await readdir(join(photoDir, owner))) {
      if (!file.endsWith('.full.jpg')) continue;
      const buf = await readFile(join(photoDir, owner, file));
      const started = Date.now();
      const tensor = human.tf.node.decodeImage(buf, 3);
      const res = await human.detect(tensor as never);
      human.tf.dispose(tensor);
      const ms = Date.now() - started;
      times.push(ms);
      const f = res.face[0];
      const yaw = f?.rotation?.angle?.yaw ?? NaN;
      console.log(`${owner.slice(0, 8)} ${file.padEnd(46)} faces=${res.face.length} yaw=${(yaw * 180 / Math.PI).toFixed(0).padStart(4)}° ${ms}ms`);
      if (f?.embedding?.length) faces.push({ owner, file, embedding: f.embedding, yaw, ms, faces: res.face.length });
    }
  }
  times.sort((a, b) => a - b);
  console.log(`\nframes=${times.length} median=${times[Math.floor(times.length / 2)] ?? 0}ms p95=${times[Math.floor(times.length * 0.95)] ?? 0}ms`);

  const pos: number[] = [];
  const neg: number[] = [];
  console.log('\npairs (sim = similarity 0..1)');
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i]!; const b = faces[j]!;
      const sim = human.match.similarity(a.embedding, b.embedding);
      const same = a.owner === b.owner;
      (same ? pos : neg).push(sim);
      console.log(`${same ? 'SAME ' : 'DIFF '} ${a.owner.slice(0, 8)}/${a.file.slice(0, 8)} vs ${b.owner.slice(0, 8)}/${b.file.slice(0, 8)}  sim=${sim.toFixed(3)}`);
    }
  }
  const minPos = pos.length ? Math.min(...pos) : NaN;
  const maxNeg = neg.length ? Math.max(...neg) : NaN;
  console.log(`\npositives=${pos.length} min=${minPos.toFixed(3)}   negatives=${neg.length} max=${maxNeg.toFixed(3)}`);
  let verdict = 'INCONCLUSIVE (need positive pairs: two photos of one person)';
  if (pos.length && neg.length) {
    const ok = [...Array(31)].map((_, k) => 0.4 + k * 0.01).filter((T) => minPos >= T && maxNeg <= T - 0.10);
    verdict = ok.length ? `PASS  T in [${ok[0]!.toFixed(2)}, ${ok.at(-1)!.toFixed(2)}]` : 'FAIL  no threshold separates them by 0.10';
  }
  console.log(verdict);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
