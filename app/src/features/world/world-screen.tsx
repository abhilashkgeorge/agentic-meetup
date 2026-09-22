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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ChatScreen from '../chat/chat-screen';
import { runRound, type WorldAgent } from '../../lib/api';
import { getFps30, getGlFuse, setGlFuse, strikeGlFuse } from '../../lib/storage';
import { useSession } from '../../store/session';
import { setupRoute } from '../profile/fields';
import { Screen, useIsDark, usePalette } from '../../components/ui';
import { AgentSheet } from './agent-sheet';
import type { Band, Size, WorldControl } from './camera';

/** What the server says when it will not send the agent, in the person's words. */
const REFUSED: Record<string, string> = {
  budget_exceeded: 'Your agent has been out enough for today.',
  daily_targets: 'That is all the visits for today. Try again tomorrow.',
  not_here: 'That person has moved on.',
};
import { CloneSheet } from './clone-sheet';
import { Hud } from './hud';
import { PeopleSheet } from './people-sheet';
import { MAP, spotsFrom } from './map';
import { loadWorldRenderer, type WorldRenderer } from './r3f';
import { WorldSim } from './sim';
import { YOU, departed, fromRoster, metSpec, planTransitions, roundActive, stateAfter, useWorld } from './store';

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
  const firstFrame = useCallback(() => { void setGlFuse(null); }, []);

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
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    void getFps30().then(setCap30);
    if (token) void load(token);
    return () => setFocused(false);
  }, [token, load]));
  const active = roundActive(world);
  useEffect(() => {
    if (!token || !focused) return;
    const t = setInterval(() => void load(token), active ? 8_000 : 60_000);
    return () => clearInterval(t);
  }, [token, focused, active, load]);

  // Roster -> sim. Only what changed since the last roster, so a poll never restarts
  // a walk-over already under way.
  const applied = useRef(new Map<string, WorldAgent['state']>());
  useEffect(() => {
    if (!world) return;
    sim.upsert(fromRoster(world));
    for (const ref of departed(applied.current, world.agents)) sim.remove(ref);
    for (const t of planTransitions(applied.current, world.agents)) {
      if (t.op === 'meet') sim.meet(YOU, t.ref);
      else if (t.op === 'introduced') sim.introduced(YOU, t.ref);
      else if (t.op === 'pass') sim.pass(t.ref);
      else sim.settle(t.ref);
    }
    applied.current = new Map(world.agents.map((a) => [a.ref, a.state]));
  }, [world]);

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
      else if (t.op === 'verdict') { sim.verdict(YOU, t.words); sim.verdict(t.ref, t.words); }
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
  useEffect(() => {
    const r = world?.round;
    if (!r || active || announce !== r.id) return;
    setAnnounce(null);
    setSaid(
      r.error === 'budget_exceeded' ? 'Your agent has been out enough for today.'
      : r.error ? 'Something went wrong while your agent was out.'
      : r.skipped ? r.skipped
      : r.met === 0 ? 'It found nobody new to meet.'
      : r.met === 1 ? 'Your agent met one person. See Matches.'
      : `Your agent met ${r.met} people. See Matches.`,
    );
  }, [world, active, announce, setAnnounce]);

  /**
   * Send the agent out -- to whoever the ranking picks, or, with a ref, to the one
   * person tapped in the square ("send my agent over"). A refusal has a reason the
   * person needs to read, so it is said where the round's result would be.
   */
  const sendOut = useCallback(async (target?: string) => {
    if (!token || active) return;
    setSaid(null);
    const r = await runRound(token, target);
    if (!r) { setSaid('Cannot reach the server.'); return; }
    if ('error' in r) { setSaid(REFUSED[r.error] ?? 'Could not send your agent out. Try again.'); return; }
    setAnnounce(r.roundId);
    await load(token);
  }, [token, active, load, setAnnounce]);

  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const onTap = useCallback((ref: string) => {
    if (ref === YOU) setChatOpen(true);
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
  const [band, setBand] = useState<Band | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const insets = useSafeAreaInsets();
  const frame = useMemo(() => ({ top: insets.top + 168, bottom: Math.max(insets.bottom, 20) + 88, side: 12 }), [insets.top, insets.bottom]);
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
  if (renderer === undefined) {
    return (
      <Screen center>
        <ActivityIndicator color={p.textTertiary} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }} onLayout={onLayout}>
      <renderer.WorldCanvas key={epoch} sim={sim} colors={colors} active={focused && inFront} cap30={cap30}
                            onTapAgent={onTap} onFirstFrame={firstFrame}
                            control={control} onBand={setBand} frame={frame}
                            stick={stick} onWalking={setWalking} />
      <Hud world={world} said={said} onSendOut={() => void sendOut()} onPeople={() => setPeopleOpen(true)}
           onFinishSetup={() => router.push({ pathname: setupRoute(world?.me.need ?? []), params: { finish: '1' } })}
           band={band} size={size} frame={frame}
           onHome={() => control.current?.flyHome()} onCity={() => control.current?.flyCity()}
           onArea={() => router.push({ pathname: setupRoute(['area']), params: { finish: '1' } })}
           walking={walking} onWalk={(on) => control.current?.setWalking(on)} stick={stick} />
      {peopleOpen && world && (
        <PeopleSheet agents={world.agents} myArea={world.me.area} onClose={() => setPeopleOpen(false)}
                     onPick={(ref) => { setPeopleOpen(false); onTap(ref); }} />
      )}
      {selectedAgent && (
        <AgentSheet agent={selectedAgent} onClose={() => setSelected(null)}
                    visits={{ left: world?.targetsLeftToday ?? 0, busy: active }}
                    onSendOver={(ref) => { setSelected(null); void sendOut(ref); }} />
      )}
      {chatOpen && <CloneSheet onClose={() => setChatOpen(false)} />}
    </View>
  );
}
