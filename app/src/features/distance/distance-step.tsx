/**
 * "How far would you travel?" as a map (the founder, 2026-10-01): where you are, a circle
 * for how far, a slider to change it, "Anywhere" for no limit, and a way to stand somewhere
 * else -- search a city or a part of Bengaluru, drag the map, or "Use my location".
 *
 * It opens on where the pool already has you (GET /v1/me/place) and on the distance you
 * said, or 25 km. In setup (`detect`) it also reads the phone's position if location was
 * already allowed -- never raising the dialog unasked -- and, when the pool only has your
 * city, starts on your neighbourhood instead.
 *
 * What it changes is saved by `saveDistance`, by the screen that holds it (setup's Next,
 * the editor's Save): moving the circle moves you (placeWrites), both ways.
 *
 * THE SEARCH IS A PAGE OF ITS OWN, not a box under the map. Under the map, the keyboard
 * lifted the screen's pinned button over the results: on the Seeker (2026-10-01) typing
 * "Indira" showed the box and Save, and Indiranagar was hidden beneath them. Setup puts an
 * animation and a title above the step as well, so no place on this screen is high enough.
 * On its own page the results sit right under the box, above any keyboard.
 */
import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { ANYWHERE_KM } from '@clone/shared';
import { getMyPlace, setEssential } from '../../lib/api';
import { pointFromDevice } from '../../lib/location';
import { useSession } from '../../store/session';
import {
  Button, Card, Chip, Field, Header, Row, Screen, space, type, usePalette,
} from '../../components/ui';
import { DistanceMap } from './distance-map';
import {
  DEFAULT_KM, kmAt, mapHeightFor, nearestSpot, placeWrites, positionOf, searchSpots, spotOf, type Spot,
} from './geo';
import { Slider } from './slider';

export interface DistanceChoice {
  /** Where the pool had you when the step opened. */
  from: Spot | null;
  /** Where you are now on the map. */
  spot: Spot | null;
  km: number;
  anywhere: boolean;
}

/** A place in words: "Indiranagar, Bengaluru", "Mumbai". */
export const spotWords = (s: Spot): string => (s.kind === 'area' ? `${s.name}, ${s.city}` : s.name);

/** Saves a choice: where you moved to (if you did), then how far. False if anything failed. */
export async function saveDistance(token: string, c: DistanceChoice): Promise<boolean> {
  if (c.spot) {
    for (const w of placeWrites(c.from, c.spot)) {
      const r = await setEssential(token, w.predicate, w.value, w.fix);
      if (!r?.ok) return false;
    }
  }
  const r = await setEssential(token, 'max_distance_km', String(c.anywhere ? ANYWHERE_KM : c.km));
  return Boolean(r?.ok);
}

export function DistanceStep({ detect, onChange }: {
  detect: boolean;
  onChange: (c: DistanceChoice) => void;
}) {
  const p = usePalette();
  const token = useSession((s) => s.token);
  const mapHeight = mapHeightFor(useWindowDimensions().height);
  const [from, setFrom] = useState<Spot | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [km, setKm] = useState(DEFAULT_KM);
  const [anywhere, setAnywhere] = useState(false);
  const [ready, setReady] = useState(false);
  const [searching, setSearching] = useState(false);
  /** The search page has finished opening: only then can its box take the keyboard. */
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    void (async () => {
      const place = await getMyPlace(token);
      if (!alive) return;
      const had = place ? spotOf(place) : null;
      let start = had;
      // Setup only, and only a sharper point in the SAME city: never moves somebody
      // somewhere they did not say, and never asks for location to do it.
      if (detect && had?.kind === 'city') {
        const here = await pointFromDevice(false);
        const s = here.ok ? nearestSpot(here.lat, here.lon) : null;
        if (alive && s && s.city === had.city && s.kind === 'area') start = s;
      }
      if (!alive) return;
      setFrom(had);
      setSpot(start);
      if (place?.km != null) {
        if (place.km >= ANYWHERE_KM) setAnywhere(true);
        else setKm(Math.min(200, Math.max(1, Math.round(place.km))));
      }
      setReady(true);
    })();
    return () => { alive = false; };
  }, [token, detect]);

  useEffect(() => {
    if (ready) onChange({ from, spot, km, anywhere });
  }, [ready, from, spot, km, anywhere, onChange]);

  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearching(false);
    setShown(false);
    setTyped('');
  }, []);

  const pick = useCallback((s: Spot) => {
    setSpot(s);
    setNote(null);
    closeSearch();
  }, [closeSearch]);

  const useMine = async () => {
    setNote(null);
    setLocating(true);
    const here = await pointFromDevice(true);
    setLocating(false);
    if (!here.ok) {
      setNote(here.reason === 'denied'
        ? 'No problem: search a place instead.'
        : 'Could not work out where you are. Search a place instead.');
      return;
    }
    const s = nearestSpot(here.lat, here.lon);
    if (s) { pick(s); return; }
    // A town the app does not list: stand on the phone's own coarse point, named by it.
    if (here.city) {
      pick({ kind: 'city', name: here.city, city: here.city, lat: here.lat, lon: here.lon, area: null,
             fix: { city: here.city, lat: here.lat, lon: here.lon, precisionKm: 2 } });
      return;
    }
    setNote('Could not name where you are. Search a place instead.');
  };

  const results = searchSpots(typed);
  return (
    <View style={{ gap: space.md }}>
      <DistanceMap token={token ?? null} spot={spot} km={km} anywhere={anywhere} height={mapHeight}
                   onSpot={pick} onMiss={() => setNote('No place near there. Search a city instead.')} />

      {/* HOW FAR COMES FIRST, right under the map: it is the question. On the Pixel
          (2026-10-01) the place line and "Use my location" came first and the slider was
          below Save -- the screen said "Move the slider" over a slider nobody could see. */}
      <View style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[type.bodyStrong, { color: p.text, flex: 1 }]}>
            {anywhere ? 'No distance limit' : `Up to ${km} km`}
          </Text>
          <Chip label="Anywhere" selected={anywhere} onPress={() => setAnywhere((v) => !v)} />
        </View>
        <Slider value={positionOf(km)} onChange={(t) => setKm(kmAt(t))} disabled={anywhere}
                label="How far" valueText={anywhere ? 'Anywhere' : `${km} kilometres`} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.bodyStrong, { color: p.text, flex: 1 }]} numberOfLines={1}>
          📍 {spot ? spotWords(spot) : 'No place yet'}
        </Text>
        <Pressable onPress={() => setSearching(true)} accessibilityRole="button"
                   accessibilityLabel="Change the place" hitSlop={8}>
          <Text style={[type.callout, { color: p.accent, fontFamily: type.bodyStrong.fontFamily }]}>
            Change
          </Text>
        </Pressable>
      </View>
      <Text style={[type.callout, { color: p.textTertiary }]}>
        Drag the map to move it. You are matched from this place, both ways.
      </Text>

      {/* The box is focused once the page is SHOWN, not when it mounts: on the Pixel
          (2026-10-01) focus came before the page's window had it, so the box blinked and
          the keyboard never opened. The Seeker happened to win that race. */}
      <Modal visible={searching} animationType="slide" onShow={() => setShown(true)} onRequestClose={closeSearch}>
        <Screen>
          <Header title="Choose a place" onBack={closeSearch} />
          <Field value={typed} onChangeText={setTyped} placeholder="Search a city or part of Bengaluru"
                 autoFocus={shown} />
          {results.length > 0 && (
            <Card>
              {results.map((s, i) => (
                <Row key={`${s.kind}:${s.name}`} title={spotWords(s)} onPress={() => pick(s)}
                     last={i === results.length - 1} />
              ))}
            </Card>
          )}
          <Text style={[type.callout, { color: p.textSecondary }]}>
            {typed.trim() !== '' && results.length === 0
              ? 'No place by that name yet.'
              : 'You will be matched from the place you choose, both ways.'}
          </Text>
        </Screen>
      </Modal>

      <Button label={locating ? 'Finding you…' : 'Use my location'} variant="secondary"
              loading={locating} disabled={locating} onPress={() => void useMine()} />

      {note && <Text style={[type.callout, { color: p.textSecondary }]}>{note}</Text>}
    </View>
  );
}
