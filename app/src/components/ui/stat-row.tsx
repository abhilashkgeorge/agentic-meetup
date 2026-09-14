/**
 * A label on the left, a number on the right.
 *
 * ITS OWN COMPONENT BECAUSE THE OBVIOUS VERSION IS WRONG. Written inline it is a row
 * with two Texts and `space-between`, and it silently truncates: the label is a flex
 * item, the row squeezes it to fit the number, and Android clips text without drawing
 * an ellipsis. On the matches screen "the ages you want" rendered as "the ages you" and
 * looked like a sentence somebody had failed to finish.
 *
 * So the label takes the space that is left and wraps if it must, and the number is
 * never compressed. Both halves are needed: `flex: 1` alone lets the number shrink
 * instead, which is worse -- a truncated number is a wrong number.
 */
import { Text, View } from 'react-native';
import { space, type, usePalette } from './theme';

export function StatRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  /** For the quieter half of a list, where the number is the point. */
  muted?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: space.md,
      }}
    >
      <Text style={[type.callout, { color: p.textSecondary, flex: 1 }]}>{label}</Text>
      <Text style={[type.callout, { color: muted ? p.textTertiary : p.textSecondary, flexShrink: 0 }]}>
        {value}
      </Text>
    </View>
  );
}
