/**
 * The frame rate, in red, over the world. Debug builds only.
 *
 * WHAT IT IS FOR. `gl-bench` answers "can this phone run the town" once, in a lab, on
 * a synthetic crowd. This answers "is the phone struggling RIGHT NOW", while you walk
 * a real park with real people in it -- the founder's question, on the phone
 * (2026-09-23). It is the renderer's own frame time, not a JS-thread timer: the GL
 * loop is where the cost is, and a `requestAnimationFrame` count in React Native
 * measures a different thread and lies about exactly the case you care about.
 *
 * DRAW CALLS AND TRIANGLES too, because "it is laggy" has two completely different
 * causes and they are fixed at opposite ends of the code. If the triangle count is
 * high the GPU is the problem; if it is low and the frame rate is still bad, the
 * JavaScript is, and no amount of mesh merging will help. The city view read 29 fps
 * at a p95 of 38 ms while `dumpsys gfxinfo` had the UI thread at 11 ms -- which is
 * how we knew to go looking in the frame loop rather than in the meshes.
 *
 * MEAN AND WORST, because they fail apart. A steady 58 fps with one 90 ms frame a
 * second is a stutter you can feel and a mean you cannot see it in, so the second
 * number is the 95th percentile frame time. Under 16.7 ms is a clean 60.
 *
 * AND IT SAYS WHEN THE CAP IS ON, because otherwise the number lies about the one
 * question being asked. Settings has a "30 fps" switch that puts r3f in demand mode
 * and pokes it on a 33 ms ticker; with it on the park reads 28 fps, which looks like
 * a phone in trouble and is a phone being told to rest. Measured on the Pixel 6a on
 * 2026-09-23: 28 fps in the park while `dumpsys gfxinfo` had the UI thread at a p50
 * of 10 ms and a p95 of 14 ms -- idle between frames, not behind on them.
 *
 * WHY A MODULE-LEVEL SINK and not props. The canvas reports twice a second. Holding
 * that in the screen's state would re-render the screen -- and therefore the canvas
 * element and the HUD -- 120 times a minute, so the meter would be paying for itself
 * in the thing it is measuring. The sink lets only this one `<Text>` re-render. There
 * is one world canvas, so one listener is all there is to hold.
 *
 * It renders nothing at all in a release build: `__DEV__` is false there, the sink
 * throws nothing away because nothing is fed to it, and `tests/fps.test.ts` holds the
 * screen to passing `onStats` only under that flag.
 */
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Only what the meter shows, so this file never reaches for the three.js side. */
export type FpsShot = { fps: number; p95: number; calls: number; tris: number };

/** True in a debug build, false in a release one. The whole meter hangs off this. */
export const FPS_METER = __DEV__;

let listener: ((s: FpsShot) => void) | null = null;

/** Handed to the canvas as `onStats`. A no-op while no meter is mounted. */
export function feedFps(s: { fps: number; p95: number; drawCalls: number; triangles: number }): void {
  listener?.({ fps: s.fps, p95: s.p95, calls: s.drawCalls, tris: s.triangles });
}

export function FpsMeter({ capped = false }: {
  /** Settings' "30 fps" switch is on, so a low number is the cap and not the phone. */
  capped?: boolean;
}): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const [shot, setShot] = useState<FpsShot | null>(null);
  useEffect(() => {
    if (!FPS_METER) return;
    // CLEAR ONLY YOUR OWN. React mounts the replacement before it unmounts the old
    // one -- on a Fast Refresh, and on any remount -- so a bare `listener = null` in
    // the cleanup runs AFTER the new meter has claimed the slot and kills the live
    // one. The meter then sits there showing nothing, which is what it did on the
    // phone on 2026-09-23 before this line.
    const mine = setShot;
    listener = mine;
    return () => { if (listener === mine) listener = null; };
  }, []);
  if (!FPS_METER || !shot) return null;
  return (
    <Text
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute', right: 10, top: insets.top + 4,
        color: '#ff2d2d', fontSize: 12, fontWeight: '700',
        fontVariant: ['tabular-nums'],
      }}
    >
      {`${Math.round(shot.fps)} fps · ${shot.p95.toFixed(0)} ms · ${shot.calls} calls · ${(shot.tris / 1000).toFixed(0)}k${capped ? ' · 30 cap' : ''}`}
    </Text>
  );
}
