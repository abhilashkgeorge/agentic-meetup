/**
 * The block Instagram is built out of, moulded instead of outlined.
 *
 * One idea per card. A card with two unrelated things in it is two cards that have not
 * been separated yet -- and in this style they cannot be told apart by a border,
 * because there are none.
 */
import { type ReactNode } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { Surface } from './surface';
import { radius, space, type, usePalette } from './theme';

export function Card({
  children,
  label,
  style,
}: {
  children: ReactNode;
  /** The small caps header. Instagram's way of naming a block without a title bar. */
  label?: string;
  style?: ViewStyle;
}) {
  const p = usePalette();
  return (
    <Surface radius={radius.lg} style={{ padding: space.screen, gap: space.md, ...style }}>
      {label && <Text style={[type.label, { color: p.textSecondary }]}>{label.toUpperCase()}</Text>}
      {children}
    </Surface>
  );
}

/**
 * A divider that is a crease in the surface rather than a line on it. One pixel of
 * shadow and one of highlight -- the same trick as everything else, at its smallest.
 */
export function Crease() {
  const p = usePalette();
  return (
    <View style={{ height: 2, marginVertical: space.xs }}>
      <View style={{ height: 1, backgroundColor: p.dark, opacity: 0.35 }} />
      <View style={{ height: 1, backgroundColor: p.light, opacity: 0.8 }} />
    </View>
  );
}

/** The empty state. Instagram never shows a blank screen; it shows an invitation. */
export function Empty({ title, body }: { title: string; body: string }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxl }}>
      <Text style={[type.heading, { color: p.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.body, { color: p.textSecondary, textAlign: 'center' }]}>{body}</Text>
    </View>
  );
}
