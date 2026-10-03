/**
 * Something on its way: a thinking orb (orb.tsx), big, with a line saying what is coming.
 *
 * WHAT IT REPLACES. Grey bars shaped like the content (the founder, 2026-10-02: "add a
 * skeleton loading screen"); then small orbs (2026-10-03: "for the map loading animation
 * and all the other animation for loading https://github.com/Jakubantalik/thinking-orbs
 * use this please"); then, the next day: "the loading animations looks not well thought
 * out. it is very small. use an appropriate loading animation and cover the screen with
 * it". So a screen that is waiting is the orb: most of the screen's width, in the middle
 * of the space below the title, the words under it.
 *
 * `section`: a part of a screen on its way inside a card (Settings' invites, "How you
 * appear", "It knows") -- a smaller orb in the card's own space, not the whole screen.
 *
 * Still never an EMPTY state: "Nothing waiting" shown before a list has loaded is a lie
 * that corrects itself a second later, and this says "on its way" instead.
 */
import { useEffect, useState } from 'react';
import { Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Button } from './button';
import { Orb, type OrbState } from './orb';
import { SCREEN_SHARE, SECTION_ORB, screenOrb } from './loading-size';
import { space, type, usePalette } from './theme';


export function Loading({ label = 'Loading', orb = 'working', section = false, style }: {
  /** What is coming, said under the orb and to a screen reader: "Loading your matches". */
  label?: string;
  /** Which animation (orb.tsx lists what each says). */
  orb?: OrbState;
  /** A part of a screen inside its card, not the whole screen. */
  section?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  const size = section ? SECTION_ORB : screenOrb(width, height);
  return (
    <View style={[{ minHeight: section ? 180 : height * SCREEN_SHARE, alignItems: 'center', justifyContent: 'center', gap: space.lg }, style]}>
      <Orb state={orb} size={size} label={label} />
      {!section && (
        <Text style={[type.callout, { color: p.textSecondary, textAlign: 'center' }]}>{`${label}…`}</Text>
      )}
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
