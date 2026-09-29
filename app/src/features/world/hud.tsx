/**
 * The few words over the town.
 *
 * One status line, the size of the pool, and one obvious next step -- the same three
 * things the old Home's cards said, at a tenth of the height, because the town is the
 * content now. Everything here is the design system; nothing is drawn by hand.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CENTRAL_AREA } from '@clone/shared';
import type { World } from '../../lib/api';
import { countLabel } from '../../lib/counts';
import { missingLabel } from '../profile/fields';
import { Button, Card, Chip, ChipGroup, radius, raised, space, type, usePalette } from '../../components/ui';
import { roundActive } from './bridge';
import { Stick } from './stick';
import { cityPose, placeLabels, toScreen, type Band, type Size } from './camera';
import { MAP, areaName, cityTitle, type Frame } from './map';
import { MAX_VENUE_AGENTS, type Venue } from './venue';
import { useLiveCount, useQuestsDone } from './park-hud';
import { PARK_WHO_MEANS, parkWho } from './park-top';

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
  const title = cityTitle(world?.square.city);
  const myArea = world?.me.area ?? CENTRAL_AREA;
  const here = world?.agents.filter((a) => (a.area ?? CENTRAL_AREA) === myArea).length ?? 0;
  const askArea = world?.me.need.includes('area') ?? false;
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

  const status = !world
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

      {venue ? (
        <ParkBar onBack={onLeaveVenue} agents={Math.min(here + 1, MAX_VENUE_AGENTS)} crowd={crowd}
                 onQuests={onQuests} onCrowd={onCrowd} />
      ) : (
        <View pointerEvents="box-none"
              style={{ position: 'absolute', top: insets.top + space.sm, left: space.screen, right: space.screen, gap: space.sm }}>
          <Text style={[type.title, { color: p.text }]}>{title}</Text>
          <Card>
            <Text style={[type.body, { color: p.text }]}>{status}</Text>
            {world && world.me.inPool && (
              <ChipGroup>
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
              </ChipGroup>
            )}
          </Card>
        </View>
      )}

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

/**
 * THE PARK'S OWN TOP, ON ITS EDGES ONLY (the founder, 2026-09-29: "Half of the screen is
 * covered by the white box ... redesign it completely so that it doesn't cover any part of
 * the screen"). The park used to wear the town's card: a title, a line, and six chips in a
 * white box over the top half of the park. Now nothing sits in the middle:
 *   - top left, a back button that says where it goes;
 *   - top right, who is here in one small line -- people here now besides you, then agents
 *     -- which says what those words mean when tapped (the old "Nobody else here now" said
 *     nothing, and tapping it did nothing);
 *   - under it, "Things to do" with today's count, as a small button;
 *   - Directions is gone; development builds keep the test crowd as a small line under it.
 */
function ParkBar({ onBack, agents, crowd, onQuests, onCrowd }: {
  onBack: () => void;
  /** Agents walking the park. */
  agents: number;
  /** Test walkers, 0 when the test is off (development builds). */
  crowd: number;
  onQuests?: () => void;
  onCrowd?: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // People here in person, besides you (the park, live).
  const live = useLiveCount();
  const [questsDone, questsAll] = useQuestsDone();
  // What the count means, said when it is tapped, and gone again by itself.
  const [explain, setExplain] = useState(false);
  useEffect(() => {
    if (!explain) return;
    const t = setTimeout(() => setExplain(false), 5000);
    return () => clearTimeout(t);
  }, [explain]);
  const who = parkWho(live, agents, crowd);

  return (
    <View pointerEvents="box-none"
          style={{ position: 'absolute', top: insets.top + space.sm, left: space.screen, right: space.screen,
                   flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Bengaluru" hitSlop={8}
                 style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 40, flexShrink: 0,
                          paddingLeft: space.md, paddingRight: space.lg, borderRadius: radius.pill,
                          backgroundColor: p.bg, boxShadow: raised(p, 3) }}>
        <Text style={{ fontSize: 26, lineHeight: 28, marginTop: -3, color: p.text }}>‹</Text>
        <Text style={[type.callout, { color: p.text, fontFamily: type.bodyStrong.fontFamily }]}>Bengaluru</Text>
      </Pressable>

      <View pointerEvents="box-none" style={{ alignItems: 'flex-end', gap: space.sm, maxWidth: '64%', flexShrink: 1 }}>
        <Pressable onPress={() => setExplain((e) => !e)} accessibilityRole="button"
                   accessibilityLabel={`${who}. Tap to hear what this means.`} hitSlop={6}
                   style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.md,
                            borderRadius: radius.pill, backgroundColor: p.bg, opacity: 0.94 }}>
          {live > 0 && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.success }} />}
          <Text numberOfLines={1} style={[type.callout, { color: p.text, flexShrink: 1 }]}>{who}</Text>
        </Pressable>
        {explain && (
          <View pointerEvents="none" style={{ maxWidth: 240, padding: space.md, borderRadius: radius.md,
                                               backgroundColor: p.bg, boxShadow: raised(p, 4) }}>
            <Text style={[type.callout, { color: p.textSecondary }]}>{PARK_WHO_MEANS}</Text>
          </View>
        )}
        {onQuests && (
          <Pressable onPress={onQuests} accessibilityRole="button"
                     accessibilityLabel={`Things to do, ${questsDone} of ${questsAll} done today`} hitSlop={6}
                     style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 36, paddingHorizontal: space.md,
                              borderRadius: radius.pill, backgroundColor: p.bg, boxShadow: raised(p, 3) }}>
            <Text style={[type.callout, { color: p.text, fontFamily: type.bodyStrong.fontFamily }]}>Things to do</Text>
            <Text style={[type.callout, { color: questsDone > 0 ? p.accent : p.textSecondary, fontFamily: type.bodyStrong.fontFamily }]}>
              {`${questsDone}/${questsAll}`}
            </Text>
          </Pressable>
        )}
        {onCrowd && (
          <Pressable onPress={onCrowd} accessibilityRole="button" hitSlop={6}
                     style={{ paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill,
                              backgroundColor: p.bg, opacity: 0.8 }}>
            <Text style={[type.label, { color: p.textSecondary }]}>
              {crowd ? 'Remove the test crowd' : 'Test: add 1000 people'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
