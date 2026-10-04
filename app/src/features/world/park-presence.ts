/**
 * Being in the park, live: walking in and out with the server, telling it where you
 * are, and putting whoever else is here into the park's own sim.
 *
 * In the park means the park is on screen: on the Town tab, the app in front. Put the
 * phone away or open another tab and you are AWAY: still in the park, standing where you
 * were, for PARK_AWAY_MS; back before then and nobody saw you go, else you walk out (the
 * founder, 2026-10-03: "it disappears from the other users screen instantly ... add a 10
 * sec delay"). Nothing is sent from anywhere else in the app.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { PARK_AWAY_MS } from '@clone/shared';
import { parkAway, parkBack, parkEnter, parkLeave, parkMove, parkStand, parkWalkBackIn } from '../../lib/socket';
import { flies, landingBeside } from './flight';
import { comings } from './park-comings';
import { livePeople, movingNow, parkPresence, useParkLive, type LivePerson } from './park-live';
import { seatOn } from './bench';
import type { WorldSim } from './sim';
import { askingForMic, startVoice } from './voice-room';

/** How often where you are is checked, and sent if it changed. */
const EVERY_MS = 200;
/** Standing still, it is still sent this often: the server lets the silent go (STALE_MS). */
const STILL_MS = 2_000;
/**
 * How long to wait for the server to say where you stand (park.arrived) before saying
 * where you are anyway: a server from before it said so never will.
 */
const ARRIVE_WAIT_MS = 3_000;
/** Nobody lands closer than this to somebody already standing there. */
const PERSONAL = 0.22;

export function useParkPresence(
  inVenue: boolean,
  focused: boolean,
  venueSim: WorldSim,
  benches: readonly { x: number; z: number; rot: number }[],
): void {
  // The app in front, as this park counts it: not iOS's passing "inactive" (a pulled-down
  // notice, the mic prompt), nor Android's pause for the phone's "Allow the mic?"
  // (voice-room.ts), either of which walked you out of the park and ended your bench.
  const [front, setFront] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && askingForMic()) return;
      setFront(state !== 'background');
    });
    return () => sub.remove();
  }, []);
  const onScreen = focused && front;

  // THE GRACE: off screen, still here for PARK_AWAY_MS.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!inVenue) { setHeld(false); return; }
    if (onScreen) { setHeld(true); return; }
    const t = setTimeout(() => setHeld(false), PARK_AWAY_MS);
    return () => clearTimeout(t);
  }, [inVenue, onScreen]);
  const { inPark, away } = parkPresence(inVenue, onScreen, held);

  // Walked in from the city, the server finds you a free spot at the arrival; back after
  // the grace ran out, you come back where you stood.
  const fresh = useRef(true);
  useEffect(() => { if (!inVenue) fresh.current = true; }, [inVenue]);

  // In and out.
  useEffect(() => {
    if (!inPark) return;
    const me = venueSim.get('you');
    parkEnter(!fresh.current && me ? { x: me.x, z: me.z } : undefined);
    fresh.current = false;
    return () => { parkLeave(); };
  }, [inPark, venueSim]);

  // Away and back: the server holds you, standing; back, the next move says so -- or,
  // away for the whole grace, the server may have let you go, so in again where you are.
  const awaySince = useRef<number | null>(null);
  useEffect(() => {
    if (!inPark) { awaySince.current = null; return; }
    if (away) { awaySince.current = Date.now(); parkAway(); return; }
    if (awaySince.current === null) return;
    const gone = Date.now() - awaySince.current;
    awaySince.current = null;
    parkBack();
    if (gone >= PARK_AWAY_MS - 500) parkWalkBackIn();
  }, [inPark, away]);

  // Where the server says you stand: down onto it by parachute (flight.ts drop), as
  // everybody near sees you come.
  useEffect(() => {
    if (!inPark) return;
    return useParkLive.subscribe((s, prev) => {
      if (!s.arrived || s.arrived === prev.arrived) return;
      const me = venueSim.get('you');
      if (me?.fly) return;
      venueSim.place('you', s.arrived.x, s.arrived.z);
      venueSim.dropIn('you', s.arrived.x, s.arrived.z);
    });
  }, [inPark, venueSim]);

  // Where you are: whenever it changed, checked five times a second.
  useEffect(() => {
    if (!inPark) return;
    const entered = Date.now();
    let last = { x: NaN, z: NaN, facing: NaN, moving: false, riding: false, flying: false, at: 0 };
    const t = setInterval(() => {
      const me = venueSim.get('you');
      if (!me) return;
      const live = useParkLive.getState();
      // Away, nothing: a move would tell the server you were back.
      if (live.away) return;
      // Not till the server has said where you stand: a move first would put you back
      // where this phone had you, on top of whoever the server kept you clear of.
      if (!live.arrived && Date.now() - entered < ARRIVE_WAIT_MS) return;
      const flying = !!me.fly;
      const moving = movingNow(me, venueSim.driven('you'));
      // Only a pickup goes to the others; coming down into the park they play for themselves.
      const pickup = me.fly && (me.fly.f.kind ?? 'pickup') === 'pickup' ? me.fly : undefined;
      const riding = me.riding === true;
      const now = Date.now();
      const changed = Math.hypot(me.x - last.x, me.z - last.z) > 0.01
        || Math.abs(me.facing - last.facing) > 0.05 || moving !== last.moving || riding !== last.riding || flying !== last.flying;
      // Walked off the bench with the stick: up, for the server too, so talk is heard
      // nearby again rather than staying between two people no longer sitting.
      if (live.bench !== null && !me.seat && me.state !== 'sitting' && !flying) parkStand();
      if (!changed && now - last.at < STILL_MS) return;
      parkMove(me.x, me.z, me.facing, moving, riding,
        pickup ? { fx: pickup.f.fx, fz: pickup.f.fz, tx: pickup.f.tx, tz: pickup.f.tz, t: Math.round(pickup.ms) } : undefined);
      last = { x: me.x, z: me.z, facing: me.facing, moving, riding, flying, at: now };
    }, EVERY_MS);
    return () => clearInterval(t);
  }, [inPark, venueSim]);

  // On a bicycle or off it, as the store says -- and off it on walking out of the park.
  useEffect(() => {
    if (!inPark) return;
    venueSim.setRiding('you', useParkLive.getState().riding);
    const unsubscribe = useParkLive.subscribe((s, prev) => { if (s.riding !== prev.riding) venueSim.setRiding('you', s.riding); });
    return () => { unsubscribe(); venueSim.setRiding('you', false); };
  }, [inPark, venueSim]);

  // A yes to your "Find someone": the emergency pickup takes you over (flight.ts) --
  // in front of them, where they look, never inside a tree, a bench or somebody. The one
  // who said yes stays where they are and watches you come down.
  useEffect(() => {
    if (!inPark) return;
    return useParkLive.subscribe((s, prev) => {
      const to = s.partner?.rideTo;
      if (!to || s.partner === prev.partner) return;
      const me = venueSim.get('you');
      const done = () => useParkLive.getState().rode();
      if (!me) { done(); return; }
      const clear = (x: number, z: number) => venueSim.standable(x, z)
        && !venueSim.agents().some((a) => a.ref !== 'you' && Math.hypot(a.x - x, a.z - z) < PERSONAL);
      const facing = s.people.get(s.partner!.ref)?.facing ?? null;
      const [lx, lz] = landingBeside([me.x, me.z], to, clear, undefined, facing);
      // Near enough to walk: a few steps over, not a lift on the spot.
      if (!flies([me.x, me.z], [lx, lz])) { venueSim.walkTo('you', lx, lz); done(); return; }
      const flying = venueSim.flyTo('you', lx, lz, () => {
        // Down: facing them.
        const a = venueSim.get('you');
        if (a) a.facing = Math.atan2(to[0] - a.x, to[1] - a.z);
        done();
      });
      if (!flying) done();
    });
  }, [inPark, venueSim]);

  // The bench: to your seat and down, when it is yours; up, when it is not. The one
  // who asked takes the left seat, so the two phones agree without saying so.
  useEffect(() => {
    if (!inPark) return;
    return useParkLive.subscribe((s, prev) => {
      if (s.bench === prev.bench) return;
      const bench = s.bench !== null ? benches[s.bench] : undefined;
      if (bench && s.partner) venueSim.sitOn('you', seatOn(bench, s.partner.asker));
      else venueSim.standUp('you');
    });
  }, [inPark, venueSim, benches]);

  // Voice: into the room each pass is for, out of it on walking out (voice-room.ts).
  useEffect(() => {
    if (!inPark) return;
    return startVoice(venueSim);
  }, [inPark, venueSim]);

  // Whoever is here, into the sim; whoever has gone, out of it -- coming down by parachute
  // or taken up by the plane when it happens near you (park-comings.ts), except the crowd
  // already here as you walk in.
  useEffect(() => {
    if (!inPark) return;
    let first = true;
    const apply = (people: ReadonlyMap<string, LivePerson>) => livePeople(venueSim, people, useParkLive.getState().partner?.ref ?? null);
    apply(useParkLive.getState().people);
    const unsubscribe = useParkLive.subscribe((s, prev) => {
      if (s.people !== prev.people) {
        // Waiting to be told where you stand -- walking in, or back after a dropped
        // connection, which forgets everybody -- the next frame is everybody already here.
        if (!s.arrived) first = true;
        else {
          const me = venueSim.get('you');
          const { came, went } = comings(prev.people, s.people, me ? { x: me.x, z: me.z } : null, first);
          first = false;
          // Taken away before the sim forgets them; dropped in once the sim has them.
          for (const ref of went) venueSim.liftAway(ref);
          apply(s.people);
          for (const ref of came) { const p = s.people.get(ref); if (p) venueSim.dropIn(ref, p.x, p.z); }
          if (s.partner !== prev.partner) apply(s.people);
          return;
        }
      }
      if (s.people !== prev.people || s.partner !== prev.partner) apply(s.people);
    });
    return () => {
      unsubscribe();
      for (const a of venueSim.agents()) if (a.kind === 'live') venueSim.unlive(a.ref);
    };
  }, [inPark, venueSim]);
}
