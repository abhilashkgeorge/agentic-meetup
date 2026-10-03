/**
 * SETUP AS A CONVERSATION WITH YOUR CLONE: what it says, and what your answers read as.
 * Plain words and plain state, no React -- the screen is setup-chat.tsx.
 *
 * THE FOUNDER, 2026-10-04: "instead of the current onboarding flow, what if we delegate
 * it to the chat UI interface where the clone gets to learn about the user ... start
 * with a greeting message and then instead of next screen for each onboarding screen, it
 * is a message below the previous message where I answer. And within the chat UI, you
 * can show the elements, maps and all the other onboarding setup required." Setup was
 * ten screens -- one true thing, the interview's chips and cards, the essentials
 * wizard, stories, the character, photos -- each with its own Next.
 *
 * WHAT STAYS EXACTLY AS IT WAS: every answer is saved by the same call the old screen
 * made, and every one that decides who your agent can reach is TAPPED, never typed and
 * read by a model -- the chips, the two rows of a card, the age boxes, the map. What
 * the clone says here is written down below, not generated: setup costs no model call
 * it did not cost before (the one true thing and the sentence are read as they were).
 *
 * The stages, in order. "Finish setup" (an agent that cannot go out yet) starts at the
 * questions and ends after the essentials, asking only what is missing.
 *
 *   tell        one true thing about you            POST /v1/tell
 *   judge       its first answer as you: is it you? /v1/selftest
 *   questions   the interview: basics, five cards, the sentence, a few chips
 *   essentials  name, birth year, who, ages, intent, city, part of town, the map
 *   stories     what your agent will have to talk about (any, or none)
 *   voice       how you write: one WhatsApp chat (the import screen, opened from the chat)
 *   character   how you look in the square (the builder, opened from the chat)
 *   photos      a few photos (the photo screen, opened from the chat)
 *   done        into the town, and how to keep it up to date
 */
import type { Field } from '../profile/fields';
import type { InterviewQuestion, TellResult, WhoFine } from '../../lib/api';

export type Stage = 'tell' | 'judge' | 'questions' | 'essentials' | 'stories' | 'voice' | 'character' | 'photos' | 'done';

/** One line of the conversation: the clone's, yours, or the app's own note. */
export interface Line { id: number; from: 'clone' | 'me' | 'note'; text: string }

/** The clone's hello, the first thing a new person reads. */
export const HELLO: readonly string[] = [
  "Hi! I'm your clone.",
  "I learn how you talk and what you want. Then I go and meet other people's clones for you, and when two of us think you'd get on, you both decide.",
  "Let's start with you. Tell me one true thing about yourself. Anything.",
];

/** Back in the middle of setup: what it already heard stands, and on with the questions. */
export const RESUME_HELLO: readonly string[] = [
  "Welcome back. Let's carry on where we were.",
];

/**
 * Back for "Finish setup", or for one thing -- your first name, your part of town. Not
 * "missing": somebody adding their name has not left anything undone.
 */
export const FINISH_HELLO: readonly string[] = [
  'Welcome back. Just what is still open, and you are done.',
];

/** Tappable first lines: a blank box is where setup dies. */
export const TELL_EXAMPLES: readonly string[] = [
  'I live in Bangalore and I work at an ISP.',
  'I have two cats and I cannot cook.',
  'I moved cities in March and I am still finding my feet.',
];

/** What the clone says once it has read your one true thing. */
export function toldBack(r: TellResult): string[] {
  // What it heard, in your words -- not its labels ("interest: trekking. job title:
  // maths teacher", read on the Pixel, 2026-10-04, was the database talking).
  const heard = r.facts.slice(0, 3).map((f) => f.value).filter(Boolean);
  const out: string[] = [];
  if (heard.length) out.push(`Got it: ${heard.join(', ')}.`);
  else out.push('Got it.');
  if ((r.toConfirm ?? 0) > 0) out.push("I'll check a couple of things with you as we go.");
  return out;
}

/** Before its first answer as you. */
export const SAMPLE_INTRO = "Here's how I'd answer someone already, as you:";
/** After "That's me" or "Not even close". */
export const SAMPLE_THANKS: Record<'me' | 'not_me', string> = {
  me: 'Good. It gets better the more we talk.',
  not_me: "Fair. I know one thing about you so far. It gets better fast.",
};
/** Into the questions. */
export const QUESTIONS_INTRO = 'Now a few quick questions, one at a time. Some are about you, and some about who you would be fine with.';

/**
 * What the clone asks for an interview question: the question itself. A card's short
 * title said first doubled it ("One person or open. One person, or open?").
 */
export function askQuestion(q: InterviewQuestion): string[] {
  return q.why ? [q.text, q.why] : [q.text];
}

/** The answer bubble for chips: their words, in the order shown. Nothing picked is a skip. */
export function pickedWords(options: readonly { value: string; label: string }[], values: readonly string[]): string {
  const words = options.filter((o) => values.includes(o.value)).map((o) => o.label);
  return words.length ? words.join(', ') : 'Skip';
}

/** The answer bubble for a core card: both rows, in words. */
export function cardWords(
  q: Pick<InterviewQuestion, 'options' | 'whoFine'>,
  answer: { values: string[]; whoFine: WhoFine },
): string {
  const me = answer.values.length ? pickedWords(q.options, answer.values) : 'Prefer not to say';
  const fine = q.whoFine?.options ?? q.options;
  const them = 'anyone' in answer.whoFine ? 'Anyone' : pickedWords(fine, answer.whoFine.only);
  return `Me: ${me}. Them: ${them}.`;
}

/** What the clone asks for one of the essentials. */
export function askField(f: Pick<Field, 'title' | 'hint'>): string[] {
  return f.hint ? [f.title, f.hint] : [f.title];
}

/** Into the essentials, once the questions are over. */
export const ESSENTIALS_INTRO = 'Thanks. Now the basics I need to go out for you.';

/** The answer bubble for one of the essentials. */
export function fieldWords(
  f: Pick<Field, 'kind' | 'options'>,
  value: string | string[] | { min: number; max: number } | null,
): string {
  if (value === null) return 'Prefer not to say';
  if (f.kind === 'range' && typeof value === 'object' && !Array.isArray(value)) return `${value.min} to ${value.max}`;
  if ((f.kind === 'one' || f.kind === 'many') && f.options) {
    return pickedWords(f.options, Array.isArray(value) ? value : [String(value)]);
  }
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** The answer bubble for the distance map. */
export function distanceWords(c: { anywhere: boolean; km: number; spot: { name: string } | null }): string {
  const how = c.anywhere ? 'Anywhere' : `Within ${c.km} km`;
  return c.spot ? `${c.spot.name}. ${how}.` : `${how}.`;
}

/** Into the stories, and how many to offer before moving on. */
export const STORIES_INTRO = "That's enough for me to go out for you. Now, if you like, a few stories: they are what I'll have to talk about.";
export const STORIES_MAX = 3;
/**
 * How you write: one WhatsApp chat, read on the phone, only your side sent. It was a
 * screen of the old setup, and the first version of the chat left it out -- with no
 * other way in (found on the Pixel, 2026-10-04).
 */
export const VOICE_ASK: readonly string[] = [
  'Want me to sound like you, not just know about you?',
  'Share one WhatsApp chat with a friend. Only your side is read, and only a note of how you write is kept.',
];
/** The character, then the photos: both opened from the chat. */
export const CHARACTER_ASK = 'Now how you look in the town. This is you in the square, and all anyone sees of you until you share your profile with them.';
export const PHOTOS_ASK = 'Last thing: a few photos. Nobody sees them until you both say yes to each other.';

/** The end: what happens now, and how to keep the clone up to date. */
export function doneLines(name: string | null): string[] {
  return [
    `All set${name ? `, ${name}` : ''}. I'll go out and meet people for you.`,
    'Talk to me any time from the town (tap "Your clone"). Tell me what is new in your life, or what you want me to look for. I learn from every line, and nothing I learn is shared until you say so.',
  ];
}
/** The end of "Finish setup". */
export const FINISH_DONE = "That's everything. Thank you.";

/** What a failed save says, in the chat. The answer stays where it was. */
export const DID_NOT_SAVE = 'That did not save. Check your connection and try again.';

/**
 * The stage after this one. `finish` -- an agent that cannot go out yet, sent back by
 * "Finish setup" -- asks only the questions and the essentials, then ends.
 */
export function stageAfter(stage: Stage, finish: boolean): Stage {
  switch (stage) {
    case 'tell': return 'questions';
    case 'judge': return 'questions';
    case 'questions': return 'essentials';
    case 'essentials': return finish ? 'done' : 'stories';
    case 'stories': return 'voice';
    case 'voice': return 'character';
    case 'character': return 'photos';
    case 'photos': return 'done';
    case 'done': return 'done';
  }
}

/** Where the conversation starts. */
export const firstStage = (finish: boolean): Stage => (finish ? 'questions' : 'tell');
