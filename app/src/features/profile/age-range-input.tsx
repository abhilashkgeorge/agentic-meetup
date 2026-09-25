/**
 * The ages you would meet, as two boxes: from, and to.
 *
 * Shared by the setup wizard and the profile editor, so the range somebody sets during
 * setup is changed later on the same two boxes rather than on a second design of them.
 *
 * Boxes rather than a slider. A two-thumb slider is fiddly with a thumb at the size of
 * a phone, and the pre-fill has to be READ -- "27 to 37" in two boxes is a sentence
 * somebody takes in at a glance, where two dots on a track is a thing they squint at.
 * The boxes hold text, not numbers, so a half-typed "2" can sit there on its way to
 * "25"; the caller turns it into a range only when it is a valid one.
 */
import { Text, View } from 'react-native';
import { Field, space, type, usePalette } from '../../components/ui';
import { AGE_CEIL, AGE_FLOOR, parseAgeRange } from './age-range';

export interface AgeRangeText { min: string; max: string }

export function AgeRangeInput({
  value,
  onChange,
}: {
  value: AgeRangeText;
  onChange: (next: AgeRangeText) => void;
}) {
  const p = usePalette();
  // Only once both boxes hold something: a sentence in red while somebody is still
  // typing the second number tells them off for a thing they have not finished.
  const typed = value.min.trim() !== '' && value.max.trim() !== '';
  const bad = typed && parseAgeRange(value.min, value.max) === null;
  const digits = (t: string) => t.replace(/\D/g, '');

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="From"
            value={value.min}
            onChangeText={(t) => onChange({ ...value, min: digits(t) })}
            placeholder={String(AGE_FLOOR)}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="To"
            value={value.max}
            onChangeText={(t) => onChange({ ...value, max: digits(t) })}
            placeholder={String(AGE_CEIL)}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
      </View>
      {bad && (
        <Text style={[type.callout, { color: p.danger }]}>
          {`Between ${AGE_FLOOR} and ${AGE_CEIL}, and the first no higher than the second.`}
        </Text>
      )}
    </View>
  );
}
