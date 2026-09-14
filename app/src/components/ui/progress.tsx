/**
 * Progress as a groove with something raised sitting in it.
 *
 * The track is sunken and the fill is extruded, which is the clearest thing this
 * design language does: two objects at different depths, no colour needed to tell
 * them apart.
 */
import { Text, View } from 'react-native';
import { radius, raised, space, sunk, type, usePalette } from './theme';

export function Meter({ value, label }: { value: number; label?: string }) {
  const p = usePalette();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ gap: space.sm }}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
        accessibilityLabel={label}
        style={{
          height: 14,
          borderRadius: radius.pill,
          backgroundColor: p.sunken,
          boxShadow: sunk(p, 3),
          padding: 3,
        }}
      >
        <View
          style={{
            width: `${Math.max(pct * 100, 3)}%`,
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: p.accent,
            boxShadow: raised(p, 2),
          }}
        />
      </View>
      {label && <Text style={[type.callout, { color: p.textSecondary }]}>{label}</Text>}
    </View>
  );
}

/**
 * The countdown strip. Counts DOWN, not up -- Hinge does this deliberately, because
 * "three left" is survivable and "step four of nine" is where people quit.
 */
export function StepsLeft({ left, total }: { left: number; total: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: i < total - left ? 8 : 20,
            height: 8,
            borderRadius: radius.pill,
            backgroundColor: i < total - left ? p.accent : p.sunken,
            boxShadow: i < total - left ? undefined : sunk(p, 2),
          }}
        />
      ))}
      <Text style={[type.callout, { color: p.textTertiary, marginLeft: space.xs }]}>
        {left} left
      </Text>
    </View>
  );
}
