/**
 * Cubbon Park, live: who is in it right now, where they stand, and who hears whom.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-29): real people in the park at the same time,
 * who can see each other and talk. Until this, "the people in the park" were a ranked
 * sample of the pool, simulated on the phone -- nobody in it was actually there.
 *
 * THE RULES, all of them here, none in the app:
 *   - You are sent to the people within PARK_VIEW of you (the park's mist), under the
 *     per-viewer ref the square already gives you, and never to anybody you are kept
 *     apart from -- blocked either way, or banned (`apart()` in 0064).
 *   - What you say reaches the people within PARK_EARSHOT of you, and nobody else.
 *     It is written nowhere: the room holds positions and looks, never words.
 *   - A sentence holding a phone number, an email, a handle or a link is refused
 *     (shared/contact.ts): those are swapped after both say yes, here as everywhere.
 *   - Somebody who has sent nothing for STALE_MS has left, whatever their socket says.
 *
 * PURE. No database and no sockets: the caller (park/socket.ts) loads looks and who is
 * apart, and delivers what this returns. tests/park-room.test.ts holds it on its own.
 *
 * One room, in process, because there is one replica; the seam to move it (to Redis,
 * say) is this class.
 */
import { PARK_EARSHOT, PARK_VIEW, contactDetail, type Look, type ParkPerson } from '@clone/shared';

/** Silence this long and you have left the park: a phone put away mid-walk. */
export const STALE_MS = 30_000;
/**
 * How far a voice carries: earshot, as for what is typed, and a little over so a phone
 * does not drop and pick up a voice at the edge with every step. The phone's own volume
 * has faded to nothing by earshot (the app's park-voice.ts).
 */
export const VOICE_REACH = PARK_EARSHOT + 0.3;

export interface Member {
  userId: string;
  look: Look;
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  /** On a bicycle, as their phone last said. */
  riding: boolean;
  /** Who they are to the voice server (voice.ts): random per visit, never the user id. */
  voice: string;
  /** When they last sent anything: moving or standing, the app says so every few seconds. */
  seen: number;
}

export type Said =
  | { ok: true; to: { userId: string; ref: string | 'you' }[]; private: boolean }
  | { ok: false; reason: 'contact' | 'not_in_park' };

/**
 * Who is sitting privately with whom (pairs.ts). Somebody on a bench talks only to
 * their partner, and hears nobody else.
 */
export interface Seats {
  benchOf(userId: string): number | null;
  partnerOf(userId: string): string | null;
}

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class ParkRoom {
  readonly members = new Map<string, Member>();
  private readonly apart = new Set<string>();

  constructor(
    /** The square's per-viewer ref: matching/world.ts agentRef. */
    private readonly refOf: (viewerId: string, otherId: string) => string,
    private readonly now: () => number = Date.now,
    /** Private benches; none by default. */
    private readonly seats: Seats | null = null,
  ) {}

  /**
   * Somebody walks in. `apartFrom` is everybody already here they are kept apart from,
   * which the caller asked the database for; it goes both ways.
   */
  enter(userId: string, look: Look, apartFrom: readonly string[], at?: { x: number; z: number }, voice?: string): void {
    for (const other of apartFrom) this.apart.add(pair(userId, other));
    const was = this.members.get(userId);
    this.members.set(userId, {
      userId, look,
      x: at?.x ?? was?.x ?? 0, z: at?.z ?? was?.z ?? 0,
      facing: was?.facing ?? 0, moving: false, riding: was?.riding ?? false,
      voice: voice ?? was?.voice ?? '', seen: this.now(),
    });
  }

  leave(userId: string): void {
    this.members.delete(userId);
    // Who is apart from whom is kept: it does not change by walking out, and the next
    // visit asks the database again anyway.
  }

  /** Kept apart from now on, for as long as either is here: a block made in the park. */
  keepApart(a: string, b: string): void {
    this.apart.add(pair(a, b));
  }

  isApart(a: string, b: string): boolean {
    return this.apart.has(pair(a, b));
  }

  move(userId: string, x: number, z: number, facing: number, moving: boolean, riding = false): boolean {
    const m = this.members.get(userId);
    if (!m) return false;
    m.x = x; m.z = z; m.facing = facing; m.moving = moving; m.riding = riding; m.seen = this.now();
    return true;
  }

  /** Everybody here that `viewer` may see within `radius`, nearest first. */
  near(viewerId: string, radius: number): Member[] {
    const me = this.members.get(viewerId);
    if (!me) return [];
    const r2 = radius * radius;
    const out: { m: Member; d: number }[] = [];
    for (const m of this.members.values()) {
      if (m.userId === viewerId || this.isApart(viewerId, m.userId)) continue;
      const dx = m.x - me.x, dz = m.z - me.z;
      const d = dx * dx + dz * dz;
      if (d <= r2) out.push({ m, d });
    }
    return out.sort((a, b) => a.d - b.d).map((o) => o.m);
  }

  /**
   * What `viewer` is sent: the people within the mist, as the square refers to them --
   * and, for those within earshot, their voice id, the only voices the viewer's phone
   * listens to and the only listeners it lets hear it (voice.ts). Nobody on a bench is
   * given anybody's voice, or gives theirs: a bench talks in its own room.
   */
  snapshot(viewerId: string): ParkPerson[] {
    const me = this.members.get(viewerId);
    const benched = (id: string) => this.seats?.benchOf(id) != null;
    const reach2 = VOICE_REACH * VOICE_REACH;
    return this.near(viewerId, PARK_VIEW).map((m) => {
      const heard = me && m.voice && !benched(viewerId) && !benched(m.userId)
        && (m.x - me.x) ** 2 + (m.z - me.z) ** 2 <= reach2;
      return {
        ref: this.refOf(viewerId, m.userId),
        x: round(m.x), z: round(m.z), facing: round(m.facing), moving: m.moving, look: m.look,
        // Seen sitting once they have walked to it: what they say there is theirs, that
        // they are sitting there is not a secret.
        ...(benched(m.userId) && !m.moving ? { sitting: true } : m.riding ? { riding: true } : {}),
        ...(heard ? { voice: m.voice } : {}),
      };
    });
  }

  /**
   * Somebody says something. Returns who hears it, each under their own ref for the
   * speaker -- the speaker too, as `you` -- or why nobody does.
   */
  say(userId: string, text: string): Said {
    if (!this.members.has(userId)) return { ok: false, reason: 'not_in_park' };
    if (contactDetail(text)) return { ok: false, reason: 'contact' };
    this.members.get(userId)!.seen = this.now();
    const me = { userId, ref: 'you' as const };
    // On a bench: to the partner beside you, and nobody else however close.
    if (this.seats?.benchOf(userId) != null) {
      const partner = this.seats.partnerOf(userId);
      const to = partner && this.members.has(partner) && !this.isApart(userId, partner)
        ? [me, { userId: partner, ref: this.refOf(partner, userId) }] : [me];
      return { ok: true, to, private: true };
    }
    // Anywhere else: earshot -- bar anybody sitting on a bench, who hears nothing of it.
    const heard = this.near(userId, PARK_EARSHOT).filter((m) => this.seats?.benchOf(m.userId) == null);
    return { ok: true, to: [me, ...heard.map((m) => ({ userId: m.userId, ref: this.refOf(m.userId, userId) }))], private: false };
  }

  /** The person behind a ref `viewer` was given, if they are here and visible to them. */
  resolve(viewerId: string, ref: string): string | null {
    for (const m of this.members.values()) {
      if (m.userId !== viewerId && !this.isApart(viewerId, m.userId) && this.refOf(viewerId, m.userId) === ref) return m.userId;
    }
    return null;
  }

  /** Everybody silent for STALE_MS has gone. Returns who, so the caller can tidy up. */
  sweep(): string[] {
    const cut = this.now() - STALE_MS;
    const gone: string[] = [];
    for (const m of this.members.values()) if (m.seen < cut) gone.push(m.userId);
    for (const id of gone) this.members.delete(id);
    return gone;
  }
}

/** Centimetres are plenty: 8.1 m a unit, and a smaller frame. */
const round = (v: number) => Math.round(v * 1000) / 1000;
