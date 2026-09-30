/**
 * A button that is moulded out of the background rather than drawn on top of it.
 *
 * Pressing does not change its colour. It sinks — the same two shadows, inverted —
 * because that is the only affordance this style has and using colour instead would
 * break the illusion the whole design rests on.
 *
 * `primary` is the one exception: it takes the accent fill, because a screen where
 * every control is the same grey has no primary action, and Instagram's discipline is
 * that there is exactly one obvious next step per screen.
 */
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { Surface } from './surface';
import { HIT, radius, raised, space, sunk, type, usePalette } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const p = usePalette();
  const dead = disabled || loading;

  if (variant === 'ghost') {
    return (
      <Pressable
        onPress={onPress}
        disabled={dead}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!dead }}
        style={({ pressed }) => [
          { minHeight: HIT, justifyContent: 'center', alignItems: 'center', opacity: pressed ? 0.5 : 1 },
          style,
        ]}
      >
        <Text numberOfLines={1} textBreakStrategy="simple" style={[type.bodyStrong, { color: dead ? p.textTertiary : p.textSecondary }]}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={dead}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!dead, busy: !!loading }}
      style={({ pressed }) => [
        {
          minHeight: HIT,
          borderRadius: radius.lg,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: space.lg,
          backgroundColor: variant === 'primary' && !dead ? p.accent : p.bg,
          opacity: dead ? 0.55 : 1,
          // Sinking on press IS the feedback. No colour change, no scale.
          boxShadow: pressed ? sunk(p, 4) : raised(p, 5),
        },
        style,
      ]}
    >
      {/* One line, and Android's simple line breaking: with the default ("highQuality")
          Android measured "Add another" a hair narrower than it drew it, wrapped the last
          word onto a second line, and the button showed only "Add" (the release app on
          the Pixel, 2026-09-30). A label is never two lines. */}
      <Text
        numberOfLines={1}
        textBreakStrategy="simple"
        style={[
          type.bodyStrong,
          { color: variant === 'primary' && !dead ? p.accentText : dead ? p.textTertiary : p.text },
        ]}
      >
        {loading ? '…' : label}
      </Text>
    </Pressable>
  );
}

/** The extruded circle the spec asks for in top bars. Back arrows, close, overflow. */
export function RoundButton({
  glyph,
  onPress,
  label,
  size = 44,
}: {
  glyph: string;
  onPress: () => void;
  /** Spoken name. A glyph is not a label to anybody using a screen reader. */
  label: string;
  size?: number;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // The circle is 44pt but the touch target is not, so the hit area is widened
      // rather than the button.
      hitSlop={8}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: p.bg,
        boxShadow: pressed ? sunk(p, 3) : raised(p, 4),
      })}
    >
      <Text style={{ color: p.textSecondary, fontSize: 18 }}>{glyph}</Text>
    </Pressable>
  );
}

/** A row of buttons that share the width evenly. Used for yes/no pairs. */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: space.md }}>{children}</View>;
}
