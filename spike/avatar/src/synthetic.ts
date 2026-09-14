/**
 * A parametrised stand-in for a real avatar.
 *
 * WHY SYNTHETIC. The question this spike answers is not "how fast is one particular
 * avatar" -- it is "where does react-three-fiber on expo-gl fall off a cliff, and is
 * a real avatar on the safe side of it". A generated mesh lets us sweep triangle and
 * morph-target counts to find the cliff. A downloaded avatar gives one point on the
 * curve and no idea how much headroom it has.
 *
 * It reproduces the actual per-frame cost drivers of a talking head:
 *   - a SKINNED mesh (GPU skinning, bone matrix upload every frame)
 *   - N morph targets (three.js packs these into a morph texture; influences are
 *     re-uploaded whenever any of them changes, which for lip sync is every frame)
 *   - a real material with a texture
 *
 * What it does NOT reproduce, and why the on-device "load a real GLB" path exists:
 * hair with alpha blending (overdraw), multiple materials/draw calls, eye and teeth
 * sub-meshes, and PBR maps. Expect a real avatar to cost somewhat more than the
 * synthetic one at equal triangle count.
 */
import * as THREE from 'three';

export interface Preset {
  name: string;
  segments: number;   // sphere tessellation -> triangle count
  morphs: number;     // ARKit is 52; Oculus visemes add ~15
}

export const PRESETS: Preset[] = [
  { name: 'low',   segments: 48,  morphs: 16 },
  { name: 'med',   segments: 96,  morphs: 52 },
  { name: 'high',  segments: 160, morphs: 52 },
  { name: 'ultra', segments: 240, morphs: 67 },
];

/** Deterministic PRNG so every run measures the same mesh. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface Built {
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  headBone: THREE.Bone;
  rootBone: THREE.Bone;
  triangles: number;
  morphs: number;
  vertices: number;
}

export function buildAvatar(preset: Preset): Built {
  const geo = new THREE.SphereGeometry(1, preset.segments, preset.segments / 2);
  geo.deleteAttribute('uv2');

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;

  // --- Skeleton: root -> neck -> head. Three bones is enough to pay the real
  // per-frame cost (bone texture upload + vertex skinning) without pretending to
  // be a full body rig.
  const root = new THREE.Bone();
  const neck = new THREE.Bone();
  const head = new THREE.Bone();
  root.add(neck);
  neck.add(head);
  neck.position.y = -0.8;
  head.position.y = 0.8;

  // Weight every vertex between neck and head by height, so skinning actually
  // deforms geometry rather than rigidly transforming it.
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((y + 1) / 2, 0, 1);
    skinIndex.set([1, 2, 0, 0], i * 4);
    skinWeight.set([1 - t, t, 0, 0], i * 4);
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

  // --- Morph targets. Each is a localised radial bulge, like a real blendshape:
  // it moves a subset of vertices, not all of them.
  const rand = rng(1337);
  geo.morphAttributes.position = [];
  geo.morphTargetsRelative = true;
  for (let m = 0; m < preset.morphs; m++) {
    const cx = rand() * 2 - 1;
    const cy = rand() * 2 - 1;
    const cz = rand() * 2 - 1;
    const centre = new THREE.Vector3(cx, cy, cz).normalize();
    const radius = 0.25 + rand() * 0.4;
    const amp = 0.04 + rand() * 0.08;

    const delta = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      const d = v.distanceTo(centre);
      if (d < radius) {
        // smoothstep falloff -- morph deltas are dense near the centre, zero outside
        const w = 1 - d / radius;
        const f = w * w * (3 - 2 * w) * amp;
        delta[i * 3] = v.x * f;
        delta[i * 3 + 1] = v.y * f;
        delta[i * 3 + 2] = v.z * f;
      }
    }
    geo.morphAttributes.position.push(new THREE.BufferAttribute(delta, 3));
  }

  // A texture, because an untextured material measures a workload nobody ships.
  const tex = new THREE.DataTexture(checkerboard(128), 128, 128, THREE.RGBAFormat);
  tex.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.65,
    metalness: 0.0,
  });

  const skeleton = new THREE.Skeleton([root, neck, head]);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;

  const index = geo.getIndex();
  return {
    mesh,
    skeleton,
    headBone: head,
    rootBone: root,
    triangles: index ? index.count / 3 : count / 3,
    morphs: preset.morphs,
    vertices: count,
  };
}

function checkerboard(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = ((x >> 4) + (y >> 4)) % 2 === 0;
      const v = on ? 210 : 170;
      data[i] = v; data[i + 1] = v * 0.85; data[i + 2] = v * 0.78; data[i + 3] = 255;
    }
  }
  return data;
}
