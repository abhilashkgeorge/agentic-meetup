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
import { ActivityIndicator, View } from 'react-native';
import ChatScreen from '../chat/chat-screen';
import { runRound, type WorldAgent } from '../../lib/api';
import { getGlFuse, setGlFuse } from '../../lib/storage';
import { useSession } from '../../store/session';
import { setupRoute } from '../profile/fields';
import { Screen, usePalette } from '../../components/ui';
import { AgentSheet } from './agent-sheet';
import { CloneSheet } from './clone-sheet';
import { Hud } from './hud';
import { loadWorldRenderer, type WorldRenderer } from './r3f';
import { WorldSim } from './sim';
import { YOU, fromRoster, planTransitions, roundActive, stateAfter, useWorld } from './store';

/** One town per app run. It outlives this screen so a tab switch does not reshuffle everybody. */
const sim = new WorldSim(20260918);

export default function WorldScreen() {
  const p = usePalette();
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
  // and the next launch fell back for ever. A leftover `trying` now costs one launch
  // and resets; `off` is the person's own choice, from Settings.
  const [renderer, setRenderer] = useState<WorldRenderer | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void (async () => {
      const fuse = await getGlFuse();
      if (fuse === 'off') { if (live) setRenderer(null); return; }
      if (fuse === 'trying') {
        await setGlFuse(null);
        if (live) setRenderer(null);
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

  // The roster: on focus, then on a clock whose speed depends on whether a round is out.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
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
      if (t.op === 'meet') sim.meet(YOU, t.ref);
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

  const sendOut = useCallback(async () => {
    if (!token || active) return;
    setSaid(null);
    const r = await runRound(token);
    if (!r) { setSaid('Cannot reach the server.'); return; }
    setAnnounce(r.roundId);
    await load(token);
  }, [token, active, load, setAnnounce]);

  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const onTap = useCallback((ref: string) => {
    if (ref === YOU) setChatOpen(true);
    else setSelected(ref);
  }, []);
  const selectedAgent = useMemo(
    () => (selected ? world?.agents.find((a) => a.ref === selected) ?? null : null),
    [selected, world],
  );

  const colors = useMemo(() => ({
    bg: p.bg, ground: p.sunken, prop: p.dark, you: p.accent, stranger: p.textTertiary,
    met: p.textSecondary, practice: p.textTertiary, success: p.success, danger: p.danger,
    warning: p.warning, accent: p.accent,
  }), [p]);

  if (renderer === null) return <ChatScreen />;
  if (renderer === undefined) {
    return (
      <Screen center>
        <ActivityIndicator color={p.textTertiary} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <renderer.WorldCanvas sim={sim} colors={colors} dpr={1.5} active={focused}
                            onTapAgent={onTap} onFirstFrame={firstFrame} />
      <Hud world={world} said={said} onSendOut={() => void sendOut()}
           onFinishSetup={() => router.push({ pathname: setupRoute(world?.me.need ?? []), params: { finish: '1' } })} />
      {selectedAgent && <AgentSheet agent={selectedAgent} onClose={() => setSelected(null)} />}
      {chatOpen && <CloneSheet onClose={() => setChatOpen(false)} />}
    </View>
  );
}
