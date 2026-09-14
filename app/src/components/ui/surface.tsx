/**
 * The one primitive everything else is made of.
 *
 * In neumorphism a card, a button, a field and a tab bar are the same object at
 * different depths. Building them separately produces six slightly different greys and
 * eight slightly different shadows, which is exactly how this style goes wrong.
 *
 * Three states, and they are the whole vocabulary:
 *   raised   sitting on the surface — cards, buttons at rest
 *   sunken   pressed into it — held buttons, input wells, selected chips
 *   flat     no shadow at all — top bars, and anything inside an already-raised card
 */
import { type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { raised, radius as R, sunk, usePalette, whisper } from './theme';

export type Depth = 'raised' | 'sunken' | 'flat' | 'whisper';

export function Surface({
  children,
  depth = 'raised',
  radius = R.lg,
  strength = 6,
  style,
}: {
  children?: ReactNode;
  depth?: Depth;
  radius?: number;
  /** Extrusion in points. Small controls need less or they look like they float. */
  strength?: number;
  style?: ViewStyle;
}) {
  const p = usePalette();
  const shadow =
    depth === 'raised' ? raised(p, strength)
    : depth === 'sunken' ? sunk(p, Math.max(2, strength - 2))
    : depth === 'whisper' ? whisper(p)
    : undefined;

  return (
    <View
      style={[
        {
          backgroundColor: depth === 'sunken' ? p.sunken : p.bg,
          borderRadius: radius,
          // The whole style in one property. RN's boxShadow takes a list and supports
          // `inset`, which is what makes two-shadow neumorphism expressible at all --
          // the older shadowOffset API can do exactly one shadow and no inset.
          ...(shadow ? { boxShadow: shadow } : {}),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
