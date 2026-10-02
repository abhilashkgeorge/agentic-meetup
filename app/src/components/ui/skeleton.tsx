/**
 * Loading placeholders shaped like what is coming (the founder, 2026-10-02: "add a
 * skeleton loading screen when something is loading ... even the maps").
 *
 * A spinner says "wait"; a skeleton says "a list of four things is arriving", which is the
 * difference between a screen that feels slow and one that feels broken. And a skeleton
 * is never an EMPTY state: "Nothing waiting" shown before the list has loaded is a lie
 * that corrects itself a second later.
 *
 * ONE PULSE FOR THE WHOLE APP. Every placeholder on screen breathes together, off one
 * Animated value on the native driver: forty bars are forty views bound to one animation,
 * not forty loops. The loop runs only while at least one placeholder is mounted, and not
 * at all under the phone's Reduce Motion, where the bars simply stay put.
 *
 * The colour is the surface's own shadow tone, so a bar reads as part of the page in
 * either theme rather than as a grey sticker on it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View, type DimensionValue, type ViewStyle } from 'react-native';
import { Button } from './button';
import { Card } from './card';
import { radius as R, space, type, usePalette } from './theme';

/** How long one breath in or out takes, in ms. */
export const PULSE_MS = 900;
/** The pulse's range of opacity: never gone, never solid. */
export const PULSE_LOW = 0.35;
export const PULSE_HIGH = 0.75;

const pulse = new Animated.Value(PULSE_LOW);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;
let still = false;

function startPulse(): void {
  if (loop || still) return;
  const breathe = (to: number) => Animated.timing(pulse, {
    toValue: to, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
  });
  loop = Animated.loop(Animated.sequence([breathe(PULSE_HIGH), breathe(PULSE_LOW)]));
  loop.start();
}

function stopPulse(): void {
  loop?.stop();
  loop = null;
  pulse.setValue(PULSE_LOW);
}

/** How many placeholders are on screen now, and whether the pulse is running; for tests. */
export const pulseState = (): { users: number; running: boolean } => ({ users, running: loop !== null });

/**
 * Hold the shared pulse while one placeholder is on screen; returns the way to let go.
 * The first holder starts it; the last one to let go stops it. Letting go twice counts once.
 */
export function holdPulse(): () => void {
  users++;
  startPulse();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    users = Math.max(0, users - 1);
    if (users === 0) stopPulse();
  };
}

/** Reduce Motion on or off: on, the bars stay put; off again, they breathe if any are up. */
export function setStill(on: boolean): void {
  still = on;
  if (on) stopPulse(); else if (users > 0) startPulse();
}

/** The shared pulse, held for as long as the calling placeholder is on screen. */
export function useSkeletonPulse(): Animated.Value {
  useEffect(() => holdPulse(), []);
  return pulse;
}

// Reduce Motion: read once, and followed while the app runs.
void AccessibilityInfo.isReduceMotionEnabled?.().then(setStill).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', setStill);

/** One breathing shape. Everything below is this with a size and a corner. */
export function SkeletonShape({ width, height, radius, style }: {
  width: DimensionValue;
  height: DimensionValue;
  radius: number;
  style?: ViewStyle;
}) {
  const p = usePalette();
  const opacity = useSkeletonPulse();
  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width, height, borderRadius: radius, backgroundColor: p.dark, opacity }, style]}
    />
  );
}

/** A line of text that is on its way. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: DimensionValue }) {
  return <SkeletonShape width={width} height={height} radius={height / 2} />;
}

/** A face, a character or a round button that is on its way. */
export function SkeletonCircle({ size = 44 }: { size?: number }) {
  return <SkeletonShape width={size} height={size} radius={size / 2} />;
}

/** A picture, a map or a card-sized block that is on its way. */
export function SkeletonBlock({ width = '100%', height, radius = R.lg, style }: {
  width?: DimensionValue;
  height: DimensionValue;
  radius?: number;
  style?: ViewStyle;
}) {
  return <SkeletonShape width={width} height={height} radius={radius} style={style} />;
}

/**
 * What a screen reader hears instead of a dozen silent bars: "Loading". Every screen-sized
 * skeleton is wrapped in one.
 */
export function SkeletonGroup({ children, style, label = 'Loading' }: {
  children: ReactNode;
  style?: ViewStyle;
  label?: string;
}) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }}
          style={[{ gap: space.md }, style]}>
      {children}
    </View>
  );
}

/** A small heading, a title and a line under it: what most cards start with. */
export function SkeletonCard() {
  return (
    <View style={{ gap: space.sm }}>
      <Skeleton height={12} width="40%" />
      <Skeleton height={20} width="85%" />
      <Skeleton height={14} width="60%" />
    </View>
  );
}

/**
 * Rows of a list: an optional face, then a title and a shorter line. Widths vary a little
 * from row to row, as real names and messages do.
 */
export function SkeletonRows({ count = 4, avatar = 0 }: { count?: number; avatar?: number }) {
  const widths: DimensionValue[] = ['72%', '56%', '64%', '48%', '68%', '52%'];
  return (
    <View style={{ gap: space.lg }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          {avatar > 0 && <SkeletonCircle size={avatar} />}
          <View style={{ flex: 1, gap: space.sm }}>
            <Skeleton height={14} width={widths[i % widths.length]} />
            <Skeleton height={12} width={widths[(i + 3) % widths.length]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The width a line of text tends to have, for a screen of placeholders that should not look ruled. */
export function useSkeletonWidths(n: number): DimensionValue[] {
  const [w] = useState(() => Array.from({ length: n }, (_, i) => `${55 + ((i * 37) % 40)}%` as DimensionValue));
  return w;
}

/** A row of chips that is on its way: the answers of a question, a list of tags. */
export function SkeletonChips({ count = 4 }: { count?: number }) {
  const widths = [88, 120, 72, 104, 96, 64];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonShape key={i} width={widths[i % widths.length]!} height={40} radius={R.pill} />
      ))}
    </View>
  );
}

/** A conversation that is on its way: bubbles from either side. */
export function SkeletonBubbles({ count = 5 }: { count?: number }) {
  const widths: DimensionValue[] = ['62%', '48%', '70%', '40%', '56%', '66%'];
  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ alignItems: i % 2 === 0 ? 'flex-start' : 'flex-end' }}>
          <SkeletonShape width={widths[i % widths.length]!} height={i % 3 === 0 ? 64 : 44} radius={R.xl} />
        </View>
      ))}
    </View>
  );
}

/** A screen's big title that is on its way. */
export function SkeletonTitle({ width = '55%' }: { width?: DimensionValue }) {
  return <Skeleton height={30} width={width} />;
}

/**
 * Loading gave up: said, with a way to try again. Never a skeleton left breathing for ever,
 * and never an empty state that pretends there is nothing ("No conversations yet" for a
 * list that simply did not arrive).
 */
export function LoadFailed({ onRetry, what = 'this' }: { onRetry: () => void; what?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
      <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>
        {`Could not load ${what}. Check your connection.`}
      </Text>
      <Button label="Try again" onPress={onRetry} />
    </View>
  );
}

/**
 * A question that is on its way: the small label, the big title, a line of hint, and a
 * card of answers. Setup's steps, the interview, a card asked again, an editor.
 */
export function SkeletonQuestion({ chips = 4, label = 'Loading the question' }: { chips?: number; label?: string }) {
  return (
    <SkeletonGroup label={label} style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Skeleton height={12} width="30%" />
        <Skeleton height={30} width="80%" />
        <Skeleton height={30} width="45%" />
        <Skeleton height={14} width="70%" />
      </View>
      <Card>
        <SkeletonChips count={chips} />
      </Card>
    </SkeletonGroup>
  );
}

/**
 * True only once `on` has stayed true for `ms`: for a placeholder over something already
 * on screen (the next question, a refresh), so a quick answer does not flash one.
 */
export function useLate(on: boolean, ms = 250): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) { setLate(false); return; }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && late;
}

