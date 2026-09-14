import { useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AliveRig, resolveSlots, type RigState } from './animation';
import { buildAvatar, type Preset } from './synthetic';

export interface Stats {
  fps: number;
  p50: number;
  p95: number;
  worst: number;
  triangles: number;
  morphs: number;
  vertices: number;
  drawCalls: number;
  elapsed: number;
  /** fps over the first 5s vs the most recent 5s. A large gap is thermal throttling,
   *  which a short benchmark would miss entirely -- and it is the failure that
   *  actually matters for an avatar that is on screen the whole session. */
  earlyFps: number;
  lateFps: number;
}

interface Props {
  preset: Preset;
  state: RigState;
  tracks: { breath: boolean; blink: boolean; gaze: boolean; visemes: boolean };
  onStats: (s: Stats) => void;
}

const SPOKEN =
  'hey it is good to see you again I was just thinking about what you said yesterday';

export function Scene({ preset, state, tracks, onStats }: Props) {
  const { gl, scene } = useThree();

  const built = useMemo(() => buildAvatar(preset), [preset]);
  const rig = useMemo(() => {
    const dict = (built.mesh as unknown as { morphTargetDictionary?: Record<string, number> })
      .morphTargetDictionary;
    return new AliveRig(
      built.mesh,
      built.headBone,
      built.rootBone,
      resolveSlots(dict, built.morphs),
    );
  }, [built]);

  // Frame-time ring buffer. Kept in a ref: touching React state per frame would
  // measure React, not the renderer.
  const samples = useRef<number[]>([]);
  const early = useRef<number[]>([]);
  const late = useRef<number[]>([]);
  const elapsed = useRef(0);
  const lastReport = useRef(0);
  const speechClock = useRef(0);

  useEffect(() => {
    return () => {
      built.mesh.geometry.dispose();
      (built.mesh.material as THREE.Material).dispose();
    };
  }, [built]);

  useFrame((_, dt) => {
    // Clamp: a GC pause or a JS-thread stall would otherwise poison the average and
    // hide the steady-state number we actually want.
    const clamped = Math.min(dt, 0.5);
    elapsed.current += clamped;

    // Feed the mouth. In production the platform TTS range callback drives this;
    // here we fake a steady speaking cadence so the viseme path costs what it will
    // cost in the real app.
    if (tracks.visemes && state.speaking) {
      speechClock.current -= clamped;
      if (speechClock.current <= 0) {
        const words = SPOKEN.split(' ');
        const w = words[Math.floor(elapsed.current * 3) % words.length] as string;
        rig.speakWord(w, elapsed.current, 0.32);
        speechClock.current = 0.32;
      }
    }

    rig.update(clamped, {
      thinking: tracks.gaze ? state.thinking : false,
      speaking: tracks.visemes ? state.speaking : false,
      amplitude: state.speaking ? 0.35 + Math.sin(elapsed.current * 22) * 0.3 : 0,
    });
    if (!tracks.breath) {
      built.rootBone.position.y = 0;
      built.rootBone.scale.setScalar(1);
    }
    if (!tracks.blink) {
      const infl = built.mesh.morphTargetInfluences;
      if (infl) infl[0] = 0, (infl[1] = 0);
    }

    const ms = clamped * 1000;
    samples.current.push(ms);
    if (samples.current.length > 240) samples.current.shift();
    if (elapsed.current <= 5) early.current.push(ms);
    else {
      late.current.push(ms);
      if (late.current.length > 300) late.current.shift();
    }

    if (elapsed.current - lastReport.current >= 0.5) {
      lastReport.current = elapsed.current;
      const sorted = [...samples.current].sort((a, b) => a - b);
      const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      onStats({
        fps: 1000 / (mean(samples.current) || 16.7),
        p50: pick(0.5),
        p95: pick(0.95),
        worst: sorted[sorted.length - 1] ?? 0,
        triangles: built.triangles,
        morphs: built.morphs,
        vertices: built.vertices,
        drawCalls: gl.info.render.calls,
        elapsed: elapsed.current,
        earlyFps: 1000 / (mean(early.current) || 16.7),
        lateFps: 1000 / (mean(late.current) || 16.7),
      });
    }
  });

  useEffect(() => {
    scene.background = new THREE.Color('#101014');
  }, [scene]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 4]} intensity={1.4} />
      <directionalLight position={[-3, 1, -2]} intensity={0.5} color="#88aaff" />
      <primitive object={built.mesh} position={[0, -0.2, 0]} />
    </>
  );
}
