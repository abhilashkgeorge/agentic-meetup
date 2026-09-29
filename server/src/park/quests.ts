/**
 * Things two people do together in Cubbon Park, noticed as they do them, and who has
 * done which today (the list is shared/park-quests.ts).
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "add more tasks couples can do in the park.
 * gameify it." So a pair (pairs.ts) that walks side by side, rides side by side, sits
 * and talks on a bench, or stands at three of the park's sights together, has done
 * something -- and each of them is paid for it, once a day (socket.ts pays; the ledger's
 * UNIQUE (user, reason, day) is what makes it once).
 *
 * WHAT IT READS is what the park already knows and nothing more: where each person is,
 * whether they are moving or riding (room.ts), who is paired with whom (pairs.ts), and
 * HOW MANY things each has said on a bench -- a count. What was said is never seen
 * here; the room hands on words and keeps none.
 *
 * WHAT IS HARD TO FAKE, cheaply: a walk counts only while both move and stand within
 * a few metres of each other, and never faster than a walk (COUNTS_UP_TO) -- so a phone
 * that says it jumped across the park walked no further for it. Positions are the
 * phones' own word, as everywhere in the park; the most anybody can take by lying is
 * one day's points, once.
 *
 * PURE, like room.ts and pairs.ts: tests/park-quests.test.ts holds it on its own.
 */
import {
  COUNTS_UP_TO, PARK_QUESTS, PARK_SIGHTS, TOGETHER_RIDING, TOGETHER_WALKING, parkDay, type ParkQuestId,
} from '@clone/shared';

export interface Done { userId: string; quest: ParkQuestId }

export interface QuestState {
  day: string;
  done: ParkQuestId[];
  /** How far along each is: units walked or ridden together, things said, sights seen. */
  progress: Record<ParkQuestId, number>;
  /** The sights seen together today, by id. */
  sights: string[];
}

interface Person { day: string; done: Set<ParkQuestId>; sights: Set<string>; said: number }
interface Walk { walk: number; ride: number; last: { x: number; z: number } | null }

/** Where somebody is, as the room keeps it. */
export interface Whereabouts { x: number; z: number; moving: boolean; riding: boolean }

const goal = (id: ParkQuestId) => PARK_QUESTS.find((q) => q.id === id)!.goal;
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class ParkQuests {
  private readonly people = new Map<string, Person>();
  private readonly walks = new Map<string, Walk>();

  constructor(private readonly now: () => number = Date.now) {}

  /** In the park, with what they have already been paid for today (the ledger's word). */
  enter(userId: string, doneToday: readonly ParkQuestId[]): void {
    const day = parkDay(this.now());
    const was = this.people.get(userId);
    const keep = was && was.day === day;
    this.people.set(userId, {
      day, done: new Set([...(keep ? was.done : []), ...doneToday]), sights: keep ? was.sights : new Set(), said: keep ? was.said : 0,
    });
  }

  leave(userId: string): void {
    this.people.delete(userId);
    for (const k of [...this.walks.keys()]) if (k.split('|').includes(userId)) this.walks.delete(k);
  }

  /** Who is in, for the socket to send each their state. */
  has(userId: string): boolean {
    return this.people.has(userId);
  }

  /** Two people start talking: both have met somebody here. */
  paired(a: string, b: string): Done[] {
    this.walks.set(key(a, b), { walk: 0, ride: 0, last: null });
    for (const u of [a, b]) { const p = this.person(u); if (p) p.said = 0; }
    return [...this.complete(a, 'hello'), ...this.complete(b, 'hello')];
  }

  parted(a: string, b: string): void {
    this.walks.delete(key(a, b));
    for (const u of [a, b]) { const p = this.person(u); if (p) p.said = 0; }
  }

  /**
   * Somebody said something. On a bench with their partner it counts towards sitting
   * and talking; the count is all this ever learns.
   */
  said(userId: string, partner: string | null, onBench: boolean): Done[] {
    const me = this.person(userId);
    if (!me || !partner || !onBench) return [];
    me.said++;
    const them = this.person(partner);
    if (!them || Math.min(me.said, them.said) < goal('talk')) return [];
    return [...this.complete(userId, 'talk'), ...this.complete(partner, 'talk')];
  }

  /**
   * A tick of the park: every pair that walks or rides side by side goes further, and
   * every pair standing at a sight has seen it. Returns what was done.
   */
  step(dt: number, where: ReadonlyMap<string, Whereabouts>, partnerOf: (userId: string) => string | null): Done[] {
    const out: Done[] = [];
    for (const [k, w] of this.walks) {
      const [a, b] = k.split('|') as [string, string];
      if (partnerOf(a) !== b) { this.walks.delete(k); continue; }
      const ma = where.get(a), mb = where.get(b);
      if (!ma || !mb) continue;
      const mid = { x: (ma.x + mb.x) / 2, z: (ma.z + mb.z) / 2 };
      const apart = Math.hypot(ma.x - mb.x, ma.z - mb.z);
      if (w.last && ma.moving && mb.moving) {
        const moved = Math.hypot(mid.x - w.last.x, mid.z - w.last.z);
        if (ma.riding && mb.riding && apart <= TOGETHER_RIDING) w.ride += Math.min(moved, COUNTS_UP_TO.ride * dt);
        else if (!ma.riding && !mb.riding && apart <= TOGETHER_WALKING) w.walk += Math.min(moved, COUNTS_UP_TO.walk * dt);
      }
      w.last = mid;
      if (w.walk >= goal('walk')) out.push(...this.complete(a, 'walk'), ...this.complete(b, 'walk'));
      if (w.ride >= goal('ride')) out.push(...this.complete(a, 'ride'), ...this.complete(b, 'ride'));
      // A sight, seen by both of them standing at it.
      for (const s of PARK_SIGHTS) {
        if (Math.hypot(ma.x - s.x, ma.z - s.z) > s.r || Math.hypot(mb.x - s.x, mb.z - s.z) > s.r) continue;
        for (const u of [a, b]) {
          const p = this.person(u);
          if (!p || p.sights.has(s.id)) continue;
          p.sights.add(s.id);
          if (p.sights.size >= goal('sights')) out.push(...this.complete(u, 'sights'));
        }
      }
    }
    return out;
  }

  /** What somebody has done and how far along the rest are, for their phone. */
  stateOf(userId: string, partner: string | null): QuestState | null {
    const p = this.person(userId);
    if (!p) return null;
    const w = partner ? this.walks.get(key(userId, partner)) : undefined;
    const them = partner ? this.person(partner) : undefined;
    const at = (id: ParkQuestId, n: number) => (p.done.has(id) ? goal(id) : Math.min(goal(id), n));
    return {
      day: p.day,
      done: PARK_QUESTS.map((q) => q.id).filter((id) => p.done.has(id)),
      progress: {
        hello: at('hello', 0),
        walk: at('walk', Math.floor(w?.walk ?? 0)),
        ride: at('ride', Math.floor(w?.ride ?? 0)),
        talk: at('talk', Math.min(p.said, them?.said ?? 0)),
        sights: at('sights', p.sights.size),
      },
      sights: [...p.sights],
    };
  }

  /** Somebody, on today's page: a new day starts them afresh. */
  private person(userId: string): Person | undefined {
    const p = this.people.get(userId);
    if (!p) return undefined;
    const day = parkDay(this.now());
    if (p.day !== day) { p.day = day; p.done.clear(); p.sights.clear(); p.said = 0; }
    return p;
  }

  private complete(userId: string, quest: ParkQuestId): Done[] {
    const p = this.person(userId);
    if (!p || p.done.has(quest)) return [];
    p.done.add(quest);
    return [{ userId, quest }];
  }
}
