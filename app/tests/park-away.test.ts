/**
 * Leaving the park's screen for a moment (the founder, 2026-10-03: "when i move to a
 * different screen ... it disappears from the other users screen instantly ... Can you
 * add a 10 sec delay when i leave for another screen. also show a dialog showing you are
 * exiting the park and will be exited from the park").
 *
 * WHAT WAS WRONG. Another tab, or the phone put away, walked you out of the park at once:
 * everybody else saw you vanish, your bench and your conversation ended, and coming back
 * a second later walked you in again from scratch.
 *
 * WHAT IS GUARDED:
 *   - off screen you are still in the park, AWAY, for PARK_AWAY_MS, then out; back on
 *     screen before then, nothing changed (park-live.ts parkPresence; the hook's timer is
 *     that constant -- source shape, as the hook needs React Native);
 *   - away, nothing is sent about where you are (a move would say you were back), the mic
 *     is off and nobody is heard, and coming back asks for a voice pass if it went;
 *   - another tab, from inside the park, asks first and says what happens -- not from
 *     anywhere else, and not again while already away;
 *   - the server holds you the same ten seconds (server tests/park-arrive-away.test.ts).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - parkPresence without `held` -> "still in the park while away" fails;
 *   - asksBeforeLeaving always false -> "asks first, from inside the park" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARK_AWAY_MS } from '@clone/shared';
import { parkPresence, useParkLive } from '../src/features/world/park-live';
import { LEAVE_PARK, asksBeforeLeaving } from '../src/features/world/leave-park';

const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (f: string) => strip(readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8'));

describe('away from the park', () => {
  it('is still in the park while away, then out', () => {
    expect(parkPresence(true, true, false)).toEqual({ inPark: true, away: false });
    // Off screen, within the grace: in, and away.
    expect(parkPresence(true, false, true)).toEqual({ inPark: true, away: true });
    // The grace ran out.
    expect(parkPresence(true, false, false)).toEqual({ inPark: false, away: false });
    // Back to the city: out, whatever the screen.
    expect(parkPresence(false, true, true)).toEqual({ inPark: false, away: false });
    expect(PARK_AWAY_MS).toBe(10_000);
  });

  it('holds you PARK_AWAY_MS off screen, and lets go of the hold back on it (source shape)', () => {
    const presence = read('features/world/park-presence.ts');
    expect(presence).toMatch(/if \(onScreen\) \{ setHeld\(true\); return; \}\s*const t = setTimeout\(\(\) => setHeld\(false\), PARK_AWAY_MS\);\s*return \(\) => clearTimeout\(t\);/);
    expect(presence).toContain('const { inPark, away } = parkPresence(inVenue, onScreen, held);');
    expect(presence).toContain('const onScreen = focused && front;');
    // The world screen gives the park and the focus separately, so leaving the tab is not leaving the park.
    expect(read('features/world/world-screen.tsx')).toContain("useParkPresence(realm.phase === 'venue', focused, venueSim, venueLayout.benches);");
  });

  it('sends nothing about where you are while away, and says away and back', () => {
    const presence = read('features/world/park-presence.ts');
    const loop = presence.slice(presence.indexOf('const t = setInterval('), presence.indexOf('}, EVERY_MS);'));
    expect(loop.indexOf('if (live.away) return;'), 'a move while away tells the server you are back').toBeGreaterThan(0);
    expect(loop.indexOf('if (live.away) return;')).toBeLessThan(loop.indexOf('parkMove('));
    expect(presence).toMatch(/if \(away\) \{ awaySince\.current = Date\.now\(\); parkAway\(\); return; \}/);
    const socket = read('lib/socket.ts');
    expect(socket).toMatch(/export function parkAway\(\): void \{[\s\S]*?setAway\(true\);\s*push\(\{ type: 'park\.away' \}\);/);
    // Back with no voice pass (the phone put away lets go of it): ask for one.
    expect(socket).toMatch(/export function parkBack\(\): void \{[\s\S]*?setAway\(false\);\s*if \(!useParkVoice\.getState\(\)\.pass\) parkVoiceAgain\(\);/);
  });

  it('keeps the mic off and the voices quiet while away (source shape: only a voice server sees it)', () => {
    const voice = read('features/world/voice-room.ts');
    const apply = voice.slice(voice.indexOf('const apply = () =>'), voice.indexOf('const leave = async'));
    expect(apply).toMatch(/const hear = live\.away \? new Map<string, number>\(\)/);
    expect(apply).toMatch(/const mic = v\.micOn && l\.pass\.canTalk && !live\.away;/);
    expect(voice).toMatch(/if \(s\.people !== prev\.people \|\| s\.away !== prev\.away\) apply\(\);/);
  });

  it('the store knows away from in, and walking in or out clears it', () => {
    const s = useParkLive.getState();
    s.setIn(true);
    s.setAway(true);
    expect(useParkLive.getState()).toMatchObject({ inPark: true, away: true });
    s.setIn(false);
    expect(useParkLive.getState()).toMatchObject({ inPark: false, away: false, arrived: null });
    s.setIn(true);
    expect(useParkLive.getState().away).toBe(false);
    s.setIn(false);
  });
});

describe('the dialog on leaving', () => {
  it('asks first, from inside the park -- not from outside it, nor again while away', () => {
    expect(asksBeforeLeaving({ inPark: true, away: false })).toBe(true);
    expect(asksBeforeLeaving({ inPark: false, away: false })).toBe(false);
    expect(asksBeforeLeaving({ inPark: true, away: true })).toBe(false);
  });

  it('says what happens, in plain words, with the grace in seconds', () => {
    expect(LEAVE_PARK.title).toBe('Leave Cubbon Park?');
    expect(LEAVE_PARK.body).toContain(`${PARK_AWAY_MS / 1000} seconds`);
    expect(LEAVE_PARK.body).toMatch(/out of the park/);
    expect([LEAVE_PARK.stay, LEAVE_PARK.leave]).toEqual(['Stay', 'Leave']);
  });

  it('is asked by every other tab, before the tab opens (source shape)', () => {
    const tabs = read('app/(tabs)/_layout.tsx');
    for (const name of ['matches', 'chats', 'profile']) {
      expect(tabs, name).toMatch(new RegExp(`name="${name}"\\s*listeners=\\{leavingParkFirst\\}`));
    }
    const press = tabs.slice(tabs.indexOf('tabPress:'), tabs.indexOf('function TabIcon'));
    expect(press.indexOf('e.preventDefault()')).toBeLessThan(press.indexOf('Alert.alert('));
    expect(press).toMatch(/text: LEAVE_PARK\.leave, onPress: \(\) => navigation\.navigate\(route\.name\)/);
  });
});
