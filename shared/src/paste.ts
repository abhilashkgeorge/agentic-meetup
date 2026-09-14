/**
 * Paste-back import: the cold-start bootstrap.
 *
 * The user asks their existing AI assistant what it knows about them, and pastes the
 * answer here. This is the fastest known path from zero to a clone worth talking to --
 * the alternative is weeks of conversation before the agent knows anything.
 *
 * THREE CONSTRAINTS, all deliberate:
 *
 * 1. HUMAN COPY-PASTE ONLY. Never automate this -- no extension, no script, no API
 *    pull. Automating it would be programmatic extraction of another provider's
 *    output, which their terms prohibit. A person copying text is not extraction.
 *
 * 2. IT MUST DEGRADE. A competing assistant enumerating its stored memories is a
 *    prompt-level behaviour, not a contract; it can change without notice. The same
 *    endpoint therefore accepts plain self-description typed by the user, and the UI
 *    must offer that as a first-class alternative rather than a fallback.
 *
 * 3. EXPECT MEDIOCRE INPUT. Assistants describe people in flattering, generalised
 *    prose. Anthropic's own import documentation calls the feature experimental and
 *    warns that memories may not be incorporated successfully. Everything arriving
 *    this way is therefore recorded as REPORTED and UNTRUSTED, and is promoted only
 *    when the user confirms it in conversation.
 */

/** Where the pasted text came from. Recorded per fact, because provenance decides trust. */
export type PasteSource = 'assistant' | 'self';

/**
 * What the user copies into their assistant. Kept deliberately close to the wording
 * the assistant vendors publish themselves for their own export flows -- asking a
 * model to enumerate what it has stored about the person speaking to it is the
 * documented, sanctioned use.
 */
export const PASTE_BACK_PROMPT = `I am setting up a personal AI that acts on my behalf. Tell it everything you know about me.

Go through these, and skip any you genuinely have nothing for. Do not pad.

1. NAME AND BASICS — what I go by, where I live, where I am from, languages I speak.
2. WORK — employer, role, what I actually do day to day, how long, what I did before.
3. PEOPLE — partner, family, close friends, pets. Names only if I told you them.
4. CONSTRAINTS — allergies, health things, diet, anything I avoid, times I cannot do things.
5. INTERESTS — what I am into, what I have been reading, watching, playing, building.
6. VALUES AND OPINIONS — what I care about, what annoys me, positions I have taken.
7. GOALS — what I am working towards, decisions I am weighing, things I keep putting off.
8. HISTORY — things that used to be true about me but are not any more, and roughly when they changed.
9. HOW I COMMUNICATE — how I write to you, how blunt or formal I am, what I never say.

Rules:

Be specific. "Works at Acme as a staff engineer since March 2024" is useful. "Works in tech" is not.

Use my own words where you remember them.

Only put something in the list above if I actually told you it. Inline hedges do not help me — "you're married, though you never said so directly" reads as a fact to anything parsing this.

Everything you are guessing at goes in a separate section at the end, under the exact heading THINGS I AM NOT SURE ABOUT, written as questions for me to answer:

THINGS I AM NOT SURE ABOUT
- Are you married?
- Do you still work at Acme?

If you have very little stored about me, say so plainly instead of inventing a plausible profile.

Put the whole thing in one code block so I can copy it.`;

/** Shown when the user has no assistant, or the assistant refuses. Not a lesser path. */
export const SELF_DESCRIBE_PROMPT = `Tell me about yourself — work, where you live, who matters to you, what you are into, anything you would want a version of yourself to know.

Write as much or as little as you like. You can always add more later.`;

export const PASTE_MAX_CHARS = 60_000;

/** Chat exports are long. Style needs volume, so this ceiling is higher. */
export const CHAT_MAX_CHARS = 400_000;

/**
 * Which chat to export, and why it matters.
 *
 * The goal is how the person actually talks to ANOTHER HUMAN -- not how they talk to
 * an assistant, which is a different and more clipped register. So: a friend, not a
 * boss, not a group, and long enough to show a range of moods.
 */
export const CHAT_EXPORT_GUIDE = {
  who: 'Pick a friend you talk to normally. Not your boss, not a group chat.',
  why: 'Your clone learns how you actually sound — your words, your length, your habits.',
  how: [
    'Open the chat in WhatsApp',
    'Tap the name at the top',
    'Scroll down, tap Export chat',
    'Choose Without media',
    'Send it to yourself, then paste the text here',
  ],
  privacy:
    'We keep only YOUR messages. The other person\'s lines are used to work out the '
    + 'back-and-forth, then thrown away — never stored, never shown to anyone.',
} as const;

/**
 * The exact response of GET /v1/import/prompt.
 *
 * Declared HERE so both sides use one definition. The app previously re-declared it
 * by hand over an untyped `res.json()`, said `chatGuide: string`, and rendered the
 * object -- which React refuses as a child, so the screen died. A hand-written
 * interface over parsed JSON is an assertion about a server, not a check of one; the
 * compiler can only help if both ends read the same declaration.
 */
export interface ImportPromptsResponse {
  assistantPrompt: string;
  selfPrompt: string;
  maxChars: number;
  note: string;
  chatGuide: typeof CHAT_EXPORT_GUIDE;
  chatMaxChars: number;
}
