/**
 * How strongly a rule counts. Plain, so it can be tested without a phone.
 *
 * "Must have" removes people; the others only move them up or down. A must-have is
 * offered only where it can hide somebody fairly: on an answer they TAPPED (the founder,
 * 2026-09-26; server questions.ts mustHaveAllowed). Elsewhere the rule says why not.
 */
import type { Preference } from '../../lib/api';

export const STRENGTHS = [
  { value: 'dealbreaker', label: 'Must have' },
  { value: 'strong', label: 'Really want' },
  { value: 'mild', label: 'Nice to have' },
] as const;

export const strengthsFor = (x: Pick<Preference, 'mustHave'>) =>
  STRENGTHS.filter((s) => s.value !== 'dealbreaker' || x.mustHave !== false);

export const NOT_A_MUST_HAVE =
  'Moves people up or down only: people also say this in chat, and a must-have only hides someone over an answer they tapped.';
