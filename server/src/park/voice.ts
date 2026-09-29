/**
 * Voice in Cubbon Park: who may speak, into which room, and who is silenced.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "I need voice chat option not just text. keep
 * texting option too. keep voice chat as the primary option ... he should be able to
 * mute others if he is in proximity chat, i.e. if someone is creating a nuisance then we
 * need to mute and report him (look into how games like PUBG do it and use the same
 * approach)."
 *
 * HOW GAMES DO IT, and so how this does. PUBG and its kind give everyone a mic switch
 * (off / on) and a speaker switch; in proximity voice you hear whoever is near, louder
 * the nearer; any player can be muted by you alone, at once, and reported; enough
 * reports and the game takes that player's mic away for a while. Voice runs through a
 * voice server (they use Vivox and the like), never phone to phone.
 *
 * THE VOICE SERVER is LiveKit -- open source, free, run on this laptop in development
 * (livekit.dev.yaml) -- and this file is all the app server says to it:
 *   - A PASS (a signed token) to one room, as an opaque voice id that is not the user id:
 *     the park's own room (PARK_ROOM) on walking in, and on a bench a room of the two's
 *     own (benchRoom) that nobody else is given a pass to -- so a bench is private by
 *     construction, not by anybody's goodwill.
 *   - WHO HEARS WHOM in the park room follows the text rule (room.ts): within earshot,
 *     never anybody kept apart, nothing to or from a bench. The park tells each phone the
 *     voice ids near it (ParkPerson.voice), and each phone listens only to those and lets
 *     only those listen to it (the voice server enforces what a speaker allows).
 *   - A VOICE BAN: VOICE_BAN.reporters different people reporting your voice within
 *     VOICE_BAN.hours, and your pass says you may not speak until it runs out; if you are
 *     in the room, the voice server takes your mic at once. Muting is the listener's own
 *     and needs nobody's leave (the app).
 *
 * Nothing is recorded, here or on the voice server: voice goes from one phone to the
 * others near it and nowhere else. A report says it was about voice; it carries no audio.
 */
import { createHash } from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { matchmakerSession } from '../db/client.js';
import { env } from '../env.js';
import { log } from '../log.js';

/** Reports of somebody's voice, from this many different people, within these hours. */
export const VOICE_BAN = { reporters: 3, hours: 24 } as const;
/** Everybody in Cubbon Park, before the distance rule. */
export const PARK_ROOM = 'park-cubbon';
/** How a park report says it was about somebody's voice (api/park.ts). */
export const VOICE_REPORT = 'In the park, by voice.';
/** A pass lasts this long; walking in, sitting and standing each give a fresh one. */
const PASS_TTL = '2h';

export interface VoicePass {
  url: string;
  room: string;
  token: string;
  identity: string;
  /** A bench's own room: only the two of them in it, so the phone listens to all of it. */
  bench: boolean;
  canTalk: boolean;
  /** Set when a voice ban is why canTalk is false: when it ends. */
  until?: string;
}

/** Whether this server has a voice server to hand passes out for. */
export function voiceOn(): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

/**
 * The room for two people on a bench: named by a hash of the two ids and the server's
 * secret, so the name says nothing about who, and nobody can work it out to ask for it.
 * The same for both, whichever way round.
 */
export function benchRoom(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `bench-${createHash('sha256').update(`${env.AUTH_SECRET}|${x}|${y}`).digest('hex').slice(0, 24)}`;
}

/**
 * A pass into `room` as `identity`. Speaking is `canTalk`; listening always; sending
 * data never (the park's text goes through the app server, where its rules live).
 */
export async function voicePass(identity: string, room: string, canTalk: boolean, until?: Date): Promise<VoicePass> {
  const at = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, { identity, ttl: PASS_TTL });
  at.addGrant({ roomJoin: true, room, canPublish: canTalk, canSubscribe: true, canPublishData: false });
  return {
    url: env.LIVEKIT_URL!, room, token: await at.toJwt(), identity, bench: room !== PARK_ROOM, canTalk,
    ...(until ? { until: until.toISOString() } : {}),
  };
}

/**
 * Until when somebody may not speak: VOICE_BAN.reporters different people reported
 * their voice in the last VOICE_BAN.hours, and it lasts that long from the latest of
 * them. Null: they may. Read by the review role, the one that reads reports.
 */
export async function voiceBannedUntil(userId: string): Promise<Date | null> {
  const { rows } = await matchmakerSession((c) => c.query<{ reporters: string; latest: Date | null }>(
    `SELECT count(DISTINCT reporter_id) AS reporters, max(created_at) AS latest
       FROM reports
      WHERE reported_id = $1 AND detail LIKE $2 || '%'
        AND created_at > now() - make_interval(hours => $3)`,
    [userId, VOICE_REPORT, VOICE_BAN.hours]));
  const r = rows[0];
  if (!r || Number(r.reporters) < VOICE_BAN.reporters || !r.latest) return null;
  return new Date(new Date(r.latest).getTime() + VOICE_BAN.hours * 3_600_000);
}

/** The voice server's own address, for this server's calls to it. */
function apiUrl(): string {
  return env.LIVEKIT_API_URL ?? env.LIVEKIT_URL!.replace(/^ws/, 'http');
}

/**
 * Put somebody out of a room now, without waiting for their phone: two people on a bench
 * who are kept apart from now on (a block, a report) leave its room at once, and the pass
 * each still holds for it opens it to nobody but the other, who is gone too.
 */
export async function evict(room: string, identity: string): Promise<void> {
  if (!voiceOn()) return;
  try {
    const rooms = new RoomServiceClient(apiUrl(), env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
    await rooms.removeParticipant(room, identity);
  } catch (err) {
    log.info({ err: (err as Error).message }, 'park voice: nobody to put out');
  }
}

/**
 * Take somebody's mic in a room now, without waiting for their phone: a ban takes
 * effect at once. They can still hear. Nothing to do if they are not in it.
 */
export async function silence(room: string, identity: string): Promise<void> {
  if (!voiceOn()) return;
  try {
    const rooms = new RoomServiceClient(apiUrl(), env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
    await rooms.updateParticipant(room, identity, { permission: { canPublish: false, canSubscribe: true, canPublishData: false } });
  } catch (err) {
    // Not in the room, or the voice server away: the pass they are sent next says it.
    log.info({ err: (err as Error).message }, 'park voice: nothing to silence');
  }
}
