/**
 * The map behind "How far would you travel?": real streets (OpenStreetMap, through our
 * server -- features/distance/tiles.ts), the person's place at the centre, and a circle for
 * the distance. The circle stays one size on screen and the map zooms under it, so moving
 * the slider reads at a glance: 5 km is a neighbourhood, 200 km is half the state.
 *
 * DRAGGING MOVES WHERE YOU ARE (the founder, 2026-10-01: "move you there"). The map slides
 * under the circle; let go and the centre lands on the nearest named place -- a Bengaluru
 * neighbourhood or a listed city (geo.ts nearestSpot) -- or springs back if there is none.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Text, View, type LayoutChangeEvent } from 'react-native';
import { Orb, radius, type, usePalette } from '../../components/ui';
import { nearestSpot, shifted, tilesFor, zoomFor, type PlacedTile, type Spot } from './geo';
import { useTile } from './tiles';

/** India, for a person with no place yet. */
const NOWHERE = { lat: 21, lon: 78.9 };
/** How far out "Anywhere" and "no place yet" show the map: a country at a glance. */
const WIDE_ZOOM = 3.6;
/** The circle's radius as a share of the map's shorter side. */
const CIRCLE = 0.38;

const Tile = memo(function Tile({ token, t, onSettled }: {
  token: string | null;
  t: PlacedTile;
  /** Told once this tile has its picture, or has given up on it. */
  onSettled: (key: string, settled: boolean) => void;
}) {
  const data = useTile(token, t.z, t.x, t.y);
  const settled = data !== undefined;
  useEffect(() => { onSettled(t.key, settled); }, [onSettled, t.key, settled]);
  if (!data) return null;
  // Half a dp of overlap, so fractional sizes never leave a hairline between tiles.
  return <Image source={{ uri: data }} fadeDuration={0}
                style={{ position: 'absolute', left: t.left, top: t.top, width: t.size + 0.5, height: t.size + 0.5 }} />;
});

export function DistanceMap({ token, spot, km, anywhere, onSpot, onMiss, height = 280 }: {
  token: string | null;
  spot: Spot | null;
  km: number;
  anywhere: boolean;
  /** The centre was dragged onto another named place. */
  onSpot: (s: Spot) => void;
  /** Dragged to somewhere with no named place: it sprang back. */
  onMiss: () => void;
  height?: number;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const pan = useRef(new Animated.ValueXY()).current;
  const at = spot ?? NOWHERE;
  const r = Math.min(width || 300, height) * CIRCLE;
  const zf = spot && !anywhere ? zoomFor(km, r, at.lat) : WIDE_ZOOM;
  const tiles = useMemo(() => (width ? tilesFor(at.lat, at.lon, zf, width, height) : []), [at.lat, at.lon, zf, width, height]);

  // THE MAP BREATHES UNTIL ITS PICTURES ARE HERE (the founder, 2026-10-02: "a skeleton
  // ... even the maps"). Tiles come one by one, through the server; a placeholder under
  // them pulses wherever one is still on its way, and goes once every tile in view has
  // arrived or been given up on -- never left pulsing over a map that is not coming.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const onSettled = useCallback((key: string, done: boolean) => {
    setSettled((had) => {
      if (had.has(key) === done) return had;
      const next = new Set(had);
      if (done) next.add(key); else next.delete(key);
      return next;
    });
  }, []);
  const waiting = token !== null && (width === 0 || tiles.some((t) => !settled.has(t.key)));

  // Kept in refs so the responder, made once, always reads the current map.
  const now = useRef({ at, zf, spot });
  now.current = { at, zf, spot };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: (_e, g) => Math.hypot(g.dx, g.dy) > 6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => pan.setValue({ x: g.dx, y: g.dy }),
    onPanResponderRelease: (_e, g) => {
      if (Math.hypot(g.dx, g.dy) < 6) { pan.setValue({ x: 0, y: 0 }); return; }
      const { at: c, zf: z, spot: was } = now.current;
      const to = shifted(c.lat, c.lon, z, -g.dx, -g.dy);
      const found = nearestSpot(to.lat, to.lon);
      if (found && !(was && found.name === was.name && found.city === was.city)) {
        pan.setValue({ x: 0, y: 0 });
        onSpot(found);
      } else {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
        if (!found) onMiss();
      }
    },
    onPanResponderTerminate: () => Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start(),
  }), [pan, onSpot, onMiss]);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: waiting ? p.bg : '#e9e6df' }}
      accessible
      accessibilityLabel={spot
        ? (anywhere ? `Map around ${spot.name}. Anywhere: no distance limit.` : `Map around ${spot.name}, a circle of ${km} kilometres.`)
        : 'Map of India. No place chosen yet.'}
      {...responder.panHandlers}
    >
      {waiting && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, height, alignItems: 'center', justifyContent: 'center' }}>
          <Orb state="searching" size={Math.round(height * 0.62)} label="Loading the map" />
        </View>
      )}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width, height, transform: pan.getTranslateTransform() }}>
        {tiles.map((t) => <Tile key={t.key} token={token} t={t} onSettled={onSettled} />)}
      </Animated.View>

      {spot && !anywhere && (
        <View pointerEvents="none" style={{
          position: 'absolute', left: width / 2 - r, top: height / 2 - r, width: 2 * r, height: 2 * r, borderRadius: r,
          borderWidth: 2, borderColor: p.accent, backgroundColor: `${p.accent}22`,
        }} />
      )}
      {spot && (
        <View pointerEvents="none" style={{
          position: 'absolute', left: width / 2 - 7, top: height / 2 - 7, width: 14, height: 14, borderRadius: 7,
          backgroundColor: p.accent, borderWidth: 2, borderColor: '#ffffff',
        }} />
      )}
      {(anywhere || !spot) && (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: height / 2 - 18, alignItems: 'center' }}>
          <Text style={[type.callout, {
            color: '#222', backgroundColor: 'rgba(255,255,255,0.88)', paddingHorizontal: 12, paddingVertical: 6,
            borderRadius: 14, overflow: 'hidden', fontFamily: type.bodyStrong.fontFamily,
          }]}>
            {anywhere ? 'Anywhere' : 'Choose a place below'}
          </Text>
        </View>
      )}
      {/* Required by OpenStreetMap's tile policy, and fair. */}
      <Text pointerEvents="none" style={{
        position: 'absolute', right: 4, bottom: 4, fontSize: 10, color: '#333',
        backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 4, borderRadius: 3, overflow: 'hidden',
      }}>
        © OpenStreetMap
      </Text>
    </View>
  );
}
