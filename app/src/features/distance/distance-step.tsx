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
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ANYWHERE_KM } from '@clone/shared';
import { getMyPlace, setEssential } from '../../lib/api';
import { pointFromDevice } from '../../lib/location';
import { useSession } from '../../store/session';
import { Button, Chip, ChipGroup, Field, space, type, usePalette } from '../../components/ui';
import { DistanceMap } from './distance-map';
import {
  DEFAULT_KM, kmAt, nearestSpot, placeWrites, positionOf, searchSpots, spotOf, type Spot,
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
  const [from, setFrom] = useState<Spot | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [km, setKm] = useState(DEFAULT_KM);
  const [anywhere, setAnywhere] = useState(false);
  const [ready, setReady] = useState(false);
  const [searching, setSearching] = useState(false);
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

  const pick = useCallback((s: Spot) => {
    setSpot(s);
    setNote(null);
    setSearching(false);
    setTyped('');
  }, []);

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
      <DistanceMap token={token ?? null} spot={spot} km={km} anywhere={anywhere}
                   onSpot={pick} onMiss={() => setNote('No place near there. Search a city instead.')} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.bodyStrong, { color: p.text, flex: 1 }]} numberOfLines={1}>
          📍 {spot ? spotWords(spot) : 'No place yet'}
        </Text>
        <Pressable onPress={() => setSearching((v) => !v)} accessibilityRole="button" hitSlop={8}>
          <Text style={[type.callout, { color: p.accent, fontFamily: type.bodyStrong.fontFamily }]}>
            {searching ? 'Close' : 'Change'}
          </Text>
        </Pressable>
      </View>
      <Text style={[type.callout, { color: p.textTertiary }]}>
        Drag the map to move it. You are matched from this place, both ways.
      </Text>

      {searching && (
        <View style={{ gap: space.xs }}>
          <Field value={typed} onChangeText={setTyped} placeholder="Search a city or part of Bengaluru" autoFocus />
          {results.map((s) => (
            <Pressable key={`${s.kind}:${s.name}`} onPress={() => pick(s)} accessibilityRole="button"
                       style={{ paddingVertical: space.sm }}>
              <Text style={[type.body, { color: p.text }]}>{spotWords(s)}</Text>
            </Pressable>
          ))}
          {typed.trim() !== '' && results.length === 0 && (
            <Text style={[type.callout, { color: p.textSecondary }]}>No place by that name yet.</Text>
          )}
        </View>
      )}

      <Button label={locating ? 'Finding you…' : 'Use my location'} variant="secondary"
              loading={locating} disabled={locating} onPress={() => void useMine()} />

      <View style={{ gap: space.xs }}>
        <Text style={[type.bodyStrong, { color: p.text }]}>
          {anywhere ? 'Anywhere: no distance limit' : `Up to ${km} km`}
        </Text>
        <Slider value={positionOf(km)} onChange={(t) => setKm(kmAt(t))} disabled={anywhere}
                label="How far" valueText={anywhere ? 'Anywhere' : `${km} kilometres`} />
      </View>
      <ChipGroup>
        <Chip label="Anywhere" selected={anywhere} onPress={() => setAnywhere((v) => !v)} />
      </ChipGroup>

      {note && <Text style={[type.callout, { color: p.textSecondary }]}>{note}</Text>}
    </View>
  );
}
