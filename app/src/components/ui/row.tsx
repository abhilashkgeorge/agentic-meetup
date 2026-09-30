/**
 * The list row, and the stat.
 *
 * Instagram's settings and profile screens are almost entirely these two shapes. Both
 * exist here so that a screen full of information does not become a screen full of
 * bespoke flexbox.
 */
import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Crease } from './card';
import { HIT, space, type, usePalette } from './theme';

export function Row({
  title,
  subtitle,
  left,
  value,
  onPress,
  danger,
  last,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  /** Right-aligned current value. The thing that makes a settings row useful. */
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const p = usePalette();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: HIT }}>
      {left}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[type.body, { color: danger ? p.danger : p.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[type.callout, { color: p.textTertiary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {/* A long value gives way, cut with an ellipsis, and never takes more than just over
          half the row: unshrinkable, the server's address squeezed its title to "Serve" over
          "r" (Settings, on the Pixel, 2026-09-30). */}
      {value !== undefined && (
        <Text style={[type.callout, { color: p.textSecondary, flexShrink: 1, maxWidth: '55%' }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {onPress && <Text style={{ color: p.textTertiary, fontSize: 20 }}>›</Text>}
    </View>
  );

  return (
    <View>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
                   style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          {body}
        </Pressable>
      ) : (
        body
      )}
      {!last && <Crease />}
    </View>
  );
}

/** Three numbers across the top of a profile. Instagram's posts/followers/following. */
export function Stats({ items }: { items: { value: string; label: string }[] }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      {items.map((s) => (
        <View key={s.label} style={{ alignItems: 'center', gap: 2 }}>
          <Text style={[type.title, { color: p.text }]}>{s.value}</Text>
          <Text style={[type.label, { color: p.textTertiary }]}>{s.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A loading placeholder shaped like the thing that is coming.
 *
 * A spinner says "wait"; a skeleton says "a list of four things is arriving", which is
 * the difference between a screen that feels slow and one that feels broken.
 */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | `${number}%` }) {
  const p = usePalette();
  return (
    <View
      style={{
        height,
        width,
        borderRadius: height / 2,
        backgroundColor: p.sunken,
        opacity: 0.7,
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <View style={{ gap: space.sm }}>
      <Skeleton height={12} width="40%" />
      <Skeleton height={20} width="85%" />
      <Skeleton height={14} width="60%" />
    </View>
  );
}
