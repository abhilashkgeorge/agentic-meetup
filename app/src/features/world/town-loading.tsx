/**
 * The town while it is on its way: the "searching" thinking orb -- a dotted globe turning,
 * a scan sweeping round it -- in the middle of the page (the founder, 2026-10-03: "for the
 * map loading animation and all the other animation for loading
 * https://github.com/Jakubantalik/thinking-orbs use this please").
 *
 * The town comes in three waits, and this stands in for each: the 3D engine loading, the
 * scene's first frame (laid over the 3D view until it has drawn), and -- at launch -- the
 * session being checked. Before: a spinner on an empty page; then a row of bars meant as
 * buildings, which the founder saw as a bar chart; then a tilted square of map tiles.
 *
 * ON THE NATIVE DRIVER (components/ui/globe-orb.tsx), because every one of those waits is
 * the JavaScript thread at its busiest -- the app starting, the 3D code loading, the city
 * being built -- and an orb drawn from JavaScript would stand still through all of it.
 */
import { View } from 'react-native';
import { GlobeOrb, usePalette } from '../../components/ui';

/** How big the globe is, in dp: the middle of the page, not the whole of it. */
export const TOWN_ORB = 120;

/** The whole town on its way. `overlay`: laid over the 3D view until it has drawn. */
export function TownLoading({ overlay = false }: { overlay?: boolean }) {
  const p = usePalette();
  return (
    <View pointerEvents="none"
          style={[{ backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' },
                  overlay ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { flex: 1 }]}>
      <GlobeOrb size={TOWN_ORB} label="Loading the town" />
    </View>
  );
}
