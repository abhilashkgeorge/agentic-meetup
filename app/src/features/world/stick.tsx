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
 *
 * THE LOOK IS GLASS, NOT A PLATE. It used to be a filled `sunken` disc with a solid
 * accent knob -- the design system's neumorphism, which works because everything on a
 * page is the same colour as the page. Over a park it is not over a page: it was an
 * opaque grey coin stuck on the grass. So the ring is a dark tint with one bright hair
 * of a rim, the centre is a hole rather than a button, and the accent survives as the
 * glow around that hole. Four marks at the quarters say which way is which without
 * printing anything. Every layer is a translucent View: no blur library, no SVG, no
 * shadow -- `elevation` on Android draws a black drop shadow and would put a smudge
 * under the thing that is meant to be glass.
 */
import { useMemo, useRef, type MutableRefObject } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { usePalette } from '../../components/ui';

/** Outer ring, in points. The knob travels to its edge. */
const RING = 132;
const KNOB = 54;
const TRAVEL = (RING - KNOB) / 2;
/** The four quarter marks, on a circle this far out from the middle. */
const MARK_R = 52;
const MARK = 5;

/**
 * Where the knob sits for a thumb this far from where it landed, and what that means
 * to the renderer.
 *
 * PURE, AND EXPORTED, so the guard can hold the feel still while the paint changes.
 * A stick is the one control whose whole quality is how far your thumb has to move;
 * this returns both the pixels the knob moves and the -1..1 the walk reads, and they
 * come from the same clamp so they cannot drift apart. Past the edge it is full tilt
 * that way rather than a bigger number the renderer would have to guess at.
 */
export function knobAt(dx: number, dy: number): { x: number; y: number; nx: number; ny: number } {
  const len = Math.hypot(dx, dy);
  const f = len > TRAVEL ? TRAVEL / len : 1;
  const x = dx * f;
  const y = dy * f;
  return { x, y, nx: x / TRAVEL, ny: y / TRAVEL };
}

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
      const { x, y, nx, ny } = knobAt(dx, dy);
      at.setValue({ x, y });
      value.current.x = nx;
      value.current.y = ny;
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

  /** North, east, south, west, centred on their own dots. */
  const marks = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

  return (
    <View
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Walk your agent"
      accessibilityHint="Hold and drag to walk. Use Who's here to reach people without it."
      style={{
        width: RING, height: RING, borderRadius: RING / 2,
        // Dark enough to read on grass, clear enough to see the grass through.
        backgroundColor: 'rgba(12,14,22,0.24)',
        borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.72)',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* A second hair of a rim, just inside: the thickness of glass, not a border. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 6, left: 6, right: 6, bottom: 6,
          borderRadius: (RING - 12) / 2,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
        }}
      />

      {marks.map(([mx, my], i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: RING / 2 - 1.5 + mx * MARK_R - MARK / 2,
            top: RING / 2 - 1.5 + my * MARK_R - MARK / 2,
            width: MARK, height: MARK, borderRadius: MARK / 2,
            backgroundColor: 'rgba(255,255,255,0.7)',
          }}
        />
      ))}

      {/* Knob and its glow ride together, so the light never comes off the hole. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', alignItems: 'center', justifyContent: 'center',
          transform: [{ translateX: at.x }, { translateY: at.y }],
        }}
      >
        {/* Two rings of bloom instead of a blur: wide and faint, then tight and bright. */}
        <View style={{
          position: 'absolute', width: KNOB + 26, height: KNOB + 26,
          borderRadius: (KNOB + 26) / 2, backgroundColor: p.accent, opacity: 0.1,
        }} />
        <View style={{
          position: 'absolute', width: KNOB + 12, height: KNOB + 12,
          borderRadius: (KNOB + 12) / 2, backgroundColor: p.accent, opacity: 0.18,
        }} />
        {/* The hole. Darker than the ring, so it reads as depth and not as a button. */}
        <View style={{
          width: KNOB, height: KNOB, borderRadius: KNOB / 2,
          backgroundColor: 'rgba(6,8,16,0.66)',
          borderWidth: 2, borderColor: p.accent,
        }} />
      </Animated.View>
    </View>
  );
}
