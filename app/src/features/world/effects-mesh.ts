/**
 * The park's puffs of smoke and beams of light, drawn (park-effects.ts says which are
 * running and how far along each is).
 *
 * A PUFF is a dozen soft balls billowing out from somebody's feet and fading, most of
 * them a pale smoke, a few the accent colour -- the magic in it. A BEAM is a thin shaft
 * of light, brightest at the ground and gone by the top, that somebody rises on or comes
 * down in -- and is seen THROUGH: the first one was a solid white pillar, drawn twice
 * over (both faces, added together), and hid the very person rising in it (2026-10-03).
 *
 * Pools, not new meshes: a few puffs and beams at once is all the park ever needs, so
 * a fixed handful is built once and the ones not running are hidden -- nothing is drawn
 * at all while nothing is happening.
 */
import * as THREE from 'three';
import { SKY } from './flight';
import { effectAt, type Effect } from './park-effects';

/** At most this many puffs and beams drawn at once; any more wait their turn. */
const PUFFS = 6;
const BEAMS = 4;
/** Balls in a puff, and how many of them carry the accent colour. */
const BALLS = 12;
const SPARKS = 4;
/** A puff's reach: about a person's height across (a person is ~0.22 units tall). */
const SPREAD = 0.2;
const BEAM_H = SKY + 1.6;
/** How strongly a beam shows at its brightest: light added, never a wall. */
const BEAM_GLOW = 0.3;

export interface BuiltEffects {
  group: THREE.Group;
  /** Show what is running at `now` (ms, Date.now()). */
  update(effects: readonly Effect[], now: number): void;
  dispose(): void;
}

/** A fixed scatter for the balls: the same puff shape every time, nothing random per frame. */
function scatter(): { dir: THREE.Vector3; size: number; rise: number }[] {
  const out: { dir: THREE.Vector3; size: number; rise: number }[] = [];
  for (let i = 0; i < BALLS; i++) {
    const a = i * 2.39996; // the golden angle: evenly round, never in rows
    const up = 0.15 + 0.5 * ((i * 7) % BALLS) / BALLS;
    out.push({
      dir: new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize(),
      size: 0.045 + 0.03 * ((i * 5) % 4) / 3,
      rise: 0.05 + 0.08 * ((i * 3) % 5) / 4,
    });
  }
  return out;
}

export function buildEffects(accent: string): BuiltEffects {
  const group = new THREE.Group();
  group.name = 'park-effects';
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const shape = scatter();
  const smoke = new THREE.Color('#f4f2f8');
  const spark = new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.35);
  const dummy = new THREE.Object3D();

  const puffs = Array.from({ length: PUFFS }, () => {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, opacity: 0 });
    const mesh = new THREE.InstancedMesh(ball, mat, BALLS);
    mesh.name = 'puff';
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.renderOrder = 5;
    for (let i = 0; i < BALLS; i++) mesh.setColorAt(i, i < SPARKS ? spark : smoke);
    group.add(mesh);
    return { mesh, mat };
  });

  // Thin, and fading to nothing toward the top: the light rides in the vertex colours,
  // which with additive blending is how much light each part adds.
  const column = new THREE.CylinderGeometry(0.03, 0.05, BEAM_H, 16, 4, true);
  column.translate(0, BEAM_H / 2, 0);
  {
    const pos = column.getAttribute('position');
    const shade = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const up = 1 - pos.getY(i) / BEAM_H;
      const k = up * up;
      shade[i * 3] = spark.r * k; shade[i * 3 + 1] = spark.g * k; shade[i * 3 + 2] = spark.b * k;
    }
    column.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  }
  const beams = Array.from({ length: BEAMS }, () => {
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff', vertexColors: true, transparent: true, depthWrite: false, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(column, mat);
    mesh.name = 'beam';
    mesh.visible = false;
    mesh.raycast = () => {};
    mesh.renderOrder = 6;
    group.add(mesh);
    return { mesh, mat };
  });

  return {
    group,
    update(effects, now) {
      let np = 0;
      let nb = 0;
      for (const e of effects) {
        const at = effectAt(e, now);
        if (!at) continue;
        if (e.kind === 'puff' && np < PUFFS) {
          const { mesh, mat } = puffs[np++]!;
          // Out fast, then drifting: most of the billow in the first third.
          const grow = 1 - (1 - at.k) ** 3;
          for (let i = 0; i < BALLS; i++) {
            const b = shape[i]!;
            const r = SPREAD * (0.25 + 0.75 * grow);
            dummy.position.set(e.x + b.dir.x * r, 0.03 + b.dir.y * r + b.rise * at.k, e.z + b.dir.z * r);
            dummy.scale.setScalar(b.size * (0.6 + 1.1 * grow) * (i < SPARKS ? 0.6 : 1));
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mat.opacity = 0.85 * at.alpha;
          mesh.visible = true;
        } else if (e.kind === 'beam' && nb < BEAMS) {
          const { mesh, mat } = beams[nb++]!;
          mesh.position.set(e.x, 0, e.z);
          // A slow shimmer, so it reads as light rather than a pipe.
          mesh.scale.set(1 + 0.08 * Math.sin(now / 90), 1, 1 + 0.08 * Math.sin(now / 90));
          mat.opacity = BEAM_GLOW * at.alpha;
          mesh.visible = true;
        }
      }
      for (let i = np; i < PUFFS; i++) puffs[i]!.mesh.visible = false;
      for (let i = nb; i < BEAMS; i++) beams[i]!.mesh.visible = false;
    },
    dispose() {
      ball.dispose();
      column.dispose();
      for (const p of puffs) { p.mat.dispose(); p.mesh.dispose(); }
      for (const b of beams) b.mat.dispose();
      group.clear();
    },
  };
}
