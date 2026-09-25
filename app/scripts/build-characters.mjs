/**
 * Build the character asset the app ships.
 *
 * The people in the town were capsules with a bob, which is why the founder said the
 * app looked worse than a demo with a walking samurai in it (2026-09-22). This turns
 * Quaternius' free modular characters into two files the renderer can use.
 *
 * WHERE THE ART COMES FROM. quaternius.com, "Ultimate Modular Men" and "Ultimate
 * Modular Women". The pack pages carry a CC0 badge and the site licence (QAL v1.0)
 * allows commercial use with no credit; neither lets anybody resell the raw models,
 * which is not something we do. The licence text SHIPPED WITH THE PACK is downloaded
 * alongside the art and written next to the built asset, so what we agreed to on the
 * day is recorded rather than remembered.
 *
 * WHY A BUILD STEP AT ALL. Each outfit is published as a 3 MB glTF carrying all 24 of
 * the pack's animations -- twenty-two of which are gun, sword and death clips we will
 * never play in a dating app. Shipping eleven of those is 33 MB against an assets
 * folder that is 1.6 MB today. Every outfit in a pack is rigged to the SAME skeleton,
 * bone for bone (checked below, and the build fails if that ever stops being true), so
 * one copy of the skeleton and two clips serves all of them.
 *
 * Run from `app/`:
 *     node scripts/build-characters.mjs            # fetch what is missing, then build
 *     node scripts/build-characters.mjs --offline  # cache only, no network
 *
 * Sources land in `.character-cache/` (git-ignored, ~35 MB). The built assets are
 * `assets/characters/{man,woman}.glb` and are committed.
 */

// Node has no DOM. three's FileLoader reaches for ProgressEvent when it resolves the
// data: URI that holds a glTF's buffer, and GLTFExporter uses FileReader to turn the
// binary chunk into something it can hand back. These two shims are the whole gap.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
};
globalThis.FileReader ??= class FileReader {
  constructor() { this.result = null; this.onload = null; this.onloadend = null; this.onerror = null; }
  #finish() { this.onload?.({ target: this }); this.onloadend?.({ target: this }); }
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => { this.result = b; this.#finish(); }, (e) => this.onerror?.(e));
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.#finish();
    }, (e) => this.onerror?.(e));
  }
};

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const THREE = await import('three');
const { BufferAttribute, Skeleton } = THREE;
const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const CACHE = join(APP, '.character-cache');
const OUT = join(APP, 'assets', 'characters');
const OFFLINE = process.argv.includes('--offline');

/**
 * The two packs, by the id of their published Drive folder. The folder ids come from
 * the "Just give me the Download" button on each pack page; the glTF subfolder is the
 * one export that is self-contained (its buffer is a data: URI), so a file is a file
 * rather than a .gltf plus a .bin plus a texture we would have to chase.
 */
const PACKS = {
  man: { gltf: '1qpSIycVWTwhKMgyA_bEFHPh1CfBBBa09', licence: '1TTvylHa1CsiJuHFWWiv6PFGhLM-aAH5z' },
  woman: { gltf: '1_FIjjIVE0SkQIrwgWJ3Q8NQku25ll5a2', licence: null },
};

/** The only clips a dating app plays. The pack's other 22 are combat and death. */
const CLIPS = { Walk: 'walk', Idle: 'idle' };

/**
 * Outfits we do not ship. Mostly fancy dress in a town full of people meeting for
 * coffee, plus two that nothing in the builder points at and that cost 700 KB between
 * them. Per gender, because both packs have a "Punk" and only one of them earns its
 * place. This is the lever if the asset ever goes over budget.
 */
const SKIP = {
  man: new Set(['spacesuit', 'swat', 'king', 'adventurer', 'farmer']),
  woman: new Set(['witch', 'medieval', 'scifi', 'soldier', 'adventurer', 'punk']),
};

/**
 * Budget. Measured, not guessed: the diet below takes the raw export down by about
 * 44 %, to 24 bytes a vertex -- position, a byte-packed normal, and the two skinning
 * attributes. The index is already sixteen bits. There is nothing else cheap left.
 *
 * Four and a half megabytes is a lot next to an assets folder that was 1.6 MB, and it
 * is not a lot next to the APK, which is already tens of megabytes of React Native
 * before a single character loads. It buys ten complete looks, which is what lets the
 * builder's eight outfits and eight hairstyles be distinct rather than repeated. The
 * file is read once, when the town opens, not at startup.
 *
 * If this is ever over: add an outfit to SKIP. That is roughly 400 KB a look, and it
 * is the only lever left that does not cost quality.
 */
const MAX_BYTES = 4_600_000;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.text();
}

/**
 * What is in a public Drive folder, without an API key.
 *
 * `embeddedfolderview` is the old iframe widget and still returns plain HTML with one
 * block per entry. The regular folder page is a JavaScript application and gives up
 * nothing to a fetch.
 */
async function driveList(id) {
  const html = await fetchText(`https://drive.google.com/embeddedfolderview?id=${id}#list`);
  const out = [];
  const re = /<div class="flip-entry" id="entry-([^"]+)".*?<a href="([^"]+)".*?flip-entry-title">([^<]*)</gs;
  for (const m of html.matchAll(re)) {
    out.push({ id: m[1], dir: m[2].includes('/folders/'), name: m[3].trim() });
  }
  return out;
}

async function driveDownload(id, to) {
  if (existsSync(to) && statSync(to).size > 0) return false;
  if (OFFLINE) throw new Error(`--offline but ${to} is not cached`);
  const r = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} downloading ${id}`);
  writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  return true;
}

const loadGltf = (file) => {
  const b = readFileSync(file);
  return new Promise((res, rej) =>
    new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej));
};

/**
 * Sort a character's meshes into feet, legs, body and head, BY THE NAME THE ARTIST
 * GAVE THEM.
 *
 * Every outfit in both packs is authored as exactly four named nodes -- Suit_Body,
 * Suit_Feet, Suit_Head, Suit_Legs -- so the names are the truth. They are not visible
 * on the loaded objects, because three names a mesh after the glTF MESH ("Cube204")
 * rather than the NODE that references it, but the loader keeps the link in
 * `parser.associations`, and `nodeNamer` below follows it back.
 *
 * AND ANYTHING THAT IS NOT ONE OF THE FOUR IS THROWN AWAY. That rule exists because of
 * something that really shipped: `man/Suit.gltf` also contains a node called
 * **Pistol** -- a rigged handgun, weighted into the right hand. The version of this
 * function that sorted meshes by how high off the ground they sat had no idea what it
 * was, so it filed the unexplained fifth group under "body", and every man in a suit
 * walked around the town armed. In a dating app. Nothing failed and nothing warned.
 *
 * So: match a body part or be dropped, and say out loud what was dropped.
 */
const SLOTS = ['feet', 'legs', 'body', 'head'];

/** Materials that are facial hair rather than face. See `place` and `buildBeards`. */
const FACIAL = /^(Skin_Darker|Moustache)$/i;

const SLOT_OF = [
  [/feet|shoe|boot|sandal/i, 'feet'],
  [/leg|pant|trouser|short|skirt|jean/i, 'legs'],
  [/head|hair|face/i, 'head'],
  [/body|torso|top|shirt|chest|jacket|hood|dress/i, 'body'],
];

/** The name of the glTF NODE a loaded mesh came from, not the mesh it happens to reuse. */
function nodeNamer(gltf) {
  const json = gltf.parser.json;
  const assoc = gltf.parser.associations;
  const byMesh = new Map();
  for (const n of json.nodes) if (n.mesh !== undefined && !byMesh.has(n.mesh)) byMesh.set(n.mesh, n.name);
  return (m) => {
    const a = assoc.get(m);
    if (!a) return m.name;
    if (a.nodes !== undefined) return json.nodes[a.nodes]?.name ?? m.name;
    if (a.meshes !== undefined) return byMesh.get(a.meshes) ?? m.name;
    return m.name;
  };
}

function slotGroups(meshes, label, nameOf) {
  const bySlot = new Map(SLOTS.map((s) => [s, []]));
  const junk = [];
  for (const m of meshes) {
    const node = nameOf(m) ?? m.name;
    const slot = SLOT_OF.find(([re]) => re.test(node))?.[1];
    if (!slot) { junk.push(node); continue; }
    bySlot.get(slot).push(m);
  }
  const empty = SLOTS.filter((s) => bySlot.get(s).length === 0);
  if (empty.length) {
    throw new Error(`${label}: nothing landed in ${empty.join(', ')}. ` +
      `Nodes were ${meshes.map((m) => nameOf(m)).join(', ')}.`);
  }
  return { groups: SLOTS.map((slot) => ({ slot, meshes: bySlot.get(slot) })), junk };
}

/**
 * Bones nobody can see at the size these people are drawn.
 *
 * The pack rigs every finger joint and both big toes: 38 of its 62 bones are
 * Index1L..Pinky4R plus PTL and PTR. On a phone a person in the town is about twenty
 * pixels tall, and even walking about the park they are a couple of hundred. A knuckle
 * has never been visible and never will be.
 *
 * It is not vanity work. MEASURED on a Pixel 6a: every rigged person costs about 1.7 ms
 * a frame, and the bulk of that is recomputing their bone matrices and pushing them to
 * the graphics card EVERY FRAME. Sixty-two bones times twelve people is 744 matrices a
 * frame. Cutting to twenty-four is the difference between four people with legs and
 * twice that many.
 */
const DROP_BONE = /^(Thumb|Index|Middle|Ring|Pinky)\d[LR]$|^PT[LR]$/;

/**
 * Take the finger and toe bones out, and hand their vertices to whatever they hang
 * off -- a wrist, a foot.
 *
 * THE HANDS ARE NOT DELETED. A third of the vertices in this pack are fingers; deleting
 * them would give everybody stumps. They keep every triangle they had, they just stop
 * bending, which at this distance is the same picture for a fraction of the cost.
 *
 * Three things have to move together or the result is silently wrong: the vertex
 * weights (several fingers can collapse onto one wrist, so their weights ADD), the
 * skeleton itself, and the animation tracks, which still name bones that no longer
 * exist.
 */
/**
 * Close the back of a head.
 *
 * THE WOMEN'S HEADS ARE NOT HEADS. They are faces: the artist modelled the front and
 * left the skull off, because in every look in the pack there is hair over it. Offer
 * "Bald" and you are looking through an open shell at the inside of somebody's face.
 *
 * So any hole is found and capped: an edge used by exactly one triangle is a boundary,
 * the boundaries chain into loops, and each loop gets a fan to a point pushed out
 * along its own outward direction -- which on a skull-shaped hole is a dome, and at
 * this polygon count is indistinguishable from one.
 *
 * MATCHED BY POSITION, NOT BY INDEX. A vertex on a seam is duplicated so it can carry
 * two normals, so an index-based edge count reports every seam as a hole and caps the
 * face shut.
 */
function capHoles(geometry, label) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  if (!index) return 0;

  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const at = new Map();                       // position -> one representative vertex
  const keyOf = [];
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    keyOf.push(k);
    if (!at.has(k)) at.set(k, i);
  }

  const edges = new Map();                    // "a|b" sorted -> count and one direction
  const bump = (a, b) => {
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    const e = edges.get(id);
    if (e) e.n++;
    else edges.set(id, { n: 1, a, b });
  };
  for (let t = 0; t < index.count; t += 3) {
    const k = [0, 1, 2].map((j) => keyOf[index.getX(t + j)]);
    bump(k[0], k[1]); bump(k[1], k[2]); bump(k[2], k[0]);
  }

  const open = [...edges.values()].filter((e) => e.n === 1);
  if (!open.length) return 0;

  // Chain the open edges into loops.
  const next = new Map();
  for (const e of open) {
    if (!next.has(e.a)) next.set(e.a, []);
    if (!next.has(e.b)) next.set(e.b, []);
    next.get(e.a).push(e.b);
    next.get(e.b).push(e.a);
  }
  const seen = new Set();
  const loops = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let here = start, from = null;
    while (here && !seen.has(here)) {
      seen.add(here);
      loop.push(here);
      const options = next.get(here) ?? [];
      const go = options.find((k) => k !== from && !seen.has(k));
      from = here;
      here = go;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return 0;

  const centre = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) centre.add(new THREE.Vector3().fromBufferAttribute(pos, i));
  centre.multiplyScalar(1 / pos.count);

  // One new vertex per loop, copying every attribute off a vertex already on it, so
  // the cap is weighted to the same bones and needs no special case anywhere else.
  const attrs = Object.entries(geometry.attributes);
  const add = [];
  const tris = [];
  for (const loop of loops) {
    const ids = loop.map((k) => at.get(k));
    const mid = new THREE.Vector3();
    for (const i of ids) mid.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    mid.multiplyScalar(1 / ids.length);
    let radius = 0;
    for (const i of ids) radius = Math.max(radius, mid.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i)));
    const out = mid.clone().sub(centre).normalize();

    // A DOME, NOT A CONE. A single fan to one raised point gives a skull that comes to
    // a tip, which on a bald head reads as a party hat. One intermediate ring -- pulled
    // in toward the axis and lifted part of the way -- is enough to round it off at
    // this polygon count.
    const apexAt = mid.clone().addScaledVector(out, radius * 0.62);
    const apex = pos.count + add.length;
    add.push({ from: ids[0], position: apexAt, normal: out.clone() });

    const ring = ids.map((i) => {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const on = mid.clone().addScaledVector(v.clone().sub(mid), 0.55).addScaledVector(out, radius * 0.40);
      const at = pos.count + add.length;
      add.push({ from: i, position: on, normal: on.clone().sub(centre).normalize() });
      return at;
    });

    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const wind = (p, q, r, pointAt) => {
      const face = new THREE.Vector3().subVectors(b.copy(q), a.copy(p)).cross(new THREE.Vector3().subVectors(r, a));
      return face.dot(out) >= 0 ? pointAt : [pointAt[1], pointAt[0], pointAt[2]];
    };
    const posOf = (i) => (i < pos.count
      ? new THREE.Vector3().fromBufferAttribute(pos, i)
      : add[i - pos.count].position.clone());
    for (let i = 0; i < ids.length; i++) {
      const p = ids[i], q = ids[(i + 1) % ids.length];
      const rp = ring[i], rq = ring[(i + 1) % ids.length];
      tris.push(wind(posOf(p), posOf(q), posOf(rq), [p, q, rq]));
      tris.push(wind(posOf(p), posOf(rq), posOf(rp), [p, rq, rp]));
      tris.push(wind(posOf(rp), posOf(rq), apexAt, [rp, rq, apex]));
    }
  }

  const grown = new THREE.BufferGeometry();
  for (const [name, attr] of attrs) {
    const size = attr.itemSize;
    const Arr = attr.array.constructor;
    const next = new Arr((attr.count + add.length) * size);
    next.set(attr.array, 0);
    add.forEach((made, k) => {
      const to = (attr.count + k) * size;
      for (let c = 0; c < size; c++) next[to + c] = attr.array[made.from * size + c];
      const v = name === 'position' ? made.position : name === 'normal' ? made.normal : null;
      if (v && size >= 3) { next[to] = v.x; next[to + 1] = v.y; next[to + 2] = v.z; }
    });
    grown.setAttribute(name, new BufferAttribute(next, size, attr.normalized));
  }
  const idx = [];
  for (let i = 0; i < index.count; i++) idx.push(index.getX(i));
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  grown.setIndex(idx);
  geometry.copy(grown);
  console.log(`   CAPPED ${label}: ${loops.length} hole(s), ${tris.length} triangles`);
  return tris.length;
}

function stripBones(ctx) {
  const all = ctx.skeleton.bones;
  const keep = all.filter((b) => !DROP_BONE.test(b.name));
  const dropped = all.length - keep.length;
  if (!dropped) return { before: all.length, after: keep.length, dropped: 0 };

  const keptIndex = new Map(keep.map((b, i) => [b, i]));
  // Where a dropped bone's vertices go: the first ancestor that survives. A finger's
  // parent is another finger, so this walks up the hand to the wrist.
  const heir = new Map();
  for (const b of all) {
    if (keptIndex.has(b)) continue;
    let up = b.parent;
    while (up && !keptIndex.has(up)) up = up.parent;
    if (!up) throw new Error(`${b.name} has no surviving ancestor to hand its vertices to`);
    heir.set(b, up);
  }

  let worst = 0;
  const meshes = [];
  ctx.root.traverse((m) => { if (m.isSkinnedMesh) meshes.push(m); });
  for (const m of meshes) {
    const gi = m.geometry.attributes.skinIndex;
    const gw = m.geometry.attributes.skinWeight;
    const scale = gw.normalized ? 255 : 1;
    const n = gi.count;
    const outI = new Uint8Array(n * 4);
    const outW = new Uint8Array(n * 4);
    const acc = new Map();
    for (let v = 0; v < n; v++) {
      acc.clear();
      for (let k = 0; k < 4; k++) {
        const w = gw.array[v * 4 + k];
        if (w <= 0) continue;
        const bone = all[gi.array[v * 4 + k]];
        const target = keptIndex.has(bone) ? bone : heir.get(bone);
        const at = keptIndex.get(target);
        // ADD, never overwrite: two fingers landing on one wrist must combine, or the
        // hand loses most of its weight and collapses towards the body.
        acc.set(at, (acc.get(at) ?? 0) + w);
      }
      const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      worst = Math.max(worst, acc.size);
      let sum = top.reduce((t, [, w]) => t + w, 0) || 1;
      let given = 0;
      for (let k = 0; k < top.length; k++) {
        const share = Math.round((top[k][1] / sum) * 255);
        outI[v * 4 + k] = top[k][0];
        outW[v * 4 + k] = share;
        given += share;
      }
      // Weights have to add to exactly one or the vertex shrinks towards the origin.
      if (top.length) outW[v * 4] += 255 - given;
    }
    m.geometry.setAttribute('skinIndex', new BufferAttribute(outI, 4));
    m.geometry.setAttribute('skinWeight', new BufferAttribute(outW, 4, true));
  }

  // The skeleton, rebuilt from the survivors. Their bind poses do not change, so their
  // inverse bind matrices carry over untouched.
  const inverses = keep.map((b) => ctx.skeleton.boneInverses[all.indexOf(b)].clone());
  const skeleton = new Skeleton(keep, inverses);
  for (const m of meshes) m.bind(skeleton, m.bindMatrix);
  ctx.skeleton = skeleton;

  for (const b of all) if (!keptIndex.has(b)) b.removeFromParent();

  // Tracks that drive a bone nobody has any more. Left in, three warns on every clip
  // and the exporter writes curves for nodes that are not in the file.
  const live = new Set(keep.map((b) => b.name));
  for (const clip of ctx.clips) {
    clip.tracks = clip.tracks.filter((t) => live.has(t.name.split('.')[0]));
  }
  return { before: all.length, after: keep.length, dropped, worst };
}

const triCount = (m) =>
  (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;

/**
 * Which bones a mesh actually hangs off, ignoring the wisps of weight that every
 * vertex carries towards its neighbours.
 */
function bonesOf(m) {
  const idx = m.geometry.attributes.skinIndex.array;
  const w = m.geometry.attributes.skinWeight;
  const scale = w.normalized ? 255 : 1;
  const names = new Set();
  for (let i = 0; i < idx.length; i++) {
    if (w.array[i] / scale > 0.15) names.add(m.skeleton.bones[idx[i]]?.name ?? '?');
  }
  return names;
}

/**
 * What a mesh below the neck is for, and so what colour it takes.
 *
 * Only the TOP takes the outfit colour the person chose. Trousers and shoes keep what
 * the artist gave them -- a figure painted one colour from collar to sole is what made
 * the capsules read as skittles -- and bare skin takes their skin tone. The torso is
 * told apart from the arms by the bones it hangs off: a chest is weighted to Chest and
 * Torso, a sleeve to wrists and fingers.
 */
function bodyRole(m) {
  const colour = (Array.isArray(m.material) ? m.material[0] : m.material).color.getHex();
  if (colour === SKIN_SWATCH) return 'skin';
  const bones = bonesOf(m);
  return (bones.has('Chest') || bones.has('Torso')) ? 'top' : 'plain';
}

/**
 * The pack's one skin swatch. Every head in both packs carries a mesh painted exactly
 * this colour and it is always the face, which makes finding the face trivial.
 */
const SKIN_SWATCH = 0xcead86;

/**
 * How much bigger than the face a mesh has to be before it counts as hair rather than
 * a hat or a pair of eyebrows. Checked against all twelve outfits: a mohawk is 1.9x
 * the face and the smallest real head of hair is 2.9x, while the farmer's straw hat is
 * 0.8x and the workman's helmet 1.0x. Anything under this is left its own colour,
 * which is what you want -- a hat dyed to match somebody's hair looks like a mistake.
 */
const HAIR_MIN = 1.5;

/**
 * Name the parts of a head: which one takes a skin tone, which takes a hair colour,
 * and which are left alone.
 */
function headRoles(meshes, label) {
  const tris = meshes.map((m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3);
  const colour = (m) => (Array.isArray(m.material) ? m.material[0] : m.material).color.getHex();
  const skin = meshes.findIndex((m) => colour(m) === SKIN_SWATCH);
  if (skin < 0) throw new Error(`${label}: no mesh painted the pack's skin colour, so the face cannot be found.`);

  let hair = -1;
  for (const [i, m] of meshes.entries()) {
    if (i === skin) continue;
    if (tris[i] < tris[skin] * HAIR_MIN) continue;
    if (hair < 0 || tris[i] > tris[hair]) hair = i;
  }
  return meshes.map((_, i) => (i === skin ? 'skin' : i === hair ? 'hair' : 'plain'));
}

/**
 * Make the vertex data smaller, which is the whole size problem.
 *
 * A raw outfit is 672 KB of attributes for 6,200 triangles, at 52 bytes a vertex. Two
 * of those bytes-per-vertex are pure waste and one is overkill:
 *
 * - `uv` is 8 bytes and the pack ships NO TEXTURES AT ALL (checked: 7 materials, 0
 *   maps). Colour comes from the material, and we repaint that per person anyway.
 * - `skinWeight` is four floats, 16 bytes, to store four numbers between 0 and 1.
 *   glTF allows normalised bytes for exactly this, which is 4.
 * - `normal` is three floats, 12 bytes, for a unit vector. glTF core allows normalised
 *   signed bytes, which is 4 and is plenty for a low-poly character.
 *
 * That takes a vertex from 52 bytes to 24. Nothing here is lossy in a way a person can
 * see at the size these people are drawn; the build prints the saving so it stays
 * honest, and `--fat` skips the whole thing if it is ever suspected of a rendering bug.
 */
const FAT = process.argv.includes('--fat');

function slim(geometry) {
  if (FAT) return 0;
  const before = attrBytes(geometry);
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('uv1');
  geometry.deleteAttribute('color');
  geometry.deleteAttribute('tangent');

  const n = geometry.attributes.normal;
  if (n && n.array instanceof Float32Array) {
    const packed = new Int8Array(n.count * 3);
    for (let i = 0; i < packed.length; i++) {
      packed[i] = Math.max(-127, Math.min(127, Math.round(n.array[i] * 127)));
    }
    geometry.setAttribute('normal', new BufferAttribute(packed, 3, true));
  }
  const w = geometry.attributes.skinWeight;
  if (w && w.array instanceof Float32Array) {
    const packed = new Uint8Array(w.count * 4);
    for (let v = 0; v < w.count; v++) {
      // Re-normalise after rounding: four weights have to still add up to one, or a
      // limb shrinks. The largest weight absorbs the rounding error.
      const raw = [0, 1, 2, 3].map((k) => Math.round(w.array[v * 4 + k] * 255));
      let sum = raw[0] + raw[1] + raw[2] + raw[3];
      if (sum === 0) { raw[0] = 255; sum = 255; }
      let big = 0;
      for (let k = 1; k < 4; k++) if (raw[k] > raw[big]) big = k;
      raw[big] += 255 - sum;
      for (let k = 0; k < 4; k++) packed[v * 4 + k] = Math.max(0, Math.min(255, raw[k]));
    }
    geometry.setAttribute('skinWeight', new BufferAttribute(packed, 4, true));
  }
  return before - attrBytes(geometry);
}

function attrBytes(geometry) {
  let n = geometry.index ? geometry.index.array.byteLength : 0;
  for (const a of Object.values(geometry.attributes)) n += a.array.byteLength;
  return n;
}

/** Bone names in order, which is what "the same skeleton" has to mean here. */
const boneKey = (skeleton) => skeleton.bones.map((b) => b.name).join(',');

/**
 * Read one pack and hang every outfit in it on `ctx`'s skeleton.
 *
 * The first pack read creates the rig; the second is checked against it and then
 * joins it. THE TWO PACKS SHARE A SKELETON -- 62 bones, same names, same order,
 * verified here on every build -- so a woman's head genuinely does fit a man's body
 * and the builder can mix them. That is the whole reason this is one file.
 */
async function collect(gender, pack, ctx) {
  const dir = join(CACHE, gender);
  mkdirSync(dir, { recursive: true });

  const entries = (await driveList(pack.gltf)).filter((e) => !e.dir && e.name.endsWith('.gltf'));
  if (!entries.length) throw new Error(`no glTF files listed for ${gender}`);

  const outfits = [];
  for (const e of entries) {
    const key = e.name.replace(/\.gltf$/i, '').toLowerCase();
    const skip = SKIP[gender];
    if (skip.has(key.split('_')[0]) || skip.has(key)) continue;
    const file = join(dir, e.name);
    const got = await driveDownload(e.id, file);
    outfits.push({ key, file, fetched: got });
  }
  if (!outfits.length) throw new Error(`every outfit for ${gender} was skipped`);
  outfits.sort((a, b) => a.key.localeCompare(b.key));

  const base = await loadGltf(outfits[0].file);
  if (!ctx.skeleton) {
    // This pack donates the rig and the two clips; everything after it borrows them.
    base.scene.traverse((o) => { if (o.isSkinnedMesh && !ctx.skeleton) ctx.skeleton = o.skeleton; });
    if (!ctx.skeleton) throw new Error(`${gender}: the first outfit has no skeleton`);
    ctx.root = base.scene;
    ctx.armature = ctx.skeleton.bones[0].parent ?? base.scene;
    ctx.key = boneKey(ctx.skeleton);
    ctx.from = gender;
    for (const [from, to] of Object.entries(CLIPS)) {
      const c = base.animations.find((a) => a.name === from);
      if (!c) throw new Error(`${gender}: the pack has no "${from}" clip`);
      c.name = to;
      ctx.clips.push(c);
    }
  }
  const { skeleton, armature } = ctx;
  // The first outfit's own meshes are NOT stripped here: it goes through the loop
  // below like every other outfit, which is what renames and re-parents them. (An
  // earlier version removed them up front and the loop then found nothing to place.)

  const tag = gender === 'man' ? 'm' : 'w';
  const report = [];
  const dropped = [];
  for (const o of outfits) {
    const g = o.key === outfits[0].key ? base : await loadGltf(o.file);
    const meshes = [];
    g.scene.traverse((m) => { if (m.isSkinnedMesh) meshes.push(m); });

    if (boneKey(meshes[0].skeleton) !== ctx.key) {
      throw new Error(`${gender}/${o.key}: its skeleton differs from the ${ctx.from} pack's. ` +
        `Every part sharing one rig is what makes mixing possible, so this is a hard stop.`);
    }

    const sorted = slotGroups(meshes, `${gender}/${o.key}`, nodeNamer(g));
    for (const name of sorted.junk) {
      console.log(`   DROPPED from ${tag}_${o.key}: "${name}" is not a body part`);
      dropped.push(`${tag}_${o.key}:${name}`);
    }
    const groups = sorted.groups;
    const head = groups.find((x) => x.slot === 'head').meshes;
    const below = groups.filter((x) => x.slot !== 'head').flatMap((x) => x.meshes);

    // EVERY MESH IS KEPT. An earlier build treated the second mesh in a slot as an
    // alternative and dropped it, which was wrong in the worst possible way: the body
    // slot is an ARMS mesh and a TORSO mesh, so throwing away the second left people
    // walking about with no chest and two floating sleeves. There are no alternatives
    // in this pack -- a slot's meshes are the pieces the slot is made of.
    const headRole = headRoles(head, `${gender}/${o.key}`);
    const entries = [];
    let tris = 0;
    let saved = 0;

    const place = (m, name, role, slot, from) => {
      m.name = name;
      m.visible = false;                       // the renderer shows the ones it wants
      // Before slimming, while the attributes are still plain floats: give any head
      // that is only a face the back of its skull, or Bald is a look inside it.
      if (slot === 'head' && role === 'skin') capHoles(m.geometry, name);
      saved += slim(m.geometry);
      m.removeFromParent();
      m.bind(skeleton, m.bindMatrix);          // one skeleton drives every outfit
      armature.add(m);
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      // FACIAL HAIR IS NOT PART OF A HEAD ANY MORE. Two heads carry it baked in -- a
      // patch of darker skin over the casual head's jaw and a real moustache on the
      // worker -- so whoever picked those heads had a beard they never chose, and
      // "Clean" in the beard rail was a five o'clock shadow. They stay in the model,
      // because `buildBeards` cuts every beard out of them, but they are no longer
      // part of the head anybody wears.
      const facial = FACIAL.test(m.material?.name ?? '');
      entries.push({ mesh: name, role, slot, from, facial });
    };

    // One top, not three. A suit is a jacket AND a shirt AND a tie, all of them
    // weighted to the chest; painting all three the chosen colour makes a person one
    // flat slab. The biggest is the coat, and the coat is what somebody means when
    // they pick a colour -- the rest keeps what the artist chose.
    const roles = below.map(bodyRole);
    let biggestTop = -1;
    below.forEach((m, i) => {
      if (roles[i] !== 'top') return;
      if (biggestTop < 0 || triCount(m) > triCount(below[biggestTop])) biggestTop = i;
    });
    roles.forEach((r, i) => { if (r === 'top' && i !== biggestTop) roles[i] = 'plain'; });
    // WHICH SLOT A PIECE IS FOR IS KEPT, NOT THROWN AWAY. The classifier already knows
    // -- it has to, to tell a shoe from a hat -- and until now the answer was used to
    // order the meshes and then dropped, so a look could only be worn whole. Keeping it
    // is what lets somebody wear one outfit's boots with another's coat.
    const slotOfMesh = new Map();
    for (const g of groups) for (const m of g.meshes) slotOfMesh.set(m, g.slot);
    const nameOf = nodeNamer(g);
    below.forEach((m, i) => place(m, `${tag}_${o.key}_b${i + 1}`, roles[i], slotOfMesh.get(m), nameOf(m) ?? m.name));
    head.forEach((m, i) => place(m, `${tag}_${o.key}_h${i + 1}`, headRole[i], 'head', nameOf(m) ?? m.name));

    report.push({ outfit: `${tag}_${o.key}`, entries, tris: Math.round(tris), saved, fetched: o.fetched });
  }

  return { gender, report, dropped };
}

/**
 * Facial hair, cut out of the face the artist already drew.
 *
 * THE PACK HAS NO BEARDS. It has exactly two pieces of the right shape: a 44-triangle
 * patch of darker skin over the jaw and cheeks that the men's casual head wears as a
 * five o'clock shadow (`Skin_Darker`), and a real 120-triangle moustache on the
 * worker. Both are modelled ON the face and weighted to the head bone, so they sit
 * where facial hair sits on every head in the pack -- the men all share one skull.
 *
 * So the beards are those two pieces, filtered by region and pushed a millimetre or
 * two out along their own normals so they read as hair sitting ON the skin rather
 * than as a stain in it. Nothing is modelled by hand and nothing is downloaded.
 *
 * They are built BEFORE `stripBones`, so their weights get remapped with everybody
 * else's.
 */
const BEARDS = [
  // [name, [source, region, how far proud], ...]
  ['beard_stubble', [['jaw', (c) => c.y < 0.10, 0.002]]],
  ['beard_moustache', [['mo', () => true, 0.002]]],
  ['beard_goatee', [
    ['jaw', (c) => c.y < 0.055 && Math.abs(c.x) < 0.055, 0.005],
    ['mo', () => true, 0.004],
  ]],
  ['beard_full', [
    ['jaw', (c) => c.y < 0.10, 0.009],
    ['mo', () => true, 0.005],
  ]],
];

function buildBeards(ctx) {
  const byName = new Map();
  ctx.armature.traverse((o) => { if (o.isSkinnedMesh) byName.set(o.name, o); });
  const source = { jaw: byName.get('m_casual_2_h2'), mo: byName.get('m_worker_h4') };
  for (const [key, mesh] of Object.entries(source)) {
    if (!mesh) throw new Error(`the beards need ${key}, which is not in the model any more`);
  }

  const head = ctx.skeleton.bones.findIndex((b) => b.name === 'Head');
  if (head < 0) throw new Error('no Head bone to hang a beard off');
  const toHead = ctx.skeleton.boneInverses[head];

  const made = [];
  for (const [name, recipe] of BEARDS) {
    const pieces = [];
    for (const [from, keep, proud] of recipe) {
      const src = source[from];
      const g = src.geometry;
      const pos = g.attributes.position, nrm = g.attributes.normal;
      const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const index = g.index;
      const count = index ? index.count : pos.count;

      const P = [], N = [], SI = [], SW = [];
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const mid = new THREE.Vector3();
      for (let t = 0; t < count; t += 3) {
        const ids = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k));
        a.fromBufferAttribute(pos, ids[0]).applyMatrix4(src.bindMatrix).applyMatrix4(toHead);
        b.fromBufferAttribute(pos, ids[1]).applyMatrix4(src.bindMatrix).applyMatrix4(toHead);
        c.fromBufferAttribute(pos, ids[2]).applyMatrix4(src.bindMatrix).applyMatrix4(toHead);
        mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        if (!keep(mid)) continue;
        for (const id of ids) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, id);
          const n = new THREE.Vector3().fromBufferAttribute(nrm, id).normalize();
          v.addScaledVector(n, proud);
          P.push(v.x, v.y, v.z);
          N.push(n.x, n.y, n.z);
          for (let k = 0; k < 4; k++) { SI.push(si.getComponent(id, k)); SW.push(sw.getComponent(id, k)); }
        }
      }
      if (!P.length) throw new Error(`${name}: the ${from} region is empty, so nothing would be drawn`);
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      // The same integer width the source uses, for the same merge reason.
      const Index = src.geometry.attributes.skinIndex.array.constructor;
      out.setAttribute('skinIndex', new THREE.BufferAttribute(Index.from(SI), 4));
      out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
      // AND INDEXED, because every other mesh in the pack is. `mergeGeometries` wants
      // an index attribute on all of its inputs or on none, so a bare triangle soup
      // here is a person who silently loses their whole body, not just their beard.
      out.setIndex(Array.from({ length: P.length / 3 }, (_, i) => i));
      // PACKED THE SAME WAY AS EVERYTHING ELSE. A dressed person is one merged
      // geometry, and `mergeGeometries` refuses a set whose attributes are different
      // types -- so a beard built with float normals against a body with byte ones
      // merges into nothing at all, at run time, with a warning and no beard.
      slim(out);
      pieces.push(out);
    }
    const geo = pieces.length === 1 ? pieces[0] : mergeGeometries(pieces, false);
    if (!geo) throw new Error(`${name}: the pieces would not merge`);
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x3b2a20 }));
    mesh.name = name;
    mesh.visible = false;
    mesh.bind(ctx.skeleton, source.jaw.bindMatrix);
    ctx.armature.add(mesh);
    made.push({ mesh: name, tris: geo.attributes.position.count / 3 });
  }
  return made;
}

const ctx = { skeleton: null, armature: null, root: null, key: null, from: null, clips: [] };
const results = [];
for (const [gender, pack] of Object.entries(PACKS)) results.push(await collect(gender, pack, ctx));

const beards = buildBeards(ctx);
const boneCut = stripBones(ctx);

const glb = await new Promise((res, rej) =>
  new GLTFExporter().parse(ctx.root, res, rej, { binary: true, animations: ctx.clips, onlyVisible: false }));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'people.glb'), Buffer.from(glb));

/**
 * A list of what is inside the .glb, next to the .glb.
 *
 * The app needs to know how many extra head pieces a look has before it has finished
 * reading a 3.5 MB file, and a test needs to check that every mesh the dressing code
 * can ask for actually exists -- without opening a binary model in a unit test. Both
 * read this.
 */
const manifest = {
  built: new Date().toISOString().slice(0, 10),
  source: 'Quaternius, Ultimate Modular Men and Women (CC0 1.0)',
  bones: ctx.skeleton.bones.length,
  /**
   * Nodes in the source art that are not body parts, and were thrown away. A rigged
   * handgun in the men's suit was one of them; recording the list is what lets a test
   * prove it stayed out.
   */
  dropped: results.flatMap((r) => r.dropped),
  /**
   * Meshes kept in the model but taken off the head they came with, because they are
   * facial hair and facial hair is now a choice. `buildBeards` cuts the beards out of
   * exactly these.
   */
  facial: results.flatMap((r) => r.report).flatMap((o) => o.entries.filter((e) => e.facial).map((e) => e.mesh)),
  clips: ctx.clips.map((c) => c.name),
  bytes: glb.byteLength,
  /**
   * Facial hair, in catalog order after "Clean". Cut from the face the artist drew,
   * because the pack ships no beards -- see `buildBeards`.
   */
  beards: beards.map((b) => b.mesh),
  looks: Object.fromEntries(results.flatMap((r) => r.report).map((o) => [o.outfit, {
    tris: o.tris,
    // Split the way the builder asks for them: one list per slot, because a person
    // picks feet, legs, a top and a head separately and each may come from a
    // different outfit. `from` is the pack's own name for the piece ("Hoodie",
    // "Boots"), which is where the builder's labels come from -- a guessed label goes
    // stale the moment the pack changes, this one cannot.
    // Named the way a `Look` names them, so `manifest.looks[key][slot]` works with no
    // table in between: the torso slot is what a person calls a TOP.
    feet: o.entries.filter((e) => e.slot === 'feet').map(({ mesh, role, from }) => ({ mesh, role, from })),
    legs: o.entries.filter((e) => e.slot === 'legs').map(({ mesh, role, from }) => ({ mesh, role, from })),
    top: o.entries.filter((e) => e.slot === 'body').map(({ mesh, role, from }) => ({ mesh, role, from })),
    head: o.entries.filter((e) => e.slot === 'head' && !e.facial).map(({ mesh, role, from }) => ({ mesh, role, from })),
  }])),
};
writeFileSync(join(OUT, 'people.json'), JSON.stringify(manifest, null, 2) + '\n');

// The licence that shipped inside the pack, kept next to what we built from it.
const lic = join(OUT, 'LICENCE.txt');
if (PACKS.man.licence && !existsSync(lic)) {
  mkdirSync(OUT, { recursive: true });
  await driveDownload(PACKS.man.licence, lic);
}

for (const r of results) {
  console.log(`\n${r.gender}`);
  for (const o of r.report) {
    const count = (slot) => o.entries.filter((e) => e.slot === slot).length;
    const shape = ['feet', 'legs', 'body', 'head'].map((s) => `${count(s)} ${s}`).join('  ');
    console.log(`   ${o.outfit.padEnd(16)} ${String(o.tris).padStart(6)} tris  ${shape}` +
      `  (-${(o.saved / 1024).toFixed(0)} KB slimmed)`);
  }
}
console.log(`\nbones ${boneCut.before} -> ${boneCut.after} (dropped ${boneCut.dropped} finger and toe bones` +
  `; worst vertex touched ${boneCut.worst} bones after merging)`);
console.log(`people.glb  ${(glb.byteLength / 1024).toFixed(0)} KB  ` +
  `${ctx.skeleton.bones.length} bones  clips: ${ctx.clips.map((c) => c.name).join(', ')}`);
console.log(`budget ${(glb.byteLength / 1024).toFixed(0)} of ${(MAX_BYTES / 1024).toFixed(0)} KB`);
const total = glb.byteLength;
if (total > MAX_BYTES) {
  console.error('OVER BUDGET. Drop an outfit from SKIP, or the asset does not ship.');
  process.exit(1);
}
