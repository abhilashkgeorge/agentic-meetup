/**
 * Voice in the park, on the phone: whom to listen to and how loud, who may listen to
 * you, whom you have muted, and who is talking now.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): voice as the primary way to talk in the park,
 * typing kept; mute anybody near you who is a nuisance, and report them -- the way games
 * like PUBG do it. So, as there:
 *   - THE MIC is yours to switch on and off, and starts OFF: nobody is heard before they
 *     choose to be. A voice ban (server park/voice.ts) turns it off and says until when.
 *   - THE SPEAKER is yours too: off, you hear nobody.
 *   - IN THE PARK you hear whoever is near, louder the nearer (volumeAt), and nobody the
 *     server did not give you a voice id for -- out of earshot, kept apart, on a bench.
 *   - MUTE is yours alone: they are not told, and it lasts until you unmute them (kept on
 *     this phone, by the ref the park gives them to you, which is the same every visit).
 *     A report blocks too, and blocked people are never near you again.
 *   - ON A BENCH the two of you have a room of your own, which nobody else has a pass
 *     to: everybody in it is the other one, at full volume.
 *
 * The voice server is told all of this by voice-room.ts; this file only decides it.
 * NO REACT NATIVE HERE: tests/park-voice.test.ts holds the rules.
 */
import { create } from 'zustand';
import { PARK_EARSHOT, type ServerEvent } from '@clone/shared';
import type { LivePerson } from './park-live';

export type VoicePass = Omit<Extract<ServerEvent, { type: 'park.voice' }>, 'type'>;

/** Within this a voice is at full volume: about five metres (a park unit is 8.1 m). */
export const VOICE_FULL = 0.6;
/** How many people you can mute: the most the phone's secure store keeps in one value. */
export const MUTED_MAX = 50;

/** How loud somebody `d` park units away is: full near you, down to nothing at earshot. */
export function volumeAt(d: number): number {
  if (d <= VOICE_FULL) return 1;
  if (d >= PARK_EARSHOT) return 0;
  return 1 - (d - VOICE_FULL) / (PARK_EARSHOT - VOICE_FULL);
}

/**
 * Whom to listen to, by voice id, and how loud. `'all'` on a bench: the room is the two
 * of you. Nobody while the speaker is off, and never anybody muted.
 */
export function voicesToHear(
  pass: VoicePass | null,
  people: ReadonlyMap<string, LivePerson>,
  me: { x: number; z: number } | null,
  muted: ReadonlySet<string>,
  hearing: boolean,
): Map<string, number> | 'all' {
  if (!pass || !hearing) return new Map();
  if (pass.bench) return 'all';
  const out = new Map<string, number>();
  if (!me) return out;
  for (const p of people.values()) {
    if (!p.voice || muted.has(p.ref)) continue;
    const v = volumeAt(Math.hypot(p.x - me.x, p.z - me.z));
    if (v > 0) out.set(p.voice, v);
  }
  return out;
}

/**
 * Who may listen to you, by voice id: everybody the server gave you a voice id for --
 * muted or not, as in games, where muting somebody only stops YOU hearing THEM. On a
 * bench, all of the room. The voice server holds a speaker to this, whatever a
 * listener's phone asks for.
 */
export function mayHearMe(pass: VoicePass | null, people: ReadonlyMap<string, LivePerson>): string[] | 'all' {
  if (!pass) return [];
  if (pass.bench) return 'all';
  const out: string[] = [];
  for (const p of people.values()) if (p.voice) out.push(p.voice);
  return out.sort();
}

/**
 * Who is talking now, as refs: the voice ids the voice server says are talking, found
 * among the people here -- and, on a bench, whoever it is, as your partner. `you` for
 * yourself.
 */
export function speakingRefs(
  voiceIds: readonly string[],
  pass: VoicePass | null,
  people: ReadonlyMap<string, LivePerson>,
  partner: string | null,
): Set<string> {
  const out = new Set<string>();
  if (!pass) return out;
  const byVoice = new Map<string, string>();
  for (const p of people.values()) if (p.voice) byVoice.set(p.voice, p.ref);
  for (const id of voiceIds) {
    if (id === pass.identity) out.add('you');
    else if (pass.bench) { if (partner) out.add(partner); }
    else { const ref = byVoice.get(id); if (ref) out.add(ref); }
  }
  return out;
}

/** What the mic button says it is. */
export type MicState = 'off' | 'on' | 'banned' | 'denied' | 'connecting' | 'unavailable';

export function micState(s: Pick<ParkVoice, 'pass' | 'micOn' | 'micDenied' | 'link'>): MicState {
  if (s.link === 'unavailable') return 'unavailable';
  if (s.pass && !s.pass.canTalk) return 'banned';
  if (s.micDenied) return 'denied';
  if (!s.micOn) return 'off';
  return s.link === 'on' ? 'on' : 'connecting';
}

/** When a voice ban ends, as the time of day on this phone: "14:30". */
export function banEnds(until: string | undefined): string {
  if (!until) return 'later';
  const d = new Date(until);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Muting or unmuting one ref; the oldest dropped past MUTED_MAX. */
export function toggled(muted: readonly string[], ref: string): string[] {
  if (muted.includes(ref)) return muted.filter((r) => r !== ref);
  return [...muted, ref].slice(-MUTED_MAX);
}

interface ParkVoice {
  /** The latest pass from the server: which room, as whom, may you speak. */
  pass: VoicePass | null;
  /** Your mic switch. Off until you switch it on, every visit. */
  micOn: boolean;
  /** Your speaker switch: hearing people near you. */
  hearing: boolean;
  /** Refs you muted, oldest first (kept on the phone: lib/storage.ts). */
  muted: readonly string[];
  /** Who is talking now, as refs, `you` included. */
  speaking: ReadonlySet<string>;
  /** The connection to the voice server: `unavailable` when this build has no voice. */
  link: 'off' | 'connecting' | 'on' | 'failed' | 'unavailable';
  /** The phone said no to the mic. */
  micDenied: boolean;
  gotPass: (pass: VoicePass) => void;
  setMic: (on: boolean) => void;
  setHearing: (on: boolean) => void;
  toggleMute: (ref: string) => void;
  setMuted: (refs: readonly string[]) => void;
  setSpeaking: (refs: ReadonlySet<string>) => void;
  setLink: (link: ParkVoice['link']) => void;
  setMicDenied: (denied: boolean) => void;
  /** Out of the park: no pass, the mic off, nobody talking. Mutes and the speaker stay. */
  left: () => void;
}

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export const useParkVoice = create<ParkVoice>((set, get) => ({
  pass: null,
  micOn: false,
  hearing: true,
  muted: [],
  speaking: new Set(),
  link: 'off',
  micDenied: false,
  // A pass that says you may not speak switches the mic off: when the ban ends, it is
  // for you to switch it on again.
  gotPass: (pass) => set(pass.canTalk ? { pass } : { pass, micOn: false }),
  setMic: (on) => {
    if (on && get().pass && !get().pass!.canTalk) return;
    set({ micOn: on, ...(on ? {} : { micDenied: false }) });
  },
  setHearing: (hearing) => set({ hearing }),
  toggleMute: (ref) => set({ muted: toggled(get().muted, ref) }),
  setMuted: (muted) => set({ muted }),
  setSpeaking: (speaking) => { if (!same(speaking, get().speaking)) set({ speaking }); },
  setLink: (link) => set({ link }),
  setMicDenied: (micDenied) => set(micDenied ? { micDenied, micOn: false } : { micDenied }),
  left: () => set({ pass: null, micOn: false, speaking: new Set(), link: get().link === 'unavailable' ? 'unavailable' : 'off' }),
}));
