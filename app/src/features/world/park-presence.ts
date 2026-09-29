/**
 * Being in the park, live: walking in and out with the server, telling it where you
 * are, and putting whoever else is here into the park's own sim.
 *
 * In the park means the park is on screen: on the Town tab, the app in front. Put the
 * phone away or open another tab and you walk out; come back and you walk in again.
 * Nothing is sent from anywhere else in the app.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { parkEnter, parkLeave, parkMove } from '../../lib/socket';
import { useParkLive, type LivePerson } from './park-live';
import type { WorldSim } from './sim';

/** How often where you are is checked, and sent if it changed. */
const EVERY_MS = 200;
/** Standing still, it is still sent this often: the server lets the silent go (STALE_MS). */
const STILL_MS = 2_000;

export function useParkPresence(inPark: boolean, venueSim: WorldSim): void {
  // In and out, with the app's own comings and goings.
  useEffect(() => {
    if (!inPark) return;
    let front = AppState.currentState === 'active';
    if (front) parkEnter();
    const sub = AppState.addEventListener('change', (state) => {
      const now = state === 'active';
      if (now === front) return;
      front = now;
      if (now) parkEnter(); else parkLeave();
    });
    return () => { sub.remove(); parkLeave(); };
  }, [inPark]);

  // Where you are: whenever it changed, checked five times a second.
  useEffect(() => {
    if (!inPark) return;
    let last = { x: NaN, z: NaN, facing: NaN, moving: false, at: 0 };
    const t = setInterval(() => {
      const me = venueSim.get('you');
      if (!me) return;
      const moving = venueSim.driven('you');
      const now = Date.now();
      const changed = Math.hypot(me.x - last.x, me.z - last.z) > 0.01
        || Math.abs(me.facing - last.facing) > 0.05 || moving !== last.moving;
      if (!changed && now - last.at < STILL_MS) return;
      parkMove(me.x, me.z, me.facing, moving);
      last = { x: me.x, z: me.z, facing: me.facing, moving, at: now };
    }, EVERY_MS);
    return () => clearInterval(t);
  }, [inPark, venueSim]);

  // Whoever is here, into the sim; whoever has gone, out of it.
  useEffect(() => {
    if (!inPark) return;
    const apply = (people: ReadonlyMap<string, LivePerson>) => {
      for (const p of people.values()) venueSim.live(p.ref, p.look, p.x, p.z, p.facing, p.moving);
      for (const a of venueSim.agents()) if (a.kind === 'live' && !people.has(a.ref)) venueSim.unlive(a.ref);
    };
    apply(useParkLive.getState().people);
    const unsubscribe = useParkLive.subscribe((s, prev) => { if (s.people !== prev.people) apply(s.people); });
    return () => {
      unsubscribe();
      for (const a of venueSim.agents()) if (a.kind === 'live') venueSim.unlive(a.ref);
    };
  }, [inPark, venueSim]);
}
