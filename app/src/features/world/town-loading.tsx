/**
 * The town while it is on its way (the founder, 2026-10-02: "a skeleton loading screen
 * when something is loading ... even the maps").
 *
 * The town comes in three waits: the 3D engine (a spinner on an empty page, before), the
 * scene's first frame (a blank page, before -- the city is built in one go, so nothing
 * drew until it was done), and the square itself from the server ("Finding the square…",
 * with the title, the buttons and the counts missing). Now each wait shows the town's own
 * shape: a soft skyline where the city will stand, and the top bar's title and buttons and
 * the big button where they will be.
 *
 * The skyline breathes on the native driver, so it keeps moving even while the city is
 * being built on the JavaScript thread -- the one moment a JS-driven animation would
 * freeze.
 */
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Skeleton, SkeletonBlock, SkeletonGroup, SkeletonTitle, radius, space, usePalette } from '../../components/ui';

/** Heights of the skyline's blocks, as a share of the tallest. */
const SKYLINE = [0.45, 0.7, 0.55, 1, 0.6, 0.82, 0.5, 0.66, 0.4];

/** Where the city will stand: blocks of different heights on a ground line. */
export function Skyline() {
  const { width, height } = useWindowDimensions();
  const tallest = Math.min(220, height * 0.28);
  const block = Math.min(40, (width - space.screen * 2) / (SKYLINE.length * 1.5));
  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: block / 2 }}>
        {SKYLINE.map((h, i) => (
          <SkeletonBlock key={i} width={block} height={tallest * h} radius={6} />
        ))}
      </View>
      <Skeleton height={10} width={block * SKYLINE.length * 1.5} />
    </View>
  );
}

/** The top bar's shape: the title and your part of town on the left, the three buttons on the right. */
export function TownBarSkeleton() {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none"
          style={{ position: 'absolute', top: insets.top + space.sm, left: space.screen, right: space.screen,
                   flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ gap: space.sm, width: '45%', flexShrink: 0 }}>
        <SkeletonTitle width="80%" />
        <SkeletonBlock height={40} width="90%" radius={radius.pill} />
      </View>
      <View style={{ gap: space.sm, alignItems: 'flex-end', width: '40%', flexShrink: 0 }}>
        <SkeletonBlock height={40} width="80%" radius={radius.pill} />
        <SkeletonBlock height={40} width="95%" radius={radius.pill} />
        <SkeletonBlock height={40} width="100%" radius={radius.pill} />
      </View>
    </View>
  );
}

/** The bottom's shape: the line over the map, the big button, the counts under it. */
export function TownBottomSkeleton() {
  return (
    <View pointerEvents="none"
          style={{ position: 'absolute', bottom: space.lg, left: space.screen, right: space.screen,
                   gap: space.sm, alignItems: 'center' }}>
      <Skeleton height={22} width="55%" />
      <SkeletonBlock height={52} radius={radius.xl} />
      <Skeleton height={12} width="45%" />
    </View>
  );
}

/**
 * The whole town on its way. `overlay`: laid over the 3D view until it has drawn, so only
 * the skyline -- the bars are the HUD's own, drawn over it.
 */
export function TownLoading({ overlay = false }: { overlay?: boolean }) {
  const p = usePalette();
  return (
    <View pointerEvents="none"
          style={[{ backgroundColor: p.bg, justifyContent: 'center' },
                  overlay ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { flex: 1 }]}>
      <SkeletonGroup label="Loading the town">
        <Skyline />
      </SkeletonGroup>
      {!overlay && <TownBarSkeleton />}
      {!overlay && <TownBottomSkeleton />}
    </View>
  );
}
