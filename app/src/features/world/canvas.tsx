/**
 * The town, drawn.
 *
 * THIS IS THE ONLY FILE THAT IMPORTS three AND r3f AT THE TOP, and it is only ever
 * reached through `loadWorldRenderer()` in ./r3f.ts. Import it statically from a screen
 * and tests/native-imports.test.ts fails the build, on purpose.
 *
 * Budget, and why it is shaped like this: one draw call per kind of thing. Bodies are
 * one InstancedMesh, heads another, ghosts (practice profiles) a translucent pair of
 * their own, and every bubble -- dots, ticks, crosses, rings -- is an instance of one
 * small mesh with its scale set to zero when unused. Sixty-four slots, no textures, no
 * shadows, Lambert lighting. The avatar spike found the renderer was never the
 * constraint on an iPhone; the frame-time ring buffer here is how we find out whether
 * that is also true of an Android phone (see features/dev/gl-bench.tsx).
 *
 * The frame loop touches no React state. The spike's lesson, verbatim: "touching React
 * state per frame would measure React, not the renderer."
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PLAZA, type SimAgent, type WorldSim } from './sim';

export interface WorldColors {
  bg: string;
  ground: string;
  prop: string;
  you: string;
  stranger: string;
  met: string;
  practice: string;
  success: string;
  danger: string;
  warning: string;
  accent: string;
}

export interface WorldStats {
  fps: number;
  p50: number;
  p95: number;
  worst: number;
  drawCalls: number;
  triangles: number;
  elapsed: number;
  /** fps over the first 5 s vs the most recent 5 s. A gap is thermal throttling. */
  earlyFps: number;
  lateFps: number;
}

export interface WorldCanvasProps {
  sim: WorldSim;
  colors: WorldColors;
  /** Device pixel ratio cap. 1 on a struggling phone, 1.5 otherwise. */
  dpr?: number;
  /** Render at 30 Hz on demand instead of every vsync. */
  cap30?: boolean;
  /** False when the tab is not on screen: the loop stops and the GPU rests. */
  active?: boolean;
  onStats?: (s: WorldStats) => void;
  onTapAgent?: (ref: string) => void;
  /** Called once, on the first drawn frame. The fuse in storage is cleared on it. */
  onFirstFrame?: () => void;
}

const SLOTS = 64;
const DOTS_PER = 3;
const BARS_PER = 2;

export function WorldCanvas(props: WorldCanvasProps) {
  const { dpr = 1, cap30 = false, active = true } = props;
  return (
    <Canvas
      orthographic
      camera={{ position: [12, 12, 12], zoom: 24, near: 0.1, far: 100 }}
      gl={{ antialias: false }}
      dpr={dpr}
      frameloop={!active ? 'never' : cap30 ? 'demand' : 'always'}
    >
      <Town {...props} />
    </Canvas>
  );
}

function Town({ sim, colors, cap30, onStats, onTapAgent, onFirstFrame }: WorldCanvasProps) {
  const { gl, scene, invalidate } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(colors.bg);
  }, [scene, colors.bg]);

  // 30 fps: r3f's demand mode draws only when asked, so ask on a 33 ms ticker.
  useEffect(() => {
    if (!cap30) return;
    const t = setInterval(() => invalidate(), 33);
    return () => clearInterval(t);
  }, [cap30, invalidate]);

  const meshes = useMemo(() => {
    const body = new THREE.CapsuleGeometry(0.28, 0.55, 3, 8);
    const head = new THREE.SphereGeometry(0.22, 8, 6);
    const dot = new THREE.SphereGeometry(0.07, 6, 4);
    const bar = new THREE.BoxGeometry(0.5, 0.08, 0.08);
    const ring = new THREE.TorusGeometry(0.55, 0.05, 6, 24);
    const solid = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const ghost = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 });
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.count = n;
      im.frustumCulled = false;
      return im;
    };
    return {
      bodies: mk(body, solid, SLOTS),
      heads: mk(head, solid, SLOTS),
      ghostBodies: mk(body, ghost, SLOTS),
      ghostHeads: mk(head, ghost, SLOTS),
      dots: mk(dot, solid, SLOTS * DOTS_PER),
      bars: mk(bar, solid, SLOTS * BARS_PER),
      rings: mk(ring, solid, SLOTS),
      geometries: [body, head, dot, bar, ring],
      materials: [solid, ghost],
    };
  }, []);

  useEffect(() => () => {
    for (const g of meshes.geometries) g.dispose();
    for (const m of meshes.materials) m.dispose();
  }, [meshes]);

  const palette = useMemo(() => ({
    you: new THREE.Color(colors.you),
    stranger: new THREE.Color(colors.stranger),
    met: new THREE.Color(colors.met),
    practice: new THREE.Color(colors.practice),
    prop: new THREE.Color(colors.prop),
    success: new THREE.Color(colors.success),
    danger: new THREE.Color(colors.danger),
    warning: new THREE.Color(colors.warning),
    accent: new THREE.Color(colors.accent),
    grey: new THREE.Color(colors.stranger),
  }), [colors]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const hidden = useMemo(() => {
    const o = new THREE.Object3D();
    o.scale.setScalar(0);
    o.updateMatrix();
    return o.matrix;
  }, []);
  /** Instance slot → agent ref, for taps. Written in the frame loop, read on click. */
  const refAt = useRef<string[]>([]);

  // Frame-time ring buffer, in refs.
  const samples = useRef<number[]>([]);
  const early = useRef<number[]>([]);
  const late = useRef<number[]>([]);
  const elapsed = useRef(0);
  const lastReport = useRef(0);
  const drawn = useRef(false);

  useFrame((_, dt) => {
    if (!drawn.current) { drawn.current = true; onFirstFrame?.(); }
    const clamped = Math.min(dt, 0.1);
    elapsed.current += clamped;
    const t = elapsed.current;
    sim.step(clamped);

    const { bodies, heads, ghostBodies, ghostHeads, dots, bars, rings } = meshes;
    const agents = sim.agents();
    const n = Math.min(agents.length, SLOTS);
    refAt.current.length = n;

    for (let i = 0; i < SLOTS; i++) {
      const a = i < n ? (agents[i] as SimAgent) : null;
      if (!a || a.state === 'gone') {
        bodies.setMatrixAt(i, hidden); heads.setMatrixAt(i, hidden);
        ghostBodies.setMatrixAt(i, hidden); ghostHeads.setMatrixAt(i, hidden);
        rings.setMatrixAt(i, hidden);
        for (let k = 0; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
        continue;
      }
      refAt.current[i] = a.ref;
      const moving = a.state === 'walking' || a.state === 'approaching' || a.state === 'leaving';
      const bob = Math.sin(t * (moving ? 9 : 2) + a.seed) * (moving ? 0.06 : 0.03);
      const ghost = a.kind === 'practice';
      const bodyMesh = ghost ? ghostBodies : bodies;
      const headMesh = ghost ? ghostHeads : heads;
      const other = ghost ? bodies : ghostBodies;
      const otherHead = ghost ? heads : ghostHeads;

      dummy.position.set(a.x, 0.56 + bob, a.z);
      dummy.rotation.set(0, a.facing, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      other.setMatrixAt(i, hidden);

      dummy.position.set(a.x, 1.12 + bob, a.z);
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
      otherHead.setMatrixAt(i, hidden);

      const tint =
        a.kind === 'you' ? palette.you
        : a.kind === 'met' ? palette.met
        : a.kind === 'practice' ? palette.practice
        : palette.stranger;
      bodyMesh.setColorAt(i, tint);
      headMesh.setColorAt(i, tint);

      // Bubbles. Dots while talking; a tick, a cross or a single dot for the verdict.
      const top = 1.55 + bob;
      if (a.bubble === 'dots') {
        for (let k = 0; k < DOTS_PER; k++) {
          const phase = Math.sin(t * 6 + k * 1.1);
          dummy.position.set(a.x + (k - 1) * 0.17, top + 0.06 * Math.max(0, phase), a.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(0.8 + 0.2 * Math.max(0, phase));
          dummy.updateMatrix();
          dots.setMatrixAt(i * DOTS_PER + k, dummy.matrix);
          dots.setColorAt(i * DOTS_PER + k, palette.prop);
        }
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
      } else if (a.bubble === 'got_on' || a.bubble === 'did_not_click') {
        const ok = a.bubble === 'got_on';
        const colour = ok ? palette.success : palette.danger;
        // A tick is a short bar and a long bar at 45°; a cross is two equal bars.
        for (let k = 0; k < BARS_PER; k++) {
          dummy.position.set(a.x + (ok && k === 0 ? -0.12 : 0), top + 0.05, a.z);
          dummy.rotation.set(0, Math.PI / 4, ok ? (k === 0 ? Math.PI / 4 : -Math.PI / 4) : (k === 0 ? Math.PI / 4 : -Math.PI / 4));
          dummy.scale.set(ok && k === 0 ? 0.55 : 1, 1, 1);
          dummy.updateMatrix();
          bars.setMatrixAt(i * BARS_PER + k, dummy.matrix);
          bars.setColorAt(i * BARS_PER + k, colour);
        }
        for (let k = 0; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
      } else if (a.bubble === 'unsure' || a.bubble === 'could_not_tell') {
        dummy.position.set(a.x, top + 0.05, a.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1.3);
        dummy.updateMatrix();
        dots.setMatrixAt(i * DOTS_PER, dummy.matrix);
        dots.setColorAt(i * DOTS_PER, a.bubble === 'unsure' ? palette.warning : palette.grey);
        for (let k = 1; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
      } else {
        for (let k = 0; k < DOTS_PER; k++) dots.setMatrixAt(i * DOTS_PER + k, hidden);
        for (let k = 0; k < BARS_PER; k++) bars.setMatrixAt(i * BARS_PER + k, hidden);
      }

      if (a.ring) {
        const pulse = 1 + 0.12 * Math.sin(t * 4);
        dummy.position.set(a.x, 0.03, a.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(pulse);
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
        rings.setColorAt(i, palette.accent);
      } else {
        rings.setMatrixAt(i, hidden);
      }
    }

    for (const m of [bodies, heads, ghostBodies, ghostHeads, dots, bars, rings]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    if (!onStats) return;
    const ms = clamped * 1000;
    samples.current.push(ms);
    if (samples.current.length > 240) samples.current.shift();
    if (t <= 5) early.current.push(ms);
    else {
      late.current.push(ms);
      if (late.current.length > 300) late.current.shift();
    }
    if (t - lastReport.current >= 0.5) {
      lastReport.current = t;
      const sorted = [...samples.current].sort((a, b) => a - b);
      const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      onStats({
        fps: 1000 / (mean(samples.current) || 16.7),
        p50: pick(0.5),
        p95: pick(0.95),
        worst: sorted[sorted.length - 1] ?? 0,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        elapsed: t,
        earlyFps: 1000 / (mean(early.current) || 16.7),
        lateFps: 1000 / (mean(late.current) || 16.7),
      });
    }
  });

  const tap = (e: { instanceId?: number }) => {
    const ref = e.instanceId === undefined ? undefined : refAt.current[e.instanceId];
    if (ref && onTapAgent) onTapAgent(ref);
  };

  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a94a6', 0.95]} />
      <directionalLight position={[6, 10, 4]} intensity={0.75} />

      {/* Ground: the sunken grey, so the town reads as a well in the page. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[PLAZA * 2 + 10, PLAZA * 2 + 10]} />
        <meshLambertMaterial color={colors.ground} />
      </mesh>

      {/* A fountain, two benches, two lamps. Enough to be a square, not a field. */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[1.3, 1.5, 0.5, 20]} />
        <meshLambertMaterial color={colors.prop} />
      </mesh>
      <mesh position={[0, 0.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.12, 8, 24]} />
        <meshLambertMaterial color={colors.accent} />
      </mesh>
      {[[-5, 3], [5, -3]].map(([x, z], i) => (
        <mesh key={`bench${i}`} position={[x, 0.25, z]} rotation={[0, i ? 0.6 : -0.6, 0]}>
          <boxGeometry args={[1.6, 0.5, 0.5]} />
          <meshLambertMaterial color={colors.prop} />
        </mesh>
      ))}
      {[[-5, -5], [5, 5]].map(([x, z], i) => (
        <group key={`lamp${i}`} position={[x, 0, z]}>
          <mesh position={[0, 1.1, 0]}>
            <cylinderGeometry args={[0.06, 0.08, 2.2, 6]} />
            <meshLambertMaterial color={colors.prop} />
          </mesh>
          <mesh position={[0, 2.25, 0]}>
            <sphereGeometry args={[0.22, 8, 6]} />
            <meshLambertMaterial color={colors.warning} />
          </mesh>
        </group>
      ))}

      <primitive object={meshes.bodies} onClick={tap} />
      <primitive object={meshes.heads} onClick={tap} />
      <primitive object={meshes.ghostBodies} onClick={tap} />
      <primitive object={meshes.ghostHeads} onClick={tap} />
      <primitive object={meshes.dots} />
      <primitive object={meshes.bars} />
      <primitive object={meshes.rings} />
    </>
  );
}
