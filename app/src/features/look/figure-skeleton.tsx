/**
 * A character on its way: a head, a body and legs, breathing where the 3D figure will
 * stand. Shown while the 3D engine starts and while the figure's model loads -- a spinner
 * on an empty well, before, and on the You tab a flat drawing too big for its box.
 */
import { View } from 'react-native';
import { SkeletonCircle, SkeletonGroup, SkeletonShape } from '../../components/ui';

export function FigureSkeleton({ height }: { height: number }) {
  const h = Math.max(60, height * 0.8);
  return (
    <SkeletonGroup label="Loading the character" style={{ alignItems: 'center', justifyContent: 'center', gap: h * 0.03 }}>
      <SkeletonCircle size={Math.round(h * 0.2)} />
      <SkeletonShape width={Math.round(h * 0.3)} height={Math.round(h * 0.38)} radius={Math.round(h * 0.08)} />
      <View style={{ flexDirection: 'row', gap: h * 0.04 }}>
        <SkeletonShape width={Math.round(h * 0.1)} height={Math.round(h * 0.3)} radius={Math.round(h * 0.04)} />
        <SkeletonShape width={Math.round(h * 0.1)} height={Math.round(h * 0.3)} radius={Math.round(h * 0.04)} />
      </View>
    </SkeletonGroup>
  );
}
