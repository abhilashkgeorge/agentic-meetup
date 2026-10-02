/**
 * The town while it is on its way (the founder, 2026-10-02: "a skeleton loading screen
 * when something is loading ... even the maps").
 *
 * The town comes in three waits: the 3D engine (a spinner on an empty page, before), the
 * scene's first frame (a blank page, before -- the city is built in one go, so nothing
 * drew until it was done), and the square itself from the server ("Finding the square…",
 * with the title, the buttons and the counts missing). Now each wait shows the town's own
 * shape: the map's ground, seen as the map is seen -- a tilted square of neighbourhood
 * tiles with streets between them, yours a shade of the accent -- and the top bar's title
 * and buttons and the big button where they will be.
 *
 * NOT A SKYLINE. The first placeholder was a row of bars of different heights, meant as
 * buildings; the founder saw a bar chart (2026-10-03: "Why is there a bar chart before
 * the square map loads. Makes no sense"). The map is a square of tiles from above, so
 * that is what stands in for it.
 *
 * It breathes on the native driver, so it keeps moving even while the city is being
 * built on the JavaScript thread -- the one moment a JS-driven animation would freeze.
 */
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Skeleton, SkeletonBlock, SkeletonGroup, SkeletonTitle, radius, space, usePalette } from '../../components/ui';

/** Tiles along each side of the map's square: the city's neighbourhoods, roughly. */
export const MAP_TILES = 4;
/** Which tile is yours, tinted the accent as your part of town is on the real map. */
const YOURS = 6;
/** How flat the map lies: the town's camera looks down at about 35 degrees. */
export const MAP_TILT = 0.58;

/**
 * Where the city will be: its ground, a square of tiles with streets between, turned and
 * tilted the way the map is (rotated 45 degrees, flattened to MAP_TILT).
 */
export function MapGround() {
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  // The square's side, so that turned 45 degrees it spans most of the screen's width.
  const side = Math.min((width - space.screen * 2) / Math.SQRT2, height * 0.42);
  const gap = Math.max(6, side / 28);
  const tile = (side - gap * (MAP_TILES - 1)) / MAP_TILES;
  return (
    <View style={{ height: side * Math.SQRT2 * MAP_TILT, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: side, height: side, flexDirection: 'row', flexWrap: 'wrap', gap,
        transform: [{ scaleY: MAP_TILT }, { rotate: '45deg' }],
      }}>
        {Array.from({ length: MAP_TILES * MAP_TILES }, (_, i) => (
          <SkeletonBlock key={i} width={tile} height={tile} radius={4}
                         style={i === YOURS ? { backgroundColor: p.accent } : undefined} />
        ))}
      </View>
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
 * the map's ground -- the bars are the HUD's own, drawn over it.
 */
export function TownLoading({ overlay = false }: { overlay?: boolean }) {
  const p = usePalette();
  return (
    <View pointerEvents="none"
          style={[{ backgroundColor: p.bg, justifyContent: 'center' },
                  overlay ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { flex: 1 }]}>
      <SkeletonGroup label="Loading the town">
        <MapGround />
      </SkeletonGroup>
      {!overlay && <TownBarSkeleton />}
      {!overlay && <TownBottomSkeleton />}
    </View>
  );
}
