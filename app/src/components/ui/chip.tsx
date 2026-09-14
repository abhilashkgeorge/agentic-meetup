/**
 * A choice that sinks when taken.
 *
 * Multi-select is the workhorse of dating onboarding — who you want to meet, what you
 * are here for, what you will not put up with. Selected is SUNKEN rather than filled,
 * so a row of eight choices stays one colour and the eye reads depth instead of
 * hunting for a tint.
 */
import { Pressable, Text, View } from 'react-native';
import { HIT, radius, raised, space, sunk, type, usePalette } from './theme';

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      accessibilityLabel={label}
      style={{
        minHeight: HIT - 8,
        justifyContent: 'center',
        // NEVER SQUEEZED, in any direction.
        //
        // In a wrapping row the last chip on a line was sometimes compressed into the
        // space left rather than moving to the next line, and "A dealbreaker" rendered
        // as "A" -- the label was right, the box was too narrow, and Android clips
        // rather than showing an ellipsis.
        //
        // All four properties, because one was not enough: `flexShrink` stops it being
        // compressed, `flexGrow` stops it being stretched, `flexBasis: auto` makes its
        // size come from its content rather than from the space available, and
        // `alignSelf` keeps it out of the row's stretch behaviour entirely. Sizing a
        // chip from its label is the only correct answer; everything else is the row
        // having an opinion about a word.
        flexShrink: 0,
        flexGrow: 0,
        flexBasis: 'auto',
        alignSelf: 'flex-start',
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        backgroundColor: selected ? p.sunken : p.bg,
        boxShadow: selected ? sunk(p, 3) : raised(p, 4),
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        // The label must not shrink either. A Text inside a squeezed parent is the
        // other half of the same bug, and it is the half that actually clips.
        numberOfLines={1}
        style={[
          type.callout,
          {
            color: selected ? p.accent : p.textSecondary,
            fontFamily: type.bodyStrong.fontFamily,
            flexShrink: 0,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipGroup({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>
  );
}
