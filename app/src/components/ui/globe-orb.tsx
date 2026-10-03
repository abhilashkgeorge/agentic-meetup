/**
 * The "searching" orb, turning on the native animation driver: for the town's loading
 * screen, which shows while the JavaScript thread is too busy to draw anything itself
 * (globe-tables.ts says why and how).
 *
 * One view per dot, each moved, sized and inked by tables of one turn of the sphere and
 * one sweep of the scan, all read on the UI thread: two looping values drive the lot.
 * Built once per size; under the phone's Reduce Motion it holds still.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { GLOBE_SWEEP_MS, GLOBE_TURN_MS, SWEEP_SAMPLES, TURN_SAMPLES, globeTables } from './globe-tables';
import { useIsDark } from './theme';

const TURN_IN = Array.from({ length: TURN_SAMPLES + 1 }, (_, k) => k / TURN_SAMPLES);
const SWEEP_IN = Array.from({ length: SWEEP_SAMPLES + 1 }, (_, k) => k / SWEEP_SAMPLES);

export function GlobeOrb({ size = 128, label = 'Loading' }: { size?: number; label?: string }) {
  const dark = useIsDark();
  const turn = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const globe = useMemo(() => globeTables(size), [size]);
  const dots = useMemo(() => globe.dots.map((d) => {
    const at = (table: number[]) => turn.interpolate({ inputRange: TURN_IN, outputRange: table });
    // The scan's lift on this dot: how close the scan is, times how near the front.
    const lift = Animated.multiply(sweep.interpolate({ inputRange: SWEEP_IN, outputRange: d.scan }), at(d.front));
    const r = Animated.add(at(d.r), Animated.multiply(lift, globe.rLift));
    return {
      x: at(d.x),
      y: at(d.y),
      // Drawn at rMax and scaled down to r; never under the library's floor (rMin).
      scale: r.interpolate({ inputRange: [globe.rMin, globe.rMax], outputRange: [globe.rMin / globe.rMax, 1], extrapolate: 'clamp' }),
      opacity: Animated.multiply(Animated.add(globe.dimBase, Animated.multiply(lift, 1 - globe.dimBase)), at(d.ink)),
    };
  }), [globe, turn, sweep]);

  const [still, setStill] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (alive) setStill(on); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setStill);
    return () => { alive = false; sub?.remove(); };
  }, []);
  useEffect(() => {
    if (still) return;
    const loops = [
      Animated.loop(Animated.timing(turn, { toValue: 1, duration: GLOBE_TURN_MS, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.timing(sweep, { toValue: 1, duration: GLOBE_SWEEP_MS, easing: Easing.linear, useNativeDriver: true })),
    ];
    for (const l of loops) l.start();
    return () => { for (const l of loops) l.stop(); };
  }, [still, turn, sweep]);

  const R = globe.rMax;
  const ink = dark ? '#ffffff' : '#000000';
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }}
          pointerEvents="none" style={{ width: size, height: size }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{
          position: 'absolute', left: -R, top: -R, width: R * 2, height: R * 2, borderRadius: R,
          backgroundColor: ink, opacity: d.opacity,
          transform: [{ translateX: d.x }, { translateY: d.y }, { scale: d.scale }],
        }} />
      ))}
    </View>
  );
}
