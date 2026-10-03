/**
 * A character on its way: the orb that shapes itself -- circle, triangle, square -- where
 * the 3D figure will stand (components/ui/orb.tsx). Shown while the 3D engine starts and
 * while the figure's model loads: a spinner on an empty well, before, then grey bars in a
 * person's shape (2026-10-02), then this (the founder, 2026-10-03: thinking-orbs for every
 * loading animation).
 */
import { View } from 'react-native';
import { Orb } from '../../components/ui';

export function FigureLoading({ height }: { height: number }) {
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <Orb state="shaping" size={Math.round(Math.min(96, Math.max(40, height * 0.4)))} label="Loading the character" />
    </View>
  );
}
