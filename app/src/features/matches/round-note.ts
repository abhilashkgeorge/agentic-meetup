/**
 * Why a round met nobody, in words for the person (the town and Matches).
 *
 * The server says why in its own short phrases (matching/orchestrator.ts `stop`), and the
 * app used to show them as they came: "nobody fits what you have asked for", lowercase and
 * without a full stop, under a card saying "That is not because of anything you asked for"
 * -- both on one screen (the Pixel, 2026-10-02, a test woman here for something casual and
 * the only man on the app here for something long-term).
 */
const WORDS: Readonly<Record<string, string>> = {
  'nobody fits what you have asked for': 'Nobody on the app fits what you asked for yet.',
  'agent is not ready to go out yet': 'Your agent is not ready to go out yet.',
  'they are not someone your agent can meet': 'Your agent cannot meet them.',
  'your agent has already met them': 'Your agent has already met them.',
  'already met': 'Your agent has already met them.',
  'your agent has already met everyone who fits': 'Your agent has already met everyone who fits.',
  'they have met a lot of people this week': 'They have met a lot of people this week. Try again next week.',
  'everyone who fits has met a lot of people this week':
    'Everyone who fits has met a lot of people this week. Try again next week.',
  'no profile': 'Finish setting up first.',
};

/** The server's reason as a sentence: known ones reworded, any other at least capitalised and ended. */
export function roundNote(raw: string): string {
  const said = raw.trim();
  const known = WORDS[said.toLowerCase()];
  if (known) return known;
  if (!said) return 'Your agent met nobody this time.';
  const sentence = said[0]!.toUpperCase() + said.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
