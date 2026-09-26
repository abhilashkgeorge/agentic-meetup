/**
 * Ticking which answers are fine for one want. Plain state, so the rules can be tested
 * without a phone.
 *
 * NOTHING ARRIVES TICKED for a want not yet tied to its question (the same rule as the
 * core cards' partner row: a box that comes ticked is the answer most people give). A
 * want already tied opens on what it holds. Save needs one tick; every answer ticked is
 * allowed but says plainly that it is no rule -- a list that accepts everybody.
 */
export interface WantQuestionView {
  id: string; text: string; topic: string | null;
  options: { value: string; label: string }[]; multi: boolean;
}
export interface WantView {
  text: string; kind: 'wants' | 'not'; private: boolean;
  question: WantQuestionView | null;
  accepted: string[] | null;
  rule: { id: string; strength: string } | null;
}

/** What the want's box opens on. */
export const startTicks = (w: WantView): string[] => w.accepted ?? [];

/** One tap on an answer: ticked or unticked, kept in the question's own order. */
export function toggleTick(ticks: readonly string[], value: string, options: readonly { value: string }[]): string[] {
  const next = ticks.includes(value) ? ticks.filter((v) => v !== value) : [...ticks, value];
  return options.map((o) => o.value).filter((v) => next.includes(v));
}

export const canSave = (ticks: readonly string[]): boolean => ticks.length > 0;

/** Every answer ticked: allowed, and said -- it rules nobody out and ranks nobody. */
export const acceptsEverybody = (ticks: readonly string[], options: readonly { value: string }[]): boolean =>
  options.length > 0 && options.every((o) => ticks.includes(o.value));

/** The one line under a want, by what it is checked against. */
export function wantLine(w: WantView): string {
  if (w.private) return 'Checked against your card. Nobody sees your answer.';
  if (!w.question) return 'Checked against what people write. It can only move people down, never hide them.';
  return w.accepted
    ? 'Checked against their answer to this question.'
    : 'We can ask people this. Tick the answers that are fine for you.';
}
