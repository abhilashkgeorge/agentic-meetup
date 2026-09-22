/**
 * The thumb stick, for walking your own agent.
 *
 * It writes straight into a ref that the renderer reads once a frame -- x right,
 * y DOWN, each -1..1, the way a screen measures. No state, because a thumb moves
 * sixty times a second and not one of those should render anything; the knob is an
 * Animated value driven from the same handler, which stays on the native side.
 *
 * It claims a touch the moment it starts, so it never has to argue with the pan and
 * pinch handler wrapped round the canvas underneath.
 */
import { useMemo, useRef, type MutableRefObject } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { usePalette } from '../../components/ui';

/** Outer ring, in points. The knob travels to its edge. */
const RING = 132;
const KNOB = 54;
const TRAVEL = (RING - KNOB) / 2;

export function Stick({ value, onStart, onEnd }: {
  /** Written on every move; read by the renderer's frame loop. */
  value: MutableRefObject<{ x: number; y: number }>;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  const p = usePalette();
  const at = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const responder = useMemo(() => {
    const set = (dx: number, dy: number) => {
      // Clamped to the ring, so a thumb that slides off the edge still reads as
      // "full tilt that way" rather than as a bigger number the renderer must guess at.
      const len = Math.hypot(dx, dy);
      const f = len > TRAVEL ? TRAVEL / len : 1;
      const x = dx * f; const y = dy * f;
      at.setValue({ x, y });
      value.current.x = x / TRAVEL;
      value.current.y = y / TRAVEL;
    };
    const stop = () => {
      value.current.x = 0; value.current.y = 0;
      Animated.spring(at, { toValue: { x: 0, y: 0 }, useNativeDriver: false, speed: 40, bounciness: 4 }).start();
      onEnd?.();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { onStart?.(); },
      onPanResponderMove: (_e, g) => set(g.dx, g.dy),
      onPanResponderRelease: stop,
      onPanResponderTerminate: stop,
    });
  }, [at, value, onStart, onEnd]);

  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Walk your agent"
      accessibilityHint="Hold and drag to walk. Use Who's here to reach people without it."
      style={{
        width: RING, height: RING, borderRadius: RING / 2,
        backgroundColor: p.sunken, opacity: 0.9,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: p.accent,
          transform: [{ translateX: at.x }, { translateY: at.y }],
        }}
      />
    </View>
  );
}
