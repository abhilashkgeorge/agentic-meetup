/**
 * One character, up close: the builder's stage and the You tab's card.
 *
 * WHAT WAS WRONG (the founder, 2026-09-29): "when you click build your character, the
 * character is shown as a capsule and after some seconds the rig is shown". The
 * preview read the model off disk and built a rigged body of its own every time it
 * opened -- seconds on the phone, with a capsule standing in -- while the town had
 * already built every body there is (crowd-gpu.ts). And the card on the You tab was a
 * flat drawing, never the character at all.
 *
 * NOW IT IS THE TOWN'S OWN BODY. The same prepared crowd, built once per app run and
 * shared by every canvas, drawing one person at its nearest level of detail: nothing
 * to build when the town already has, so it is there as the screen opens -- and what
 * you choose here is exactly what walks about in the park. Until the crowd is ready
 * (the first time, straight from sign-up) the stage shows nothing and says so; there
 * is no capsule.
 *
 * WHAT IT DOES ON TOP of standing there:
 *   - STUDIO LIGHT AND NO TONE MAPPING, so the colour on the swatch is the colour on
 *     the body. Under the town's filmic curve and its cool bounce light the palest
 *     skin read as grey.
 *   - THE CAMERA GOES TO WHAT YOU ARE CHOOSING -- the face for hair and glasses, the
 *     feet for shoes -- easing there rather than cutting.
 *   - A FINGER TURNS THEM ROUND, and after a moment on their own they drift back to a
 *     slow sway.
 *   - A CHANGE LANDS WITH A SMALL BOUNCE, so a new top is something that happened.
 *
 * Imports three and r3f at the top, so it is LAZY_ONLY (tests/native-imports.test.ts)
 * and reached only through canvas.tsx, which re-exports it for `loadWorldRenderer()`.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { PanResponder, View } from 'react-native';
import * as THREE from 'three';
import { lookKey, type Look } from '@clone/shared';
import { loadGpuCrowd, type CrowdFrame, type GpuCrowd } from './crowd-gpu';
import { FRAMING, type Focus } from './framing';
import { honourSubDataRanges } from './gl-subdata';
import { FigureSkeleton } from '../look/figure-skeleton';

export type { Focus };

/** Radians of turn per point dragged. */
const TURN_PER_PT = 0.012;
/** How long after a finger lets go before the slow sway comes back. */
const REST_AFTER = 2.5;
/** The angle they rest at: a little turned, which reads as a person rather than a mugshot. */
const REST_YAW = 0.35;
/** How quickly the camera arrives at a new framing: 1 - e^(-k dt) a frame. */
const EASE = 5.5;

export interface CharacterCanvasProps {
  look: Look;
  /** The page colour behind them. */
  background: string;
  /** A fixed height, or nothing at all to fill whatever box it is put in. */
  height?: number;
  focus?: Focus;
  /** Let a finger turn them round (the builder). */
  turnable?: boolean;
  /** False when the screen is not in front: the loop stops and the GPU rests. */
  active?: boolean;
  /** Told once if the model cannot be read, so the caller can draw them flat instead. */
  onFail?: () => void;
}

export function CharacterCanvas({
  look, background, height, focus = 'body', turnable = false, active = true, onFail,
}: CharacterCanvasProps) {
  const [ready, setReady] = useState(false);
  const yaw = useRef({ user: REST_YAW, touched: -Infinity, dragFrom: REST_YAW });
  const clock = useRef(0);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => turnable && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: () => { yaw.current.dragFrom = yaw.current.user; yaw.current.touched = Infinity; },
    onPanResponderMove: (_e, g) => { yaw.current.user = yaw.current.dragFrom + g.dx * TURN_PER_PT; },
    onPanResponderRelease: () => { yaw.current.touched = clock.current; },
    onPanResponderTerminate: () => { yaw.current.touched = clock.current; },
  }), [turnable]);

  return (
    // `alignSelf: 'stretch'`: a View with a height but no width inside a centring
    // parent is zero pixels wide, and a GL canvas with no width draws nothing and says
    // nothing (the builder showed a person-shaped hole for a day, 2026-09-22).
    <View style={height === undefined ? { flex: 1, alignSelf: 'stretch' } : { height, alignSelf: 'stretch' }}
          {...responder.panHandlers}>
      <Canvas
        style={{ flex: 1 }}
        camera={{ position: [...FRAMING[focus].eye], fov: 32 }}
        gl={{ antialias: false }}
        flat
        frameloop={active ? 'always' : 'never'}
      >
        <Figure look={look} background={background} focus={focus} yaw={yaw} clock={clock}
                onReady={() => setReady(true)} onFail={onFail} />
      </Canvas>
      {/* The figure's shape while its model loads: a spinner on an empty well, before. */}
      {!ready && (
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <FigureSkeleton height={height ?? 240} />
        </View>
      )}
    </View>
  );
}

function Figure({ look, background, focus, yaw, clock, onReady, onFail }: {
  look: Look;
  background: string;
  focus: Focus;
  yaw: MutableRefObject<{ user: number; touched: number; dragFrom: number }>;
  clock: MutableRefObject<number>;
  onReady: () => void;
  onFail?: () => void;
}) {
  const { scene, camera, gl } = useThree();
  useEffect(() => { scene.background = new THREE.Color(background); }, [scene, background]);
  useEffect(() => honourSubDataRanges(gl.getContext()), [gl]);

  const holder = useMemo(() => new THREE.Group(), []);
  const crowd = useRef<GpuCrowd | null>(null);
  const ready = useRef({ onReady, onFail });
  ready.current = { onReady, onFail };
  useEffect(() => {
    let alive = true;
    let made: GpuCrowd | null = null;
    loadGpuCrowd()
      .then((c) => {
        if (!alive) { c.dispose(); return; }
        made = c;
        crowd.current = c;
        holder.add(c.group);
        ready.current.onReady();
      })
      .catch((e: unknown) => {
        console.warn('[world] the character preview cannot read the model:', e);
        if (alive) ready.current.onFail?.();
      });
    return () => { alive = false; crowd.current = null; holder.clear(); made?.dispose(); };
  }, [holder]);

  /** The one person, rewritten every frame rather than rebuilt. */
  const person = useMemo(() => ({
    ref: 'preview', x: 0, z: 0, facing: REST_YAW, look, seed: 7, ghost: false, state: 'idle',
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps -- `look` is copied in each frame
  const lookNow = useRef(look);
  lookNow.current = look;
  /** Nearest level whatever the distance (`flat`); a bounce rides on `scale`. */
  const frame = useMemo<CrowdFrame>(() => ({ eyeX: 0, eyeZ: 0, flat: 1, time: 0, dt: 0, scale: 1 }), []);
  const bounce = useRef({ key: lookKey(look), at: -1 });
  const eye = useMemo(() => new THREE.Vector3(...FRAMING[focus].eye), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const at = useMemo(() => new THREE.Vector3(...FRAMING[focus].at), []);     // eslint-disable-line react-hooks/exhaustive-deps
  const want = useMemo(() => ({ eye: new THREE.Vector3(), at: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1);
    clock.current += step;
    const t = clock.current;

    // A finger turned them: hold that. Left alone a while: a slow sway about it.
    const y = yaw.current;
    const rest = Math.min(1, Math.max(0, (t - y.touched - REST_AFTER) / 1.5));
    const sway = Math.sin(t * 0.55) * 0.28 * rest;
    person.facing += (y.user + sway - person.facing) * (1 - Math.exp(-8 * step));

    // A new look lands with a small bounce.
    const key = lookKey(lookNow.current);
    if (key !== bounce.current.key) { bounce.current.key = key; bounce.current.at = t; }
    const since = t - bounce.current.at;
    frame.scale = since >= 0 && since < 0.32 ? 1 + 0.035 * Math.sin((since / 0.32) * Math.PI) : 1;

    person.look = lookNow.current;
    frame.time = t;
    frame.dt = step;
    crowd.current?.update([person], 1, frame);

    // The camera eases to whatever is being chosen.
    const f = FRAMING[focus];
    want.eye.set(f.eye[0], f.eye[1], f.eye[2]);
    want.at.set(f.at[0], f.at[1], f.at[2]);
    const k = 1 - Math.exp(-EASE * step);
    eye.lerp(want.eye, k);
    at.lerp(want.at, k);
    camera.position.copy(eye);
    camera.lookAt(at);
  });

  return (
    <>
      {/* Studio light, not the town's: a warm bounce from below instead of a cool one,
          a key from the front-left and a little rim behind. Measured so the lit side of
          a swatch colour comes out as that colour with no tone mapping in the way. */}
      <hemisphereLight args={['#ffffff', '#c9bfb4', 0.62]} />
      <directionalLight position={[2.5, 4, 5]} intensity={0.66} />
      <directionalLight position={[-3, 3, -4]} intensity={0.25} />
      <primitive object={holder} />
    </>
  );
}
