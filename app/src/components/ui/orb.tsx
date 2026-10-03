/**
 * THE THINKING ORB: what the app shows while something loads -- a dotted 3D figure from
 * thinking-orbs (the founder, 2026-10-03: "for the map loading animation and all the other
 * animation for loading https://github.com/Jakubantalik/thinking-orbs use this please").
 *
 * Nine states, each its own animation; pick the one that says what is happening:
 *
 *   working     particles on tilted orbits        -- the default
 *   searching   a scan sweeps a dotted globe      -- a map, the town, the park
 *   connecting  a constellation wires itself      -- matches, a person
 *   composing   an undulating sash                -- a conversation
 *   listening   a waveform rolls through rings    -- voice
 *   weaving     three strands plait               -- what your agent knows
 *   solving     bands scramble and click back     -- questions, rules
 *   shaping     circle, triangle, square          -- your character
 *   breathing   a ring slowly morphing            -- photos, anything quiet
 *
 * Monochrome, in the page's own theme: dark dots on a light page, light on a dark one.
 * Drawn with GL (orb-gl.tsx), loaded on first use rather than at startup like every native
 * shim (tests/native-imports.test.ts); until then, or on a build with no GL, the space is
 * held empty and a screen reader still hears what is loading.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsDark } from './theme';
import { ORB_SAYS, type OrbState } from './orb-frame';
import type { OrbGLProps } from './orb-gl';

export type { OrbState } from './orb-frame';

let drawer: ComponentType<OrbGLProps> | null | undefined;
let loading: Promise<ComponentType<OrbGLProps> | null> | null = null;

/** The GL drawer, loaded once; null on a build without GL. */
export function loadOrbDrawer(): Promise<ComponentType<OrbGLProps> | null> {
  if (drawer !== undefined) return Promise.resolve(drawer);
  loading ??= import('./orb-gl')
    .then((m) => (drawer = m.OrbGL))
    .catch((err: unknown) => {
      console.warn(`[orb] no GL: ${err instanceof Error ? err.message : String(err)}`);
      loading = null; // a bundle still arriving may have it next time
      return null;
    });
  return loading;
}

export interface OrbProps {
  state?: OrbState;
  /** Across, in dp. From 40 up the 64 design, below it the 20 (orb-frame.ts presetFor). */
  size?: number;
  /** A multiple of the state's own pace. */
  speed?: number;
  /** What a screen reader hears; the state's own word otherwise. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function Orb({ state = 'working', size = 64, speed = 1, label, style }: OrbProps) {
  const dark = useIsDark();
  const [Drawer, setDrawer] = useState<ComponentType<OrbGLProps> | null>(() => drawer ?? null);
  useEffect(() => {
    if (Drawer) return;
    let alive = true;
    void loadOrbDrawer().then((d) => { if (alive && d) setDrawer(() => d); });
    return () => { alive = false; };
  }, [Drawer]);
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label ?? ORB_SAYS[state]}
          accessibilityState={{ busy: true }} style={[{ width: size, height: size }, style]}>
      {Drawer ? <Drawer state={state} size={size} dark={dark} speed={speed} /> : null}
    </View>
  );
}
