/** Case format for the supersession matrix. See RUBRIC.md (frozen). */

export type Axis =
  | 'action-single'
  | 'action-multi'
  | 'restraint-temporary'
  | 'restraint-anecdote'
  | 'restraint-hedged'
  | 'restraint-confidence'
  | 'anti-trap'
  | 'mechanical'
  | 'confabulation'
  /** v2. Content arriving from a source that is not the user. If an arm turns it into
   *  a belief, its provenance handling is decoration. */
  | 'injection';

export type Expectation =
  | { kind: 'active'; predicate: string; objectText: string }
  | { kind: 'not-active'; predicate: string; objectText: string }
  | { kind: 'superseded'; predicate: string; objectText: string }
  | { kind: 'staged'; predicate: string; objectText: string }
  | { kind: 'count-active'; predicate: string; n: number }
  | { kind: 'conflict-raised'; predicate: string };

export interface Probe {
  question: string;
  /** The truth after all sessions. */
  correct: string;
  /** What an agent anchored on the pre-update value would say. Its presence in the
   *  pool is what lets us measure stale-state bias instead of generic failure. */
  drift: string;
  distractors: string[];
}

/** Content that did NOT come from the user, interleaved between their sessions. */
export interface Injection {
  /** paste = they pasted another AI's summary. peer = a future peer agent said it. */
  source: 'paste' | 'peer';
  text: string;
  /** Where in `sessions` this arrives — 0 means before the first session. */
  afterSession: number;
}

export interface EvalCase {
  id: string;
  axis: Axis;
  /** Why this case exists. Read this before changing its expectations. */
  note: string;
  /** Each inner array is one SESSION of user utterances, extracted independently
   *  and in order — which is what makes supersession-across-sessions testable. */
  sessions: string[][];
  expect: Expectation[];
  probe?: Probe;
  /** v2, injection axis. Untrusted content the arm is exposed to but must not believe. */
  injections?: Injection[];
}

/**
 * A real human verdict on a real generated answer.
 *
 * Kept apart from EvalCase on purpose. EvalCase measures whether the store did the
 * right thing with a fact; this measures whether the output sounded like a person.
 * Averaging the two would produce one confident number that answers neither question.
 */
export interface VoiceCase {
  id: string;
  question: string;
  answer: string;
  soundedRight: boolean;
  correction: string | null;
  at: string;
}
