/**
 * Home: the town.
 *
 * A small square where your agent (the purple one) and two dozen others walk about.
 * What you see is what actually happened -- the roster from /v1/world, polled every
 * eight seconds while a round is out and once a minute otherwise -- turned into
 * motion by the simulation in ./sim.ts. Nothing here spends money; watching is free.
 *
 * TWO WAYS THIS SCREEN IS NOT THE TOWN, both deliberate:
 *   - the renderer will not load (a build without the native GL half) -> the plain
 *     Home, which is the chat with the status cards.
 *   - the last attempt to draw never reached a first frame (the fuse in storage) ->
 *     the same, until the person asks for 3D again from Settings.
 * The 3D code is reached only through loadWorldRenderer(); this file imports none
 * of it, and tests/native-imports.test.ts will say so if that changes.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChatScreen from '../chat/chat-screen';
import { getMatches, getQuestionOfDay, runRound, type MatchCard, type WorldAgent } from '../../lib/api';
import { getFps30, getGlFuse, setGlFuse, strikeGlFuse } from '../../lib/storage';
import { useSession } from '../../store/session';
import { registerForPush } from '../../lib/push';
import { setupRoute } from '../profile/fields';
import { Screen, space, useIsDark, usePalette } from '../../components/ui';
import { FPS_METER, FpsMeter, feedFps } from '../dev/fps';
import { bubblesForCard, pickExchange } from '../matches/exchange';
import { SHARED_LIMIT } from '../chat/turn-note';
import { AgentSheet } from './agent-sheet';
import { backStep } from './back';
import { ExchangeStrip } from './exchange-strip';
import type { Band, Size, WorldControl } from './camera';

/** What the server says when it will not send the agent, in the person's words. */
const REFUSED: Record<string, string> = {
  // Chat, learning and rounds share the day's turns (chat/turn-note.ts).
  budget_exceeded: SHARED_LIMIT,
  // One open round a day that met somebody (server world.ts ROUNDS_PER_DAY).
  daily_rounds: 'Your agent has been out enough for today.',
  daily_targets: 'That is all the visits for today. Try again tomorrow.',
  not_here: 'That person has moved on.',
  // The server re-checks the pool before it queues anything (poolNow): a person who set
  // up before the five core cards can still have a Home that thought it was ready.
  not_ready: 'Your agent needs a few more answers before it can go out.',
};
import { CloneSheet } from './clone-sheet';
import { Hud } from './hud';
import { PeopleSheet } from './people-sheet';
import { useParkPresence } from './park-presence';
import { BikeButton, CheerToast, InviteCard, LiveSheet, ParkActions, ParkChat, QuestsSheet, SpeechBubbles } from './park-hud';
import { VoiceMarks, VoicesSheet } from './park-voice-hud';
import { STICK_RING } from './stick';
import { useParkLive } from './park-live';
import { gardenSpots } from './garden';
import { MAP, spotsFrom } from './map';
import { loadWorldRenderer, type WorldRenderer } from './r3f';
import { CROWD_TEST, WorldSim, isCrowd } from './sim';
import { roundNote } from '../matches/round-note';
import { TownLoading } from './town-loading';
import { YOU, departed, fromRoster, metSpec, planTransitions, roundActive, stateAfter, useWorld } from './store';
import {
  CITY_REALM, CUBBON_PARK, agentsForVenue, transitionRealm, venueGarden,
} from './venue';

/**
 * One town per app run. It outlives this screen so a tab switch does not reshuffle
 * everybody -- which also means everybody keeps whatever position they walked to
 * until the module itself is reloaded. Worth knowing while developing: a change to
 * the map asset does not move anyone who is already standing on it.
 */
const sim = new WorldSim(20260918);
sim.setMap(spotsFrom(MAP));

export default function WorldScreen() {
  const p = usePalette();
  const night = useIsDark();
  const token = useSession((s) => s.token);
  const world = useWorld((s) => s.world);
  const load = useWorld((s) => s.load);
  const announce = useWorld((s) => s.announce);
  const setAnnounce = useWorld((s) => s.setAnnounce);
  const live = useWorld((s) => s.live);
  const drained = useWorld((s) => s.drained);
  const nudge = useWorld((s) => s.nudge);

  // undefined: still deciding. null: the plain Home. Otherwise: the town.
  //
  // THE FUSE, precisely. A GL context that takes the process down leaves nothing to
  // catch, so `trying` is written right before the canvas mounts and cleared on its
  // first frame. It is ALSO cleared when this screen unmounts: a person who switched
  // tabs before the first frame did not crash, and a crash is exactly the case where
  // cleanup never runs. Without that, a quick tab switch on launch -- or a Metro
  // fast-refresh in development, which is how this was found -- left `trying` behind
  // and the next launch fell back for ever. A leftover `trying` means the last
  // attempt took the app down: the town goes `off`, and Settings says so and offers
  // to try again. `off` is otherwise the person's own choice, from the same row.
  const [renderer, setRenderer] = useState<WorldRenderer | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      const fuse = await getGlFuse();
      if (fuse === 'off') { if (live) setRenderer(null); return; }
      // One unexplained exit is forgiven: a force-stop, a reload or a swipe-away all
      // leave the same trace as a crash, and turning the town off for those is how it
      // came to be switched off by hand four times in one afternoon. The second in a
      // row is a crash loop, and getGlFuse reports that as 'off'.
      if (fuse === 'trying') {
        await strikeGlFuse();
        const r = await loadWorldRenderer();
        if (!live) return;
        if (!r) { setRenderer(null); return; }
        if (live) setRenderer(r);
        return;
      }
      const r = await loadWorldRenderer();
      if (!live) return;
      if (!r) { setRenderer(null); return; }
      await setGlFuse('trying');
      if (live) setRenderer(r);
    })();
    return () => { live = false; void setGlFuse(null); };
  }, []);
  // Drawn once: the town's placeholder lifts (town-loading.tsx). Only the first time --
  // a canvas brought back from the background keeps its scene and draws at once.
  const [drawn, setDrawn] = useState(false);
  const firstFrame = useCallback(() => { setDrawn(true); void setGlFuse(null); }, []);

  // "Easier on the battery", from Settings: read on every focus so a change there
  // is seen on the way back, without a store for one boolean.
  const [cap30, setCap30] = useState(false);

  // BACKGROUND AND BACK. expo-gl on Android can lose its context while the app is
  // in the background, and a lost context draws nothing, for ever, with no error.
  // Coming back to the foreground remounts the canvas (the key), which makes a new
  // context; the sim is a module singleton, so everybody is where they were. While
  // the app is not in front the frame loop is off -- see `active` below.
  const [epoch, setEpoch] = useState(0);
  const [inFront, setInFront] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      const front = st === 'active';
      setInFront(front);
      if (front) setEpoch((e) => e + 1);
    });
    return () => sub.remove();
  }, []);

  // The roster: on focus, then on a clock whose speed depends on whether a round is out.
  // And whether a question of the day is waiting: read on every visit, so answering or
  // skipping one takes the chip away the moment the person comes back.
  const [focused, setFocused] = useState(false);
  const [question, setQuestion] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    void getFps30().then(setCap30);
    if (token) {
      void load(token);
      void getQuestionOfDay(token).then((r) => setQuestion(Boolean(r?.question)));
    }
    return () => setFocused(false);
  }, [token, load]));
  const active = roundActive(world);
  useEffect(() => {
    if (!token || !focused) return;
    const t = setInterval(() => void load(token), active ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [token, focused, active, load]);

  /**
   * THE OTHER WORLD. Cubbon Park has local coordinates and a bounded nearby roster.
   * It is not a magnified patch of the city map.
   */
  const venueLayout = useMemo(() => venueGarden(CUBBON_PARK), []);
  const venueSim = useMemo(() => {
    const s = new WorldSim(20260922);
    s.setMap(gardenSpots(venueLayout));
    return s;
  }, [venueLayout]);

  /**
   * THE PARK'S CROWD TEST, development builds only (the founder, 2026-09-28: "put 1000
   * people in the park, I want to see how well it renders"). A chip in the park adds
   * or clears the walkers; the canvas gets slots for all of them, which it only has
   * while the test is on (see `slots` in canvas.tsx). The red meter reads the result.
   */
  const [crowd, setCrowd] = useState(0);
  const toggleCrowd = useCallback(() => {
    if (crowd) { venueSim.removeCrowd(); setCrowd(0); return; }
    venueSim.addCrowd(CROWD_TEST, CUBBON_PARK.id);
    setCrowd(CROWD_TEST);
  }, [crowd, venueSim]);
  /**
   * The same test for the city (the founder, 2026-09-29: "can you try adding 1000
   * agents over there too"), spread over all thirty neighbourhoods. The roster never
   * removes them: `departed` only ever names people the roster itself brought.
   */
  const [cityCrowd, setCityCrowd] = useState(0);
  const toggleCityCrowd = useCallback(() => {
    if (cityCrowd) { sim.removeCrowd(); setCityCrowd(0); return; }
    sim.addCrowd(CROWD_TEST, MAP.areas.map((a) => a.id));
    setCityCrowd(CROWD_TEST);
  }, [cityCrowd]);

  // Roster -> sim. Only what changed since the last roster, so a poll never restarts
  // a walk-over already under way.
  const applied = useRef(new Map<string, WorldAgent['state']>());
  useEffect(() => {
    if (!world) return;
    const roster = fromRoster(world);
    sim.upsert(roster);
    const local = agentsForVenue(roster, CUBBON_PARK);
    venueSim.upsert(local);
    const localRefs = new Set(local.map((a) => a.ref));
    // The crowd test's walkers are nobody's roster entry: they stay until cleared. And
    // somebody here in person (park-presence.ts) is the server's to move, not the roster's.
    for (const a of venueSim.agents()) {
      if (!localRefs.has(a.ref) && !isCrowd(a.ref) && a.kind !== 'live') venueSim.remove(a.ref);
    }
    for (const ref of departed(applied.current, world.agents)) {
      sim.remove(ref);
      if (venueSim.get(ref)?.kind !== 'live') venueSim.remove(ref);
    }
    for (const t of planTransitions(applied.current, world.agents)) {
      if (t.op === 'meet') sim.meet(YOU, t.ref);
      else if (t.op === 'introduced') sim.introduced(YOU, t.ref);
      else if (t.op === 'pass') sim.pass(t.ref);
      else sim.settle(t.ref);
    }
    applied.current = new Map(world.agents.map((a) => [a.ref, a.state]));
  }, [world, venueSim]);

  // Socket -> sim, at once. Each is recorded as applied so the roster that follows
  // two seconds later does not replay it.
  useEffect(() => {
    if (!live.length) return;
    for (const t of live) {
      if (t.op === 'recall') { sim.recall(YOU); continue; }
      if (t.op === 'meet') {
        // Somebody the round chose who was not in the square's sample: put them in
        // it first, or there is nobody to walk over to.
        if (!sim.get(t.ref)) sim.upsert([metSpec(t.ref, t.practice)]);
        if (t.theyCame) sim.meet(t.ref, YOU);
        else sim.meet(YOU, t.ref);
      }
      else if (t.op === 'parted') sim.parted(YOU, t.ref);
      else if (t.op === 'introduced') sim.introduced(YOU, t.ref);
      else if (t.op === 'pass') sim.pass(t.ref);
      else sim.settle(t.ref);
      applied.current.set(t.ref, stateAfter(t));
    }
    drained();
  }, [live, drained]);
  useEffect(() => {
    if (!nudge || !token) return;
    const t = setTimeout(() => void load(token), 2_000);
    return () => clearTimeout(t);
  }, [nudge, token, load]);

  // Say how the round went, once, when the one this person asked for comes back.
  const [said, setSaid] = useState<string | null>(null);
  // AND PLAY WHAT THE AGENTS SAID, from the first of the round's cards that carries a
  // talk or, when they did not talk, the answer-sheet exchange. Read from /v1/matches, so the reveal rule has already
  // been applied: a card this person may not read yet has none, and plays nothing.
  const [exchange, setExchange] = useState<MatchCard | null>(null);
  const bubbles = useMemo(() => (exchange ? bubblesForCard(exchange) : []), [exchange]);
  useEffect(() => {
    const r = world?.round;
    if (!r || active || announce !== r.id) return;
    setAnnounce(null);
    if (r.met > 0 && !r.error && token) {
      void getMatches(token).then((m) => setExchange(pickExchange(m?.matches ?? [], r.met)));
      // The meeting may have left an "I don't know" to ask about.
      void getQuestionOfDay(token).then((q) => setQuestion(Boolean(q?.question)));
    }
    setSaid(
      r.error === 'budget_exceeded' ? SHARED_LIMIT
      : r.error ? 'Something went wrong while your agent was out.'
      : r.skipped ? roundNote(r.skipped)
      : r.met === 0 ? 'It found nobody new to meet.'
      : r.met === 1 ? 'Your agent met one person. See Matches.'
      : `Your agent met ${r.met} people. See Matches.`,
    );
  }, [world, active, announce, setAnnounce, token]);

  /**
   * Send the agent out -- to whoever the ranking picks, or, with a ref, to the one
   * person tapped in the square ("send my agent over"). A refusal has a reason the
   * person needs to read, so it is said where the round's result would be.
   */
  const sendOut = useCallback(async (target?: string) => {
    if (!token || active) return;
    setSaid(null);
    setExchange(null);
    // The moment to ask about notifications: a card is about to wait on this person.
    // Asked once; after that it only re-sends the token (lib/push.ts).
    void registerForPush(token, { ask: true });
    const r = await runRound(token, target);
    if (!r) { setSaid('Cannot reach the server.'); return; }
    if ('error' in r) {
      setSaid(REFUSED[r.error] ?? 'Could not send your agent out. Try again.');
      // Not ready: reload, so the Home swaps the button for "Finish setup".
      if (r.error === 'not_ready') await load(token);
      return;
    }
    setAnnounce(r.roundId);
    await load(token);
  }, [token, active, load, setAnnounce]);

  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [liveSelected, setLiveSelected] = useState<string | null>(null);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);
  const onTap = useCallback((ref: string) => {
    if (ref === YOU) setChatOpen(true);
    // Somebody here in person: not an agent to send yours over to, a person.
    else if (useParkLive.getState().people.has(ref)) setLiveSelected(ref);
    else setSelected(ref);
  }, []);
  const selectedAgent = useMemo(
    () => (selected ? world?.agents.find((a) => a.ref === selected) ?? null : null),
    [selected, world],
  );

  // The camera: the HUD flies it, the canvas reports its band, both know the frame
  // (what the HUD covers) so the zoomed-out city sits between the title and the button.
  const control = useRef<WorldControl | null>(null);
  // The stick's live value, read by the renderer once a frame and never rendered.
  const stick = useRef({ x: 0, y: 0 });
  const [walking, setWalking] = useState(false);
  const [realm, dispatchRealm] = useReducer(transitionRealm, CITY_REALM);
  const veil = useRef(new Animated.Value(0)).current;
  const transitioning = realm.phase === 'entering' || realm.phase === 'leaving';

  // In the park, live: while it is on screen, you are in it for everybody else too.
  useParkPresence(realm.phase === 'venue' && focused, venueSim, control, venueLayout.benches);

  const enterVenue = useCallback(() => {
    if (realm.phase !== 'city' || !world) return;
    control.current?.flyToPoint(CUBBON_PARK.mapAt[0], CUBBON_PARK.mapAt[1], 48);
    dispatchRealm({ type: 'enter', venue: CUBBON_PARK });
  }, [realm.phase, world]);
  const leaveVenue = useCallback(() => {
    if (realm.phase !== 'venue') return;
    dispatchRealm({ type: 'leave' });
  }, [realm.phase]);

  // Android's Back closes what is open, topmost first, and in the park goes back to the
  // city (back.ts). Before this, nothing listened, and Back with a sheet open quit the app.
  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const step = backStep({
        chat: chatOpen, live: liveSelected !== null, agent: selected !== null, quests: questsOpen,
        voices: voicesOpen, people: peopleOpen, exchange: exchange !== null,
        inPark: realm.phase === 'venue', moving: transitioning,
      });
      if (step === 'chat') setChatOpen(false);
      else if (step === 'live') setLiveSelected(null);
      else if (step === 'agent') setSelected(null);
      else if (step === 'quests') setQuestsOpen(false);
      else if (step === 'voices') setVoicesOpen(false);
      else if (step === 'people') setPeopleOpen(false);
      else if (step === 'exchange') setExchange(null);
      else if (step === 'inPark') leaveVenue();
      return step !== null;
    });
    return () => sub.remove();
  }, [focused, chatOpen, liveSelected, selected, questsOpen, voicesOpen, peopleOpen, exchange, realm.phase, transitioning, leaveVenue]);

  useEffect(() => {
    Animated.timing(veil, {
      toValue: transitioning ? 1 : 0,
      duration: transitioning ? 360 : 280,
      useNativeDriver: true,
    }).start();
    if (realm.phase === 'entering') {
      const t = setTimeout(() => {
        control.current?.setWalking(true);
        dispatchRealm({ type: 'entered' });
      }, 430);
      return () => clearTimeout(t);
    }
    if (realm.phase === 'leaving') {
      const t = setTimeout(() => {
        control.current?.setWalking(false);
        control.current?.flyToPoint(CUBBON_PARK.mapAt[0], CUBBON_PARK.mapAt[1], 48);
        dispatchRealm({ type: 'left' });
      }, 360);
      return () => clearTimeout(t);
    }
  }, [realm.phase, transitioning, veil]);
  const [band, setBand] = useState<Band | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const insets = useSafeAreaInsets();
  // What the HUD covers: since 2026-09-30 a title and one pill at the top (hud.tsx
  // TownBar), and at the bottom the status line, a nudge, the button and its counts.
  const frame = useMemo(() => ({ top: insets.top + 96, bottom: Math.max(insets.bottom, 20) + 150, side: 12 }), [insets.top, insets.bottom]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
  }, []);

  const colors = useMemo(() => ({
    bg: p.bg, ground: p.sunken, light: p.light, prop: p.dark, you: p.accent, stranger: p.textTertiary,
    met: p.textSecondary, practice: p.textTertiary, success: p.success, danger: p.danger,
    warning: p.warning, accent: p.accent, night,
  }), [p, night]);

  if (renderer === null) return <ChatScreen />;
  if (renderer === undefined) return <TownLoading />;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }} onLayout={onLayout}>
      <renderer.WorldCanvas key={epoch} sim={sim} colors={colors} active={focused && inFront} cap30={cap30}
                            onTapAgent={onTap} onFirstFrame={firstFrame}
                            onStats={FPS_METER ? feedFps : undefined}
                            control={control} onBand={setBand} frame={frame}
                            stick={stick} onWalking={setWalking}
                            venueSim={venueSim} venue={CUBBON_PARK}
                            slots={crowd + cityCrowd ? crowd + cityCrowd + 64 : undefined}
                            inVenue={realm.phase === 'venue' || realm.phase === 'leaving'}
                            onTapVenue={() => enterVenue()} />
      {!drawn && <TownLoading overlay />}
      <Hud world={world} said={said} onSendOut={() => void sendOut()} onPeople={() => setPeopleOpen(true)}
           onAppearance={() => router.push('/appearance')}
           question={question} onQuestion={() => router.push('/question')}
           onFinishSetup={() => router.push({ pathname: setupRoute(world?.me.need ?? []), params: { finish: '1' } })}
           band={band} size={size} frame={frame}
           onHome={() => control.current?.flyHome()} onCity={() => control.current?.flyCity()}
           onArea={() => router.push({ pathname: setupRoute(['area']), params: { finish: '1' } })}
           onName={() => router.push({ pathname: setupRoute(['first_name']), params: { finish: '1' } })}
           crowd={crowd} onCrowd={FPS_METER ? toggleCrowd : undefined}
           cityCrowd={cityCrowd} onCityCrowd={FPS_METER ? toggleCityCrowd : undefined}
           walking={walking} venue={realm.venue} transitioning={transitioning}
           onEnterVenue={enterVenue} onLeaveVenue={leaveVenue}
           onQuests={() => setQuestsOpen(true)}
           stick={stick}
           exchange={bubbles.length > 0 && exchange && world ? (
             <ExchangeStrip bubbles={bubbles} you={world.me.look} them={exchange.look}
                            practice={exchange.practice === true}
                            talking={Boolean(exchange.talk)}
                            onClose={() => setExchange(null)}
                            onSeeCard={() => { setExchange(null); router.push('/matches'); }} />
           ) : null} />
      {/* The park, live: what people near you say, over their heads, and the line to
          say something back. Only while you are walking in it. */}
      {realm.phase === 'venue' && walking && (
        <>
          <SpeechBubbles control={control} />
          <VoiceMarks control={control} />
          <ParkChat bottom={Math.max(insets.bottom, 20) + 24} onVoices={() => setVoicesOpen(true)}>
            <ParkActions venueSim={venueSim} benches={venueLayout.benches} />
          </ParkChat>
          <InviteCard />
          <BikeButton left={space.screen} bottom={Math.max(insets.bottom, space.lg) + space.lg + STICK_RING + space.md} />
          {/* Under the park's top edge (hud.tsx ParkBar), clear of its right-hand column. */}
          <CheerToast top={insets.top + 150} />
        </>
      )}
      {/* Over everything, including the HUD, and under nothing. Debug builds only. */}
      {/* Off the top right, which both views use now: in the park under the back button,
          in the town under your part of town (hud.tsx ParkBar, TownBar). */}
      <FpsMeter capped={cap30} at={{ top: insets.top + (realm.phase === 'venue' ? 56 : 92), left: space.screen }} />
      <Animated.View
        pointerEvents={transitioning ? 'auto' : 'none'}
        style={{
          position: 'absolute', inset: 0, opacity: veil, backgroundColor: p.bg,
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <Text style={{ color: p.text, fontSize: 24, fontWeight: '700' }}>
          {realm.phase === 'leaving' ? 'Back to Bengaluru' : CUBBON_PARK.name}
        </Text>
        <Text style={{ color: p.textSecondary }}>
          {realm.phase === 'leaving' ? 'Returning to the city map…' : 'Entering the park…'}
        </Text>
      </Animated.View>
      {peopleOpen && world && (
        <PeopleSheet agents={world.agents} myArea={world.me.area} myLook={world.me.look} onClose={() => setPeopleOpen(false)}
                     onPick={(ref) => { setPeopleOpen(false); onTap(ref); }} />
      )}
      {selectedAgent && (
        <AgentSheet agent={selectedAgent} onClose={() => setSelected(null)}
                    visits={{ left: world?.targetsLeftToday ?? 0, busy: active }}
                    onSendOver={(ref) => { setSelected(null); void sendOut(ref); }} />
      )}
      {liveSelected && <LiveSheet parkRef={liveSelected} onClose={() => setLiveSelected(null)} />}
      {questsOpen && realm.phase === 'venue' && <QuestsSheet onClose={() => setQuestsOpen(false)} />}
      {voicesOpen && realm.phase === 'venue' && <VoicesSheet venueSim={venueSim} onClose={() => setVoicesOpen(false)} />}
      {chatOpen && <CloneSheet onClose={() => setChatOpen(false)} />}
    </View>
  );
}
