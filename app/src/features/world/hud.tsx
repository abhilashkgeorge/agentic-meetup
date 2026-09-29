/**
 * The few words over the town.
 *
 * One status line, the size of the pool, and one obvious next step -- the same three
 * things the old Home's cards said, at a tenth of the height, because the town is the
 * content now. Everything here is the design system; nothing is drawn by hand.
 */
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CENTRAL_AREA } from '@clone/shared';
import type { World } from '../../lib/api';
import { countLabel } from '../../lib/counts';
import { missingLabel } from '../profile/fields';
import { Button, Card, Chip, ChipGroup, space, type, usePalette } from '../../components/ui';
import { roundActive } from './bridge';
import { Stick } from './stick';
import { cityPose, placeLabels, toScreen, type Band, type Size } from './camera';
import { MAP, areaName, cityTitle, type Frame } from './map';
import { MAX_VENUE_AGENTS, type Venue } from './venue';
import { useLiveCount, useQuestsDone } from './park-hud';

export function Hud({
  world,
  onSendOut,
  onFinishSetup,
  onPeople,
  onAppearance,
  said,
  band,
  size,
  frame,
  onHome,
  onCity,
  onArea,
  onName,
  crowd = 0,
  onCrowd,
  cityCrowd = 0,
  onCityCrowd,
  walking,
  venue,
  transitioning,
  onEnterVenue,
  onLeaveVenue,
  onDirections,
  onQuests,
  stick,
  exchange,
  question,
  onQuestion,
}: {
  world: World | null;
  onSendOut: () => void;
  onFinishSetup: () => void;
  /** The same people as a list: for thumbs, and for screen readers. */
  onPeople: () => void;
  /** What your agent looks for, and what others see about you -- before it goes out. */
  onAppearance: () => void;
  /** How the last round went, said once. */
  said: string | null;
  /** The camera's zoom band; the neighbourhood names show at `city`. Null before the first frame. */
  band: Band | null;
  /** The canvas's size on screen, for placing the names. */
  size: Size | null;
  /** What this HUD covers, top and bottom: the city is centred between. */
  frame: Frame;
  /** Fly back to your own neighbourhood. */
  onHome: () => void;
  /** Pull out to the whole city. */
  onCity: () => void;
  /** "Which part of town?" -- the one question the map adds. */
  onArea: () => void;
  /** "Add your first name" -- for everybody who set up before the screen asked it. */
  onName: () => void;
  /** Test walkers in the park right now (world-screen.tsx), 0 when the test is off. */
  crowd?: number;
  /**
   * Development builds only: fill the park with test walkers, or clear them -- the
   * founder's "put 1000 people in the park, I want to see how well it renders"
   * (2026-09-28). The red meter over the world gives the frame rate while you walk.
   */
  onCrowd?: () => void;
  /** Test walkers in the city right now, 0 when that test is off. */
  cityCrowd?: number;
  /** Development builds only: the same test over the whole city (2026-09-29). */
  onCityCrowd?: () => void;
  /** Walking your own agent: the stick is out and the camera is behind its head. */
  walking: boolean;
  /** Null on the city overview; set after the named venue transition begins. */
  venue: Venue | null;
  transitioning: boolean;
  onEnterVenue: () => void;
  onLeaveVenue: () => void;
  onDirections: () => void;
  /** Things to do together in the park (park-hud.tsx QuestsSheet). */
  onQuests?: () => void;
  /** Where the stick writes what the thumb is doing. */
  stick: MutableRefObject<{ x: number; y: number }>;
  /** What the agents just asked each other, played above the button. */
  exchange?: ReactNode;
  /** A question of the day is waiting (server matching/unknowns.ts). */
  question?: boolean;
  onQuestion?: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const active = roundActive(world);
  // The round's own count lands only when it is over; while it runs, the people it
  // is still to talk to are the seats the roster shows talking.
  const talking = world?.agents.filter((a) => a.kind === 'met' && a.state === 'talking').length ?? 0;
  const title = venue?.name ?? cityTitle(world?.square.city);
  const myArea = world?.me.area ?? CENTRAL_AREA;
  const here = world?.agents.filter((a) => (a.area ?? CENTRAL_AREA) === myArea).length ?? 0;
  const askArea = world?.me.need.includes('area') ?? false;
  // People here in person, besides you (the park, live).
  const live = useLiveCount();
  const [questsDone, questsAll] = useQuestsDone();
  const askName = world?.me.need.includes('first_name') ?? false;

  // The thirty names, laid over the city at its zoomed-out pose, faded in and out
  // with the band. Real text in the app's own type, not a texture.
  const labels = useMemo(() => {
    if (!size) return [];
    const city = cityPose(MAP.outline, size, frame);
    return placeLabels(MAP.areas.map((a) => ({ id: a.id, name: a.name.toUpperCase(), radius: a.radius, at: toScreen(a.centre[0], a.centre[1], city, size) })));
  }, [size, frame]);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: band === 'city' ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [band, fade]);

  const status = venue
    ? venue.description
    : !world
    ? 'Finding the square…'
    : active
      ? world.round?.status === 'queued'
        ? 'Your agent is heading out…'
        : talking > 0
          ? `Your agent is out — meeting ${talking} ${talking === 1 ? 'person' : 'people'}`
          : 'Your agent is out…'
      : !world.me.inPool
        ? (world.me.missing[0] ? missingLabel(world.me.missing[0]) : 'A few things missing')
        : said ?? `It knows ${world.me.knows} things about you`;

  return (
    <>
      {labels.length > 0 && !walking && (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, opacity: fade }}>
          {labels.map((l) => (
            <Text key={l.id} numberOfLines={1}
                  style={[type.label, { position: 'absolute', left: l.at[0] - 60, top: l.at[1] - 7, width: 120, textAlign: 'center', color: p.textSecondary }]}>
              {l.name}
            </Text>
          ))}
        </Animated.View>
      )}

      <View pointerEvents="box-none"
            style={{ position: 'absolute', top: insets.top + space.sm, left: space.screen, right: space.screen, gap: space.sm }}>
        <Text style={[type.title, { color: p.text }]}>{title}</Text>
        <Card>
          {/* Walking in the park, the line about the park gives its room to the park:
              the chips are all that is needed there. */}
          {!(venue && walking) && <Text style={[type.body, { color: p.text }]}>{status}</Text>}
          {world && world.me.inPool && (
            <ChipGroup>
              {venue ? (
                <>
                  <Chip label="Back to Bengaluru" selected={false} onPress={onLeaveVenue} />
                  {/* People here in person, first: the reason to be in the park now. */}
                  <Chip label={live > 0 ? `${live} here now` : 'Nobody else here now'} selected={live > 0}
                        onPress={() => {}} disabled={live === 0} />
                  {/* Things to do together, and how many are done today: points for your look. */}
                  {onQuests && (
                    <Chip label={`Things to do · ${questsDone}/${questsAll}`} selected={questsDone > 0} onPress={onQuests} />
                  )}
                  <Chip label="Directions" selected={false} onPress={onDirections} />
                  <Chip label={crowd ? `${crowd} test people in the park` : `${Math.min(here + 1, MAX_VENUE_AGENTS)} agents in the park`}
                        selected={false} onPress={() => {}} disabled />
                  {onCrowd && (
                    <Chip label={crowd ? 'Remove the test crowd' : 'Test: add 1000 people'}
                          selected={crowd > 0} onPress={onCrowd} />
                  )}
                </>
              ) : (
                <>
                  {askName && <Chip label="Add your first name" selected={false} onPress={onName} />}
                  {askArea && <Chip label="Which part of town?" selected={false} onPress={onArea} />}
                  {question && onQuestion && <Chip label="A question for you" selected onPress={onQuestion} />}
                  <Chip label="Visit Cubbon Park" selected={false} onPress={onEnterVenue} />
                  <Chip label={`${areaName(myArea)} · ${here} here`} selected={band !== 'city'} onPress={onHome} />
                  {band !== 'city' && <Chip label="Whole city" selected={false} onPress={onCity} />}
                  <Chip label={`${countLabel(world.pool.total)} people nearby`} selected={false} onPress={() => {}} disabled />
                  <Chip label={`${world.targetsLeftToday} visits left today`} selected={false} onPress={() => {}} disabled />
                  <Chip label="Who's here" selected={false} onPress={onPeople} />
                  <Chip label="How you appear" selected={false} onPress={onAppearance} />
                  {onCityCrowd && (
                    <Chip label={cityCrowd ? 'Remove the test crowd' : 'Test: add 1000 people'}
                          selected={cityCrowd > 0} onPress={onCityCrowd} />
                  )}
                </>
              )}
            </ChipGroup>
          )}
        </Card>
      </View>

      {/* The stick sits where a thumb already is, and takes the bottom of the screen
          to itself: the round button would be under the heel of the hand. */}
      {walking && (
        <View pointerEvents="box-none"
              style={{ position: 'absolute', bottom: Math.max(insets.bottom, space.lg) + space.lg, left: space.screen }}>
          <Stick value={stick} />
        </View>
      )}

      <View pointerEvents="box-none"
            style={{ position: 'absolute', bottom: space.lg, left: space.screen, right: space.screen, gap: space.md }}>
        {walking || transitioning ? null : exchange}
        {walking || transitioning ? null : world && !world.me.inPool ? (
          <Button label="Finish setup" variant="primary" onPress={onFinishSetup} />
        ) : (
          <Button label={active ? 'Your agent is out…' : 'Send my agent out'} variant="primary"
                  onPress={onSendOut} disabled={!world || active} />
        )}
      </View>
    </>
  );
}
