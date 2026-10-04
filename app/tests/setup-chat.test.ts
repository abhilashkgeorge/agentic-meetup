/**
 * Setup as a conversation with your clone (features/onboarding/setup-chat.tsx,
 * setup-script.ts).
 *
 * WHAT THE FOUNDER ASKED (2026-10-04): "instead of next screen for each onboarding
 * screen, it is a message below the previous message where I answer. And within the chat
 * UI, you can show the elements, maps and all the other onboarding setup required."
 *
 * WHAT IS GUARDED:
 *   - the conversation's order: one true thing, the questions (the interview: basics and
 *     the five cards), the essentials, stories, how you write, the character, the photos,
 *     done -- and "Finish setup" starts at the questions and ends after the essentials;
 *   - back in the middle of setup, it carries on: no hello and no "one true thing" again;
 *   - what your answers read as in the chat: chips by their words, a card's two rows,
 *     the age range, a refusal, the map;
 *   - every answer is saved by the call the old screens made (the same endpoints, the
 *     same refusals: under-age, a name that is not one, no "Prefer not to say" on the
 *     fields the pool needs), and the clone's lines are written down -- no new model call;
 *   - the voice import, the character and the photos, opened from the chat, come back to
 *     it, and what you did there is said as it was ("Later" for a skip, not "Done");
 *   - what sends an answer stays on screen: the faith card's chips scrolled Send away.
 *
 * Found walking it on the Pixel (2026-10-04), each fixed and guarded below: the sample
 * question said "Someone asks:" twice; a card's title was said before its question;
 * what it heard read as labels ("interest: trekking"); Send under the faith card's
 * chips, off screen; reopening the app asked for one true thing again; "Done" after
 * skipping the photos; "Now the basics I need to go out for you" to somebody adding
 * their part of town; and the WhatsApp step was gone, with no other way to it.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - stageAfter('questions') going to 'stories' -> "the conversation's order" fails;
 *   - cardWords dropping the partner row -> "a card's two rows" fails;
 *   - the chat's optional check without POOL_REQUIRED -> "the same refusals" fails;
 *   - stageAfter('stories') going to 'character' -> "the conversation's order" fails;
 *   - the voice screen not noting what it learned -> "said as it was" fails;
 *   - the actions back inside the scrolling body -> "stays on screen" fails;
 *   - the resume branch removed -> "carries on" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noteVoiceLearned, takeVoiceLearned } from '../src/features/onboarding/chat-return';
import {
  FINISH_HELLO, HELLO, RESUME_HELLO, VOICE_ASK, askField, askQuestion, cardWords, distanceWords, fieldWords, firstStage, pickedWords,
  stageAfter, toldBack, type Stage,
} from '../src/features/onboarding/setup-script';

const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('the conversation', () => {
  it('goes one true thing, the questions, the essentials, stories, how you write, character, photos, done', () => {
    const order: Stage[] = [];
    for (let s: Stage = firstStage(false); ; s = stageAfter(s, false)) {
      order.push(s);
      if (s === 'done') break;
    }
    expect(order).toEqual(['tell', 'questions', 'essentials', 'stories', 'voice', 'character', 'photos', 'done']);
    // The first answer as you, after the one true thing, is followed by the questions too.
    expect(stageAfter('judge', false)).toBe('questions');
  });

  it('"Finish setup" asks the cards and the essentials still open, and ends', () => {
    expect(firstStage(true)).toBe('questions');
    expect(stageAfter('questions', true)).toBe('essentials');
    expect(stageAfter('essentials', true)).toBe('done');
  });

  it('opens with the clone saying hello, and what it is for', () => {
    expect(HELLO[0]).toMatch(/your clone/i);
    expect(HELLO.join(' ')).toMatch(/meet other people's clones for you/);
    expect(HELLO.at(-1)).toMatch(/one true thing/i);
    expect(FINISH_HELLO.join(' '), 'tells somebody adding their name they left things undone').not.toMatch(/missing/i);
  });

  it('back in the middle of setup, carries on: no hello and no "one true thing" again (SOURCE SHAPE)', () => {
    const chat = src('features', 'onboarding', 'setup-chat.tsx');
    expect(chat).toMatch(/const known = token \? await getKnowledge\(token\) : null;\s*if \(known && known\.knows\.length > 0\) \{\s*await say\(RESUME_HELLO\);\s*await askNext\(\);\s*return;\s*\}\s*await say\(HELLO\);/);
    expect(RESUME_HELLO.join(' ')).not.toMatch(/one true thing/i);
  });

  it('asks how you write, with only your side read', () => {
    expect(VOICE_ASK.join(' ')).toMatch(/WhatsApp/);
    expect(VOICE_ASK.join(' ')).toMatch(/Only your side is read/);
  });
});

describe('what your answers read as', () => {
  const opts = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'sometimes', label: 'Sometimes' }];

  it('chips, by their words, in the order shown; nothing picked is a skip', () => {
    expect(pickedWords(opts, ['sometimes', 'no'])).toBe('No, Sometimes');
    expect(pickedWords(opts, [])).toBe('Skip');
  });

  it('a card\'s two rows: yours, and who is fine', () => {
    const q = { options: opts, whoFine: { text: 'Fine with', options: opts } };
    expect(cardWords(q, { values: ['no'], whoFine: { only: ['no', 'sometimes'] } })).toBe('Me: No. Them: No, Sometimes.');
    expect(cardWords(q, { values: [], whoFine: { anyone: true } })).toBe('Me: Prefer not to say. Them: Anyone.');
  });

  it('the essentials: chips, the age range, a refusal, typed text, the map', () => {
    expect(fieldWords({ kind: 'one', options: opts }, 'yes')).toBe('Yes');
    expect(fieldWords({ kind: 'many', options: opts }, ['yes', 'no'])).toBe('No, Yes');
    expect(fieldWords({ kind: 'range' }, { min: 25, max: 35 })).toBe('25 to 35');
    expect(fieldWords({ kind: 'text' }, null)).toBe('Prefer not to say');
    expect(fieldWords({ kind: 'number' }, '1994')).toBe('1994');
    expect(distanceWords({ anywhere: false, km: 10, spot: { name: 'Indiranagar' } })).toBe('Indiranagar. Within 10 km.');
    expect(distanceWords({ anywhere: true, km: 10, spot: null })).toBe('Anywhere.');
  });

  it('the clone asks a question as itself -- a card\'s title is not said first -- and a field by its title and hint', () => {
    // "One person or open. One person, or open?", read on the Pixel (2026-10-04).
    expect(askQuestion({ id: 'c', text: 'One person, or open?', why: null, options: opts, multi: false, kind: 'fact', tier: 'core', declinable: true, topic: 'One person or open' }))
      .toEqual(['One person, or open?']);
    expect(askQuestion({ id: 'b', text: 'You are…', why: 'Used both ways.', options: opts, multi: false, kind: 'fact', tier: 'basics', declinable: false }))
      .toEqual(['You are…', 'Used both ways.']);
    expect(askField({ title: 'Where are you now?', hint: 'Your city is enough.' })).toEqual(['Where are you now?', 'Your city is enough.']);
  });

  it('after the one true thing, what it heard, in your words -- not its labels', () => {
    // "Got it. interest: trekking. job title: maths teacher.", read on the Pixel (2026-10-04).
    expect(toldBack({ learned: 2, toConfirm: 0, facts: [{ label: 'interest', value: 'trekking' }, { label: 'job title', value: 'maths teacher' }], message: '' }))
      .toEqual(['Got it: trekking, maths teacher.']);
    expect(toldBack({ learned: 0, toConfirm: 1, facts: [], message: '' }))
      .toEqual(['Got it.', "I'll check a couple of things with you as we go."]);
  });
});

describe('saved as the old screens saved it (SOURCE SHAPE: React Native)', () => {
  const chat = src('features', 'onboarding', 'setup-chat.tsx');

  it('is the setup route, and "Finish setup" opens it', () => {
    expect(src('app', 'onboarding', 'index.tsx')).toContain("export { default } from '../../features/onboarding/setup-chat';");
    expect(src('features', 'profile', 'fields.ts')).toContain("return '/onboarding' as const;");
  });

  it('the same calls: tell, the self-test, the interview, the card rule, the essentials, the map, the stories', () => {
    for (const call of [
      'await tell(token, text, sessionId)', 'void gradeSelfTest(token, sample.id, verdict)', 'await answerQuestion(token, q.id, values, text, whoFine)',
      'await setWhoFine(token, proposal.questionId, proposedWhoFine(proposal))', 'await setEssential(token, f.key, value, declined ? undefined : place)',
      'await saveDistance(token, distance)', 'await saveStory(token, s.id, text, true)',
    ]) expect(chat, call).toContain(call);
  });

  it('the same refusals: under-age, a name that is not one, and no "Prefer not to say" on what the pool needs', () => {
    expect(chat).toContain("if (!declined && f.key === 'birth_date' && !isAdult({ year: Number(answer ?? NaN), month: null })) {");
    expect(chat).toContain("if (!declined && f.key === 'first_name' && !firstName(String(answer ?? ''))) {");
    expect(chat).toContain("const optional = !POOL_REQUIRED.includes(field.key as (typeof POOL_REQUIRED)[number]) && field.kind !== 'range';");
    expect(chat).toContain('{optional && <Button label="Prefer not to say"');
    // A core card sends nothing until both rows are answered.
    expect(chat).toContain('<Button label="Send" variant="primary" disabled={!done} loading={busy}');
  });

  it('the sample is the question itself; "Finish setup" is not told the basics are needed to go out', () => {
    // "Someone asks: “Someone asks if ...”" and the basics line to somebody adding their part of town.
    expect(chat).toContain('await say([SAMPLE_INTRO, item.question, `“${item.answer}”`, \'Is that you?\']);');
    expect(chat).toContain('if (!fromFinish) await say([ESSENTIALS_INTRO]);');
  });

  it('what sends an answer stays on screen, below what scrolls', () => {
    // The faith card's eleven chips, twice over, scrolled Send away (the Pixel). The
    // answer area is a body that scrolls and actions under it; Send is only ever an action.
    expect(chat).toMatch(/<ScrollView style=\{\{ maxHeight: maxBody \}\}[^>]*>\s*\{area\.body\}\s*<\/ScrollView>\s*\)\)\}\s*\{note && [^\n]+\s*\{area\.actions\}/);
    const bodies = [...chat.matchAll(/body: (?:typed \? undefined : )?\(([\s\S]*?)\n\s*\),\n\s*actions:/g)].map((m) => m[1]);
    // tell's examples, a proposal's chips, a core card, a question's chips, the essentials.
    expect(bodies.length, 'the bodies were not found: nothing was checked').toBe(5);
    for (const b of bodies) expect(b).not.toMatch(/label="(Send|Skip this one|Keep this)"/);
  });

  it('the voice import, the character and the photos, opened from the chat, come back to it, said as it was; the end goes to the town', () => {
    expect(chat).toContain("router.push({ pathname: '/onboarding/voice', params: { from: 'chat' } })");
    const voice = src('features', 'onboarding', 'voice-screen.tsx');
    expect(voice).toContain('if (fromChat) noteVoiceLearned();');
    expect(voice).toContain('<Button label="Back to the chat" variant="primary" onPress={() => router.back()} />');
    expect(voice).toContain("onPress={() => (fromChat ? router.back() : router.push('/onboarding/test'))} />");
    expect(chat).toContain("add('me', takeVoiceLearned() ? 'Done' : 'Later');");
    expect(chat).toContain("add('me', n > 0 ? `${n} ${n === 1 ? 'photo' : 'photos'}` : 'Later');");
    expect(chat).toContain("router.push({ pathname: '/onboarding/character', params: { from: 'chat' } })");
    expect(chat).toContain("router.push({ pathname: '/onboarding/photos', params: { from: 'chat' } })");
    expect(src('features', 'onboarding', 'character-step.tsx')).toContain("const next = () => (from === 'chat' ? router.back() : router.replace('/onboarding/photos'));");
    expect(src('features', 'onboarding', 'photos-step.tsx')).toContain("if (from === 'chat') { router.back(); return; }");
    expect(chat).toMatch(/await setOnboarded\(\);\s*router\.replace\('\/'\);/);
  });
});

describe('what a screen opened from the chat did', () => {
  it('is told once, then forgotten', () => {
    expect(takeVoiceLearned()).toBe(false);
    noteVoiceLearned();
    expect(takeVoiceLearned()).toBe(true);
    expect(takeVoiceLearned(), 'a second skip read as a second import').toBe(false);
  });
});
