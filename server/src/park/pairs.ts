/**
 * Two people in the park who have agreed to talk: who asked whom, who said yes, and who
 * is sitting on which bench.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-29): "a button to find a partner, which matches
 * based on interest ... when matched with a partner make sure to ask the other partner
 * if they are free to talk and make sure they are not talking with anyone else ... an
 * option to chat privately: they both walk to a nearby bench, sit and start talking.
 * The conversation should be private, and people other than them, even if close,
 * proximity chat shouldn't work."
 *
 * THE RULES, all here:
 *   - Nobody is asked while they are busy: already talking with somebody, asking
 *     somebody, or being asked. One invitation at a time, each way.
 *   - An invitation stands ASK_MS; unanswered, it lapses for both.
 *   - Somebody who said no is not asked by the same person again for DECLINED_MS.
 *   - Yes pairs them. Either can end it; walking out of the park ends it too.
 *   - A pair may sit on one bench, which is then theirs alone; while they sit, what they
 *     say goes to each other and nobody else, and nothing said near them reaches them.
 *
 * PURE, like room.ts: the socket asks and delivers (park/socket.ts). Tested on its own
 * in tests/park-pairs.test.ts.
 */

/** How long an invitation stands before it lapses. */
export const ASK_MS = 30_000;
/** How long before somebody who said no is asked again by the same person. */
export const DECLINED_MS = 10 * 60_000;

interface Ask { from: string; to: string; until: number }

export class ParkPairs {
  /** By who asked. */
  private readonly asks = new Map<string, Ask>();
  /** Who is being asked, by whom. */
  private readonly askedBy = new Map<string, string>();
  private readonly partners = new Map<string, string>();
  /** "from|to" -> when `from` may ask `to` again. */
  private readonly declined = new Map<string, number>();
  /** Bench -> the two sitting on it; person -> their bench. */
  private readonly benches = new Map<number, [string, string]>();
  private readonly seat = new Map<string, number>();
  /** Of each pair, the one who asked: their side of the bench, and whether they flew over. */
  private readonly askers = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  busy(userId: string): boolean {
    return this.partners.has(userId) || this.asks.has(userId) || this.askedBy.has(userId);
  }

  partnerOf(userId: string): string | null {
    return this.partners.get(userId) ?? null;
  }

  /** Sitting on a bench with their partner: private, both ways. */
  benchOf(userId: string): number | null {
    return this.seat.get(userId) ?? null;
  }

  isBenchTaken(bench: number): boolean {
    return this.benches.has(bench);
  }

  /** Whether `from` may ask `to` now. */
  mayAsk(from: string, to: string): boolean {
    if (from === to || this.busy(from) || this.busy(to)) return false;
    const until = this.declined.get(`${from}|${to}`);
    return until === undefined || until <= this.now();
  }

  ask(from: string, to: string): boolean {
    if (!this.mayAsk(from, to)) return false;
    this.asks.set(from, { from, to, until: this.now() + ASK_MS });
    this.askedBy.set(to, from);
    return true;
  }

  /** `to` answers. Returns who asked them, or null if nobody is asking any more. */
  answer(to: string, yes: boolean): string | null {
    const from = this.askedBy.get(to);
    if (!from) return null;
    this.askedBy.delete(to);
    this.asks.delete(from);
    if (yes) {
      this.partners.set(from, to);
      this.partners.set(to, from);
      this.askers.add(from);
    } else {
      this.declined.set(`${from}|${to}`, this.now() + DECLINED_MS);
    }
    return from;
  }

  /** Whether they were the one who asked, of the pair they are in. */
  didAsk(userId: string): boolean {
    return this.askers.has(userId) && this.partners.has(userId);
  }

  /** Who `from` is asking now, if anybody. */
  asking(from: string): string | null {
    return this.asks.get(from)?.to ?? null;
  }

  /** `from` stops asking. Returns who they were asking. */
  withdraw(from: string): string | null {
    const a = this.asks.get(from);
    if (!a) return null;
    this.asks.delete(from);
    this.askedBy.delete(a.to);
    return a.to;
  }

  /** Invitations past their time, now lapsed: both sides are told. */
  expire(): { from: string; to: string }[] {
    const now = this.now();
    const gone: { from: string; to: string }[] = [];
    for (const a of this.asks.values()) if (a.until <= now) gone.push({ from: a.from, to: a.to });
    for (const { from, to } of gone) { this.asks.delete(from); this.askedBy.delete(to); }
    for (const [k, until] of this.declined) if (until <= now) this.declined.delete(k);
    return gone;
  }

  /** End a pair (and their bench). Returns the partner, who is told. */
  part(userId: string): string | null {
    const other = this.partners.get(userId);
    if (!other) return null;
    this.stand(userId);
    this.partners.delete(userId);
    this.partners.delete(other);
    this.askers.delete(userId);
    this.askers.delete(other);
    return other;
  }

  /**
   * The pair takes a bench. It must be free (or theirs already). Returns the partner, or
   * null if they are not paired or the bench is somebody else's.
   */
  sit(userId: string, bench: number): string | null {
    const other = this.partners.get(userId);
    if (!other || !Number.isInteger(bench) || bench < 0) return null;
    const on = this.benches.get(bench);
    if (on && !(on.includes(userId) && on.includes(other))) return null;
    this.stand(userId);
    this.benches.set(bench, [userId, other]);
    this.seat.set(userId, bench);
    this.seat.set(other, bench);
    return other;
  }

  /** Up off the bench: public again, still together. Returns the partner if they sat. */
  stand(userId: string): string | null {
    const bench = this.seat.get(userId);
    if (bench === undefined) return null;
    const pair = this.benches.get(bench);
    this.benches.delete(bench);
    for (const u of pair ?? [userId]) this.seat.delete(u);
    return this.partners.get(userId) ?? null;
  }

  /**
   * Somebody walks out of the park. Everything of theirs ends, and returns who has to
   * be told what: their partner (parted), whoever they were asking (unasked), whoever
   * was asking them (their search goes on).
   */
  leave(userId: string): { partner: string | null; wasAsking: string | null; wasAskedBy: string | null } {
    const partner = this.part(userId);
    const wasAsking = this.withdraw(userId);
    const wasAskedBy = this.askedBy.get(userId) ?? null;
    if (wasAskedBy) { this.askedBy.delete(userId); this.asks.delete(wasAskedBy); }
    return { partner, wasAsking, wasAskedBy };
  }
}
