/**
 * Voice in the park, on the phone: whom it listens to and how loud, who it lets listen,
 * mutes, who is talking, and the mic switch (features/world/park-voice.ts); and how
 * voice-room.ts hands that to the voice server.
 *
 * WHAT IS GUARDED:
 *   - a voice is full within VOICE_FULL and gone by earshot, quieter the further;
 *   - in the park the phone listens only to voice ids the server sent (within earshot,
 *     not kept apart, not on a bench), never to anybody muted, and to nobody with the
 *     speaker off; on a bench, to the whole room, which is the two of you;
 *   - it lets listen everybody the server gave a voice id for -- muted or not, as in
 *     games, where a mute stops only YOU hearing THEM; on a bench, the room;
 *   - who is talking comes back as refs, `you` for yourself, your partner on a bench;
 *   - the mic starts off; a pass without speech switches it off and keeps it off; walking
 *     out switches it off and forgets the pass, and keeps your mutes and your speaker;
 *   - mutes are capped at what the phone's secure store keeps in one value;
 *   - SOURCE SHAPE for voice-room.ts, whose effects only a voice server sees: it asks for
 *     no voice on joining (autoSubscribe off), says who may listen before it opens the
 *     mic, opens the mic only when the pass allows speech, and goes when the app does --
 *     but not for the phone's own "Allow the mic?", which pauses the app (and so, before
 *     the guard, walked you out of the park and off your bench).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - volumeAt ignoring distance                  -> "quieter the further" fails;
 *   - voicesToHear not skipping mutes             -> "never anybody muted" fails;
 *   - voicesToHear taking everybody's voice id... -> "only voice ids the server sent" fails;
 *   - gotPass keeping the mic on under a ban      -> "a pass without speech" fails;
 *   - autoSubscribe left on in voice-room         -> "asks for no voice" fails;
 *   - the mic opened before who may listen is set -> "says who may listen first" fails;
 *   - park-presence without the mic-prompt guard  -> "does not walk you out" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PARK_EARSHOT, STARTER, type ParkPerson } from '@clone/shared';
import { mergePeople, type LivePerson } from '../src/features/world/park-live';
import {
  MUTED_MAX, VOICE_FULL, banEnds, mayHearMe, micState, speakingRefs, toggled, useParkVoice, voicesToHear, volumeAt,
  type VoicePass,
} from '../src/features/world/park-voice';

const REF = (n: number) => n.toString(16).padStart(32, '0');
const person = (n: number, x: number, voice: string | null): LivePerson => ({
  ref: REF(n), x, z: 0, facing: 0, moving: false, look: STARTER, sitting: false, riding: false, voice,
});
const people = (...ps: LivePerson[]) => new Map(ps.map((p) => [p.ref, p]));
const pass = (over: Partial<VoicePass> = {}): VoicePass => ({
  url: 'ws://voice.test', room: 'park-cubbon', token: 't', identity: 'me', bench: false, canTalk: true, ...over,
});
const me = { x: 0, z: 0 };

describe('how loud', () => {
  it('is full near you, gone by earshot, and quieter the further', () => {
    expect(volumeAt(0)).toBe(1);
    expect(volumeAt(VOICE_FULL)).toBe(1);
    expect(volumeAt(PARK_EARSHOT)).toBe(0);
    expect(volumeAt(PARK_EARSHOT + 1)).toBe(0);
    const steps = [0.8, 1.2, 1.6, 2.0, 2.4].map(volumeAt);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
    expect(steps[0]!).toBeGreaterThan(0.8);
  });
});

describe('whom the phone listens to', () => {
  const here = people(person(1, 0.3, 'v1'), person(2, 1.5, 'v2'), person(3, 1, null), person(4, 2.7, 'v4'));

  it('only voice ids the server sent, by distance, never anybody muted, nobody with the speaker off', () => {
    const hear = voicesToHear(pass(), here, me, new Set(), true) as Map<string, number>;
    expect([...hear.keys()].sort(), 'somebody without a voice id, or past earshot, was listened to').toEqual(['v1', 'v2']);
    expect(hear.get('v1')).toBe(1);
    expect(hear.get('v2')!).toBeGreaterThan(0);
    expect(hear.get('v2')!).toBeLessThan(1);
    const muted = voicesToHear(pass(), here, me, new Set([REF(1)]), true) as Map<string, number>;
    expect([...muted.keys()], 'a muted person was listened to').toEqual(['v2']);
    expect((voicesToHear(pass(), here, me, new Set(), false) as Map<string, number>).size).toBe(0);
    expect((voicesToHear(null, here, me, new Set(), true) as Map<string, number>).size).toBe(0);
  });

  it('on a bench, the whole room: the two of you', () => {
    expect(voicesToHear(pass({ bench: true, room: 'bench-x' }), people(), me, new Set(), true)).toBe('all');
    expect((voicesToHear(pass({ bench: true }), people(), me, new Set(), false) as Map<string, number>).size).toBe(0);
  });

  it('takes the voice id from the server\'s frame', () => {
    const frame: ParkPerson[] = [{ ref: REF(1), x: 0, z: 0, facing: 0, moving: false, look: STARTER, voice: 'v1' }, { ref: REF(2), x: 1, z: 0, facing: 0, moving: false, look: STARTER }];
    const got = mergePeople(new Map(), frame);
    expect(got.get(REF(1))?.voice).toBe('v1');
    expect(got.get(REF(2))?.voice).toBeNull();
  });
});

describe('who the phone lets listen', () => {
  it('everybody the server gave a voice id for, muted or not; on a bench, the room', () => {
    const here = people(person(1, 0.3, 'v1'), person(2, 1.5, 'v2'), person(3, 1, null));
    expect(mayHearMe(pass(), here)).toEqual(['v1', 'v2']);
    expect(mayHearMe(pass({ bench: true }), here)).toBe('all');
    expect(mayHearMe(null, here)).toEqual([]);
  });
});

describe('who is talking', () => {
  it('comes back as refs: you for yourself, your partner on a bench, strangers ignored', () => {
    const here = people(person(1, 0.3, 'v1'), person(2, 1.5, 'v2'));
    expect([...speakingRefs(['v2', 'me', 'nobody'], pass(), here, null)].sort()).toEqual([REF(2), 'you'].sort());
    expect([...speakingRefs(['vX'], pass({ bench: true }), people(), REF(9))]).toEqual([REF(9)]);
    expect(speakingRefs(['v1'], null, here, null).size).toBe(0);
  });
});

describe('the mic', () => {
  beforeEach(() => {
    useParkVoice.setState({ pass: null, micOn: false, hearing: true, muted: [], speaking: new Set(), link: 'off', micDenied: false });
  });

  it('starts off, and a pass without speech switches it off and keeps it off', () => {
    const v = useParkVoice.getState;
    expect(v().micOn).toBe(false);
    v().gotPass(pass());
    v().setMic(true);
    v().setLink('on');
    expect(micState(v())).toBe('on');
    v().gotPass(pass({ canTalk: false, until: new Date(Date.now() + 3_600_000).toISOString() }));
    expect(v().micOn, 'a voice ban left the mic on').toBe(false);
    v().setMic(true);
    expect(v().micOn, 'the mic went on under a voice ban').toBe(false);
    expect(micState(v())).toBe('banned');
  });

  it('goes off on walking out, which forgets the pass and keeps the mutes and the speaker', () => {
    const v = useParkVoice.getState;
    v().gotPass(pass());
    v().setMic(true);
    v().toggleMute(REF(1));
    v().setHearing(false);
    v().setSpeaking(new Set(['you']));
    v().left();
    expect(v()).toMatchObject({ pass: null, micOn: false, muted: [REF(1)], hearing: false });
    expect(v().speaking.size).toBe(0);
  });

  it('says why it is off: denied by the phone, connecting, not in this build', () => {
    const base = { pass: pass(), micOn: true, micDenied: false, link: 'connecting' as const };
    expect(micState(base)).toBe('connecting');
    expect(micState({ ...base, micDenied: true })).toBe('denied');
    expect(micState({ ...base, link: 'unavailable' })).toBe('unavailable');
    expect(micState({ ...base, micOn: false })).toBe('off');
  });

  it('says when a ban ends as the time of day', () => {
    const d = new Date(2026, 8, 29, 14, 5);
    expect(banEnds(d.toISOString())).toBe('14:05');
    expect(banEnds(undefined)).toBe('later');
  });
});

describe('mutes', () => {
  it('toggle, and keep the latest MUTED_MAX', () => {
    expect(toggled([REF(1)], REF(1))).toEqual([]);
    expect(toggled([], REF(1))).toEqual([REF(1)]);
    let many: string[] = [];
    for (let i = 0; i < MUTED_MAX + 5; i++) many = toggled(many, REF(i));
    expect(many).toHaveLength(MUTED_MAX);
    expect(many.at(-1)).toBe(REF(MUTED_MAX + 4));
    expect(many).not.toContain(REF(0));
    // Fits one value in the phone's secure store (2048 bytes).
    expect(JSON.stringify(many).length).toBeLessThan(2048);
  });
});

describe('voice-room.ts (source shape: only a voice server sees what it does)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'voice-room.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const apply = src.slice(src.indexOf('const apply = () =>'), src.indexOf('const leave = async'));

  it('asks for no voice on joining: the phone picks whom to listen to', () => {
    expect(src).toMatch(/room\.connect\([^)]*autoSubscribe:\s*false/);
  });

  it('keeps LiveKit to warnings, not a statistics dump every half minute', () => {
    expect(src).toMatch(/lk\.setLogLevel\('warn'\);/);
  });

  it('says who may listen first, then opens the mic, and only when the pass allows speech', () => {
    const perms = apply.indexOf('setTrackSubscriptionPermissions(');
    const mic = apply.indexOf('setMicrophoneEnabled(');
    expect(perms, 'no listener list').toBeGreaterThan(0);
    expect(mic, 'the mic opened before anybody was told who may listen').toBeGreaterThan(perms);
    expect(apply).toMatch(/const mic = v\.micOn && l\.pass\.canTalk;/);
  });

  it('goes when the app does: put away, the pass and the mic go', () => {
    expect(src).toMatch(/if \(state === 'background' && !askingForMic\(\)\) useParkVoice\.getState\(\)\.left\(\);/);
  });

  it('does not walk you out of the park, or off your bench, for the phone\'s "Allow the mic?"', () => {
    // On Android the prompt pauses the app and React Native calls that "background";
    // on iOS the prompt, like a pulled-down notice, is "inactive". Neither is leaving.
    const presence = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-presence.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const handler = presence.slice(presence.indexOf("AppState.addEventListener('change'"), presence.indexOf('return () => { sub.remove(); parkLeave(); };'));
    expect(handler, 'the mic prompt walks you out').toMatch(/if \(state === 'background' && askingForMic\(\)\) return;/);
    expect(handler, 'iOS\'s passing "inactive" walks you out').toMatch(/const now = state !== 'background';/);
    expect(src).toMatch(/asking = true;[\s\S]*PermissionsAndroid\.request\(/);
  });
});
