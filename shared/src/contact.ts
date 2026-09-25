/**
 * Contact details in a sentence, found by code.
 *
 * WHY (the founder, 2026-09-25). A sentence a person typed reaches somebody else three
 * ways -- quoted on a card, given by their agent as an answer, said in the agents' talk
 * -- and all three read through one door (server brief.ts loadQuotes). A phone number,
 * an email, an @handle, a link or a street address in one of those sentences would go
 * to a stranger before either person has said yes. The rule: people swap those
 * themselves, in chat, after both say yes. So a sentence holding any of them is never
 * repeated to anybody -- and that is decided here, by pattern, not by asking a model.
 *
 * WHEN UNSURE, BLOCK. A false alarm costs one sentence not being quoted; a miss can cost
 * somebody their safety. So the patterns lean wide -- any run of eight or more digits
 * counts as a phone number, whatever it really was ("2019 2020" included).
 *
 * WHAT IT DOES NOT CATCH: a company or building named in words ("I work at Flipkart",
 * "Prestige Shantiniketan"). Nothing short of a list of every name can; the person sees
 * every sentence that can be repeated on "How you appear", with a Hide on each.
 */

export type ContactKind = 'phone' | 'email' | 'handle' | 'link' | 'invite' | 'address';

const PLATFORM =
  '(?:insta(?:gram)?|ig|snap(?:chat)?|telegram|whats\\s?app|twitter|linked\\s?in|facebook|fb|discord|signal|threads)';
const ID = '(?:id|handle|username|user\\s?name|number|no\\.?)';
const DIGIT_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)';

/** Eight or more digits in one run, whatever the separators between the groups. */
function phoneLike(text: string): boolean {
  const runs = text.match(/[+(]?\d[\d\s().\-–]{6,}\d/g) ?? [];
  if (runs.some((r) => r.replace(/\D/g, '').length >= 8)) return true;
  // Spelled out, a digit at a time: "nine eight four five zero ..."
  return new RegExp(`\\b(?:${DIGIT_WORD}[\\s,.-]+){6,}${DIGIT_WORD}\\b`, 'i').test(text);
}

const PATTERNS: ReadonlyArray<readonly [ContactKind, RegExp]> = [
  ['email', /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i],
  // "priya at gmail dot com", "priya [at] gmail [dot] com"
  ['email', /\b[a-z0-9._%+-]+\s*(?:\(at\)|\[at\]|\{at\}|\bat\b)\s*[a-z0-9-]+\s*(?:\(dot\)|\[dot\]|\{dot\}|\bdot\b)\s*[a-z]{2,}\b/i],
  // An @ that is not inside an email: "@priya_k"
  ['handle', /(?:^|[^a-z0-9._%+-])@[a-z0-9_.]{2,}/i],
  // "insta: priya.k", "ig - priya_92", "snapchat = priyak"
  ['handle', new RegExp(`\\b${PLATFORM}\\b\\s*${ID}?\\s*[:=\\-–]\\s*@?[a-z0-9._]{3,}`, 'i')],
  // "my insta is priya", "my whatsapp number is ..."
  ['handle', new RegExp(`\\bmy\\s+${PLATFORM}\\b\\s*${ID}?\\s*(?:is\\b|[:=\\-–])\\s*@?[a-z0-9._+]{3,}`, 'i')],
  // "ig handle priya_k", "insta id is priya"
  ['handle', new RegExp(`\\b${PLATFORM}\\b\\s*(?:id|handle|username|user\\s?name)\\s*(?:is\\b)?\\s*@?[a-z0-9._]{3,}`, 'i')],
  ['link', /\bhttps?:\/\/\S+/i],
  ['link', /\bwww\.\S+/i],
  ['link', /\b(?:t|wa)\.me\/\S+/i],
  ['link', /\b[a-z0-9-]+\.(?:com|in|co|io|me|org|net|app|ly|ee|gg|to|tv|xyz|link|bio|page)\b(?:\/\S*)?/i],
  // An invitation off the app, before anybody has said yes: "dm me on insta", "find me on snapchat"
  ['invite', new RegExp(`\\b(?:dm|text|message|msg|ping|call|ring|find|add|follow|hit)\\s+(?:me|us)\\s+(?:up\\s+)?(?:on|at|via)\\s+${PLATFORM}\\b`, 'i')],
  // Street-level places: "12th Main", "3rd Cross", "5th Block", "80 feet road", "flat 302", "#42,"
  ['address', /\b\d{1,3}(?:st|nd|rd|th)\s+(?:main|cross|block|stage|phase|sector|avenue|street|road|floor)\b/i],
  ['address', /\b\d{2,3}\s*(?:ft|feet)\s+road\b/i],
  ['address', /\b(?:flat|house|door|plot|apt|apartment|villa|room)\s*(?:no\.?|number|#)?\s*\d{1,5}\b/i],
  ['address', /#\s?\d{1,5}\s*[,/-]/],
  ['address', /\b(?:pin|pincode|pin code|zip)\s*[:\-]?\s*\d{5,6}\b/i],
  ['address', /\b56\d{4}\b/],
];

/** The first kind of contact detail in the sentence, or null when there is none. */
export function contactDetail(text: string): ContactKind | null {
  if (phoneLike(text)) return 'phone';
  for (const [kind, re] of PATTERNS) if (re.test(text)) return kind;
  return null;
}
