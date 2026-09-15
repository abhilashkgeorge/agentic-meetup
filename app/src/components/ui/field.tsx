/**
 * Text input as a well cut into the surface.
 *
 * This is the one place neumorphism is genuinely better than a border: a sunken field
 * says "put something here" without drawing a rectangle, which is how the style earns
 * its keep rather than merely looking soft.
 *
 * Focus deepens the well instead of adding a ring, for the same reason a pressed
 * button sinks — colour is not this language's way of saying anything.
 */
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, type TextStyle } from 'react-native';
import { radius, space, sunk, type, usePalette } from './theme';

export function Field({
  value,
  onChangeText,
  placeholder,
  label,
  hint,
  error,
  multiline,
  autoFocus,
  maxLength,
  keyboardType,
  autoCapitalize,
  autoComplete,
  textContentType,
  onSubmitEditing,
  minHeight,
  textStyle,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  error?: string | null;
  multiline?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'url' | 'number-pad' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'characters';
  /**
   * What the KEYBOARD should offer to fill in, and what the OS should understand this
   * field to be. Both are needed and they are not the same thing: `autoComplete` is
   * Android's hint, `textContentType` is iOS's.
   *
   * This is what makes a texted code appear above the keyboard as a single tap rather
   * than something to memorise, switch app, and retype. On a verification screen it
   * is the difference between a five-second step and a thirty-second one, and it is
   * also the only thing that stops people screenshotting the SMS.
   */
  autoComplete?: 'tel' | 'one-time-code' | 'off';
  textContentType?: 'telephoneNumber' | 'oneTimeCode' | 'none';
  onSubmitEditing?: () => void;
  minHeight?: number;
  textStyle?: TextStyle;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);

  // FOCUSED AFTER MOUNT, not by the `autoFocus` prop.
  //
  // autoFocus opens the keyboard while the screen is still mounting, so the "keyboard
  // opened" event fires before anything is listening for it -- and Android offers no
  // way to ask afterwards how tall the keyboard is. The screen then never lifts, and
  // the button underneath stays buried. One tick later the listeners exist and the
  // event is heard.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => input.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [autoFocus]);

  return (
    <View style={{ gap: space.sm }}>
      {label && <Text style={[type.label, { color: p.textSecondary }]}>{label.toUpperCase()}</Text>}
      <View
        style={{
          backgroundColor: p.sunken,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          paddingVertical: multiline ? space.md : space.sm,
          // Deeper when focused. The only state change, and it is still just light.
          boxShadow: sunk(p, focused ? 5 : 3),
        }}
      >
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={p.textTertiary}
          multiline={multiline}
          maxLength={maxLength}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel={label ?? placeholder}
          style={[
            type.body,
            {
              color: p.text,
              minHeight: minHeight ?? (multiline ? 110 : 34),
              textAlignVertical: multiline ? 'top' : 'center',
              paddingVertical: 0,
            },
            textStyle,
          ]}
        />
      </View>
      {error ? (
        <Text style={[type.callout, { color: p.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[type.callout, { color: p.textTertiary }]}>{hint}</Text>
      ) : null}
    </View>
  );
}
