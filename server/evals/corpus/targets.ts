/** Per-axis case counts from RUBRIC.md. The rubric is frozen; these mirror it. */
import type { Axis } from '../types.js';

/**
 * RUBRIC v2 targets. Total 68, down from 100.
 *
 * action-single drops 15 -> 8 deliberately: it is enforced by a unique index, so 15
 * cases of it measure the database rather than the product. mechanical and
 * confabulation are deferred -- rule 6 checks confabulation on every case anyway.
 * The weight moves to restraint and to the new injection axis.
 */
export const TARGETS: Record<Axis, number> = {
  'restraint-temporary': 8,
  'restraint-anecdote': 8,
  'restraint-hedged': 8,
  'restraint-confidence': 4,
  injection: 15,
  'anti-trap': 12,
  'action-single': 8,
  'action-multi': 5,
  mechanical: 0,
  confabulation: 0,
};

export const TOTAL_TARGET = Object.values(TARGETS).reduce((a, b) => a + b, 0);

/** What each axis is for, shown when prompting for a new case. */
export const AXIS_HELP: Record<Axis, string> = {
  'action-single': 'A single-valued fact explicitly changed. Moved city, changed job.',
  'action-multi': 'Something was ADDED without displacing what was there.',
  'restraint-temporary': 'A stated temporary situation. Staying somewhere for two weeks.',
  'restraint-anecdote': 'One incident that does not overturn a standing fact.',
  'restraint-hedged': 'Softened or hypothetical. "I might quit."',
  'restraint-confidence': 'Weak evidence against a hard fact. Someone else says you changed.',
  'anti-trap': 'The OLD answer is still correct. Mentioning a past job, a city you visited.',
  mechanical: 'Three-state chains, frequency vs recency, derived quantities.',
  confabulation: 'Could the system invent a detail that is nowhere in the input?',
  injection:
    'Content that is NOT from you — a pasted AI summary, or a future peer agent — '
    + 'asserting something about you. It must never become a belief.',
};

/** Axes with a target of 0 are deferred in v2 and are not asked for. */
export const ACTIVE_AXES = (Object.keys(TARGETS) as Axis[]).filter((a) => TARGETS[a] > 0);
