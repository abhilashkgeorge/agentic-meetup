/**
 * The top bar: flat, per the spec, with extruded circular buttons for actions.
 *
 * Instagram's header is the app's quietest element -- no fill, no shadow, no line
 * under it. The title is small and the content starts immediately. Here that suits
 * neumorphism exactly: a raised bar would compete with every card beneath it.
 */
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { RoundButton } from './button';
import { space, type, usePalette } from './theme';

export function Header({
  title,
  onBack,
  right,
  avatar,
}: {
  title?: string;
  onBack?: () => void;
  right?: { glyph: string; label: string; onPress: () => void };
  /** Sits beside the title. A conversation with a person should show the person. */
  avatar?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space.screen,
        paddingVertical: space.md,
        gap: space.md,
      }}
    >
      <View style={{ width: 44 }}>
        {onBack && <RoundButton glyph="‹" label="Back" onPress={onBack} />}
      </View>
      <View style={{
        flex: 1, flexDirection: 'row', alignItems: 'center',
        justifyContent: 'center', gap: space.sm,
      }}>
        {avatar}
        <Text numberOfLines={1} style={[type.heading, { color: p.text }]}>
          {title ?? ''}
        </Text>
      </View>
      <View style={{ width: 44, alignItems: 'flex-end' }}>
        {right && <RoundButton glyph={right.glyph} label={right.label} onPress={right.onPress} />}
      </View>
    </View>
  );
}

/**
 * Instagram's big left-aligned screen title, which sits UNDER the bar rather than in
 * it. Gives a screen a name without spending the top 56 points on chrome.
 */
export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: space.xs, paddingHorizontal: space.screen, paddingBottom: space.md }}>
      <Text style={[type.display, { color: p.text }]}>{title}</Text>
      {subtitle && <Text style={[type.body, { color: p.textSecondary }]}>{subtitle}</Text>}
    </View>
  );
}
