/**
 * What was typed in the park, kept ten minutes and only for a report (the founder,
 * 2026-09-29: "keep park typed messages for 10 minutes, used only for reports").
 *
 * Park lines were relayed and kept nowhere, so a report about something typed in the park
 * carried nobody's words but the reporter's own note. Now each line is held here -- in
 * this process's memory, never the database, never a log -- with who said it and who was
 * sent it, for ten minutes. One thing reads it: a park report (api/park.ts), which copies
 * the lines between the two people, both ways, into the report's evidence
 * (report_messages, 0080; keep_park_lines, 0084). A restart forgets everything.
 */
export const LINES_KEEP_MS = 10 * 60_000;
/** A ceiling whatever the traffic; the oldest go first. */
export const MAX_LINES = 5_000;

export interface ParkLine { at: number; speaker: string; hearers: readonly string[]; text: string }

export class ParkLines {
  private lines: ParkLine[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** A line said in the park, and who was sent it (never the speaker). */
  said(speaker: string, hearers: readonly string[], text: string): void {
    this.forgetOld();
    this.lines.push({ at: this.now(), speaker, hearers: hearers.filter((h) => h !== speaker), text });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  /** What these two said to each other in the last ten minutes, oldest first. */
  between(a: string, b: string): ParkLine[] {
    this.forgetOld();
    return this.lines.filter((l) =>
      (l.speaker === a && l.hearers.includes(b)) || (l.speaker === b && l.hearers.includes(a)));
  }

  /** Everything older than ten minutes, gone. Also run on the park's own timer. */
  forgetOld(): void {
    const cut = this.now() - LINES_KEEP_MS;
    let old = 0;
    while (old < this.lines.length && this.lines[old]!.at < cut) old++;
    if (old) this.lines.splice(0, old);
  }

  get size(): number { return this.lines.length; }
}
