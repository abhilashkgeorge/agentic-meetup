/**
 * Something on its way: a thinking orb in the middle of the space it will fill (orb.tsx).
 *
 * WHAT IT REPLACES. Grey bars shaped like the content, breathing (the founder, 2026-10-02:
 * "add a skeleton loading screen when something is loading"); then, the next day: "for the
 * map loading animation and all the other animation for loading
 * https://github.com/Jakubantalik/thinking-orbs use this please". Every screen that had a
 * skeleton group now shows one orb, in the state that says what is coming.
 *
 * Still never an EMPTY state: "Nothing waiting" shown before a list has loaded is a lie
 * that corrects itself a second later, and this says "on its way" instead.
 */
import { useEffect, useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from './button';
import { Orb, type OrbState } from './orb';
import { space, type, usePalette } from './theme';

/** How much room a loading block takes at least, so a screen does not jump when it arrives. */
export const LOADING_MIN_HEIGHT = 220;

export function Loading({ label = 'Loading', orb = 'working', size = 64, style }: {
  /** What a screen reader hears: "Loading your matches". */
  label?: string;
  /** Which animation (orb.tsx lists what each says). */
  orb?: OrbState;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ minHeight: LOADING_MIN_HEIGHT, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Orb state={orb} size={size} label={label} />
    </View>
  );
}

/**
 * Loading gave up: said, with a way to try again. Never an orb left turning for ever, and
 * never an empty state that pretends there is nothing ("No conversations yet" for a list
 * that simply did not arrive).
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
 * True only once `on` has stayed true for `ms`: for a loader over something already on
 * screen (the next question, a refresh), so a quick answer does not flash one.
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
