/**
 * The after-date check-in as a small machine, with no screen attached.
 *
 * Questions in the server's order, one at a time, none skippable; then "did you feel
 * safe"; on no, an offer to block or report; then "would you see them again"; then
 * done. The screen renders whatever `step` says and calls one of the transitions.
 * Pure, so tests/checkin-flow.test.ts can walk it with no renderer.
 */
export type Answer = 'yes' | 'no' | 'unsure';
export interface Question { key: string; text: string; identity: boolean }

export type Step =
  | { kind: 'question'; index: number }
  | { kind: 'safety' }
  | { kind: 'offer_report' }
  | { kind: 'again' }
  | { kind: 'done' };

export interface Flow {
  questions: Question[];
  answers: Record<string, Answer>;
  feltSafe: boolean | null;
  seeAgain: boolean | null;
  step: Step;
}

export const start = (questions: Question[]): Flow => ({
  questions, answers: {}, feltSafe: null, seeAgain: null,
  step: questions.length ? { kind: 'question', index: 0 } : { kind: 'safety' },
});

/** Answer the question on screen. Anything else on screen: no change. */
export function answer(f: Flow, value: Answer): Flow {
  if (f.step.kind !== 'question') return f;
  const q = f.questions[f.step.index];
  if (!q) return f;
  const answers = { ...f.answers, [q.key]: value };
  const next = f.step.index + 1;
  return { ...f, answers, step: next < f.questions.length ? { kind: 'question', index: next } : { kind: 'safety' } };
}

export function safety(f: Flow, safe: boolean): Flow {
  if (f.step.kind !== 'safety') return f;
  return { ...f, feltSafe: safe, step: safe ? { kind: 'again' } : { kind: 'offer_report' } };
}

/** The report offer was taken or declined; either way the check-in goes on. */
export function pastReportOffer(f: Flow): Flow {
  if (f.step.kind !== 'offer_report') return f;
  return { ...f, step: { kind: 'again' } };
}

export function again(f: Flow, value: boolean | null): Flow {
  if (f.step.kind !== 'again') return f;
  return { ...f, seeAgain: value, step: { kind: 'done' } };
}

/** What is sent, once, at the end. Null until every identity question is answered. */
export function submission(f: Flow): { answers: Record<string, Answer>; feltSafe: boolean; seeAgain: boolean | null } | null {
  if (f.step.kind !== 'done' || f.feltSafe === null) return null;
  for (const q of f.questions) if (q.identity && !(q.key in f.answers)) return null;
  return { answers: f.answers, feltSafe: f.feltSafe, seeAgain: f.seeAgain };
}

/** How many steps remain, for the thin progress strip. */
export function stepsLeft(f: Flow): { left: number; total: number } {
  const total = f.questions.length + 2;   // + safety + again
  const done = f.step.kind === 'question' ? f.step.index
    : f.step.kind === 'safety' || f.step.kind === 'offer_report' ? f.questions.length
    : f.step.kind === 'again' ? f.questions.length + 1
    : total;
  return { left: total - done, total };
}
