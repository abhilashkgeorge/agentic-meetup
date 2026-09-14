/**
 * SEED CORPUS — scaffolding, not the real thing.
 *
 * The rubric is explicit: sixty cases from the founder's own life beat six hundred
 * generated ones, and only real ones carry real ASR output. These exist so the
 * harness runs today and so the format is obvious. Replace and extend them with
 * acted-out scenarios from weeks 1-2 of dogfooding.
 *
 * Target counts per axis are in RUBRIC.md. This file is well short of them on
 * purpose — a full synthetic matrix would produce a confident, meaningless number.
 */
import type { EvalCase } from '../types.js';

export const SEED_CASES: EvalCase[] = [
  // ── action-single: the core claim ────────────────────────────────────────
  {
    id: 'act-single-city',
    axis: 'action-single',
    note: 'The canonical case. An explicit move must retire the old city.',
    sessions: [['I live in London, been here about six years.'], ["I've moved to Berlin — the move finally happened last week."]],
    expect: [
      { kind: 'active', predicate: 'lives_in', objectText: 'Berlin' },
      { kind: 'superseded', predicate: 'lives_in', objectText: 'London' },
      { kind: 'count-active', predicate: 'lives_in', n: 1 },
    ],
    probe: {
      question: 'Where do I live?',
      correct: 'Berlin',
      drift: 'London',
      distractors: ['Paris', 'Amsterdam'],
    },
  },
  {
    id: 'act-single-employer',
    axis: 'action-single',
    note: 'mem0 #4956 verbatim: "I work at A" / "I now work at B" / both coexist.',
    sessions: [['I work at Acme, been there two years.'], ['I left Acme. I work at Globex now.']],
    expect: [
      { kind: 'active', predicate: 'works_at', objectText: 'Globex' },
      { kind: 'count-active', predicate: 'works_at', n: 1 },
    ],
    probe: { question: 'Where do I work?', correct: 'Globex', drift: 'Acme', distractors: ['Initech'] },
  },
  {
    id: 'act-single-relationship',
    axis: 'action-single',
    note: 'The field a matchmaking product cannot get wrong.',
    sessions: [["I've been with my partner about three years."], ['We broke up last month. I\'m single now.']],
    expect: [{ kind: 'count-active', predicate: 'relationship_status', n: 1 }],
    probe: {
      question: 'Am I seeing anyone?',
      correct: 'single',
      drift: 'in a relationship',
      distractors: ['married'],
    },
  },

  // ── action-multi: adding without displacing ──────────────────────────────
  {
    id: 'act-multi-interest',
    axis: 'action-multi',
    note: 'A new interest must ADD, not replace. Multi-valued predicates coexist.',
    sessions: [['I got really into bouldering this year.'], ["I've started doing film photography too."]],
    expect: [
      { kind: 'active', predicate: 'interest', objectText: 'bouldering' },
      { kind: 'count-active', predicate: 'interest', n: 2 },
    ],
  },
  {
    id: 'act-multi-language',
    axis: 'action-multi',
    note: 'Learning a language does not unlearn the previous one.',
    sessions: [['I speak English and Hindi.'], ["I've been learning German since I moved."]],
    expect: [{ kind: 'active', predicate: 'languages', objectText: 'German' }],
  },

  // ── restraint-temporary ──────────────────────────────────────────────────
  {
    id: 'restraint-temp-sister',
    axis: 'restraint-temporary',
    note: 'The canonical trap. A stated temporary stay is not a change of residence.',
    sessions: [['I live in London.'], ["I'm staying at my sister's in Manchester for two weeks while my flat is redone."]],
    expect: [
      { kind: 'active', predicate: 'lives_in', objectText: 'London' },
      { kind: 'not-active', predicate: 'lives_in', objectText: 'Manchester' },
      { kind: 'count-active', predicate: 'lives_in', n: 1 },
    ],
    probe: { question: 'Where do I live?', correct: 'London', drift: 'Manchester', distractors: ['Leeds'] },
  },
  {
    id: 'restraint-temp-worktrip',
    axis: 'restraint-temporary',
    note: 'A work trip is not relocation, even when phrased in the present tense.',
    sessions: [['I live in Berlin.'], ["I'm in Tokyo this week for work."]],
    expect: [{ kind: 'active', predicate: 'lives_in', objectText: 'Berlin' }],
  },

  // ── restraint-anecdote ───────────────────────────────────────────────────
  {
    id: 'restraint-anecdote-allergy',
    axis: 'restraint-anecdote',
    note: 'Safety-critical. One anecdote must never retract a hard medical fact. '
      + 'Letta measured a real allergy being downgraded on anecdotal evidence.',
    sessions: [["I'm allergic to shellfish — it's serious, I carry an epipen."], ['Had a great prawn curry last night.']],
    expect: [
      { kind: 'active', predicate: 'allergy', objectText: 'shellfish' },
      { kind: 'conflict-raised', predicate: 'allergy' },
    ],
    probe: {
      question: 'Can I eat prawns?',
      correct: 'no — allergic to shellfish',
      drift: 'yes',
      distractors: ['only cooked ones'],
    },
  },
  {
    id: 'restraint-anecdote-diet',
    axis: 'restraint-anecdote',
    note: 'One lapse is not a change of diet.',
    sessions: [["I've been vegetarian for ten years."], ['I had a bite of my friend\'s steak at dinner, felt weird about it.']],
    expect: [{ kind: 'active', predicate: 'dietary_restriction', objectText: 'vegetarian' }],
  },

  // ── restraint-hedged ─────────────────────────────────────────────────────
  {
    id: 'restraint-hedge-quit',
    axis: 'restraint-hedged',
    note: 'The hedge must survive as stance, not be laundered into a standing fact. '
      + 'Two libraries laundered a hedged remark on 5/5 phrasings; a verbatim control did 0/5.',
    sessions: [['I work at Acme.'], ['I might quit and join Globex, still thinking about it.']],
    expect: [
      { kind: 'active', predicate: 'works_at', objectText: 'Acme' },
      { kind: 'not-active', predicate: 'works_at', objectText: 'Globex' },
    ],
    probe: { question: 'Where do I work?', correct: 'Acme', drift: 'Globex', distractors: ['Initech'] },
  },
  {
    id: 'restraint-hedge-move',
    axis: 'restraint-hedged',
    note: 'Considering a move is not moving.',
    sessions: [['I live in Berlin.'], ["I'm thinking about maybe moving to Lisbon next year."]],
    expect: [{ kind: 'active', predicate: 'lives_in', objectText: 'Berlin' }],
  },

  // ── restraint-confidence ─────────────────────────────────────────────────
  {
    id: 'restraint-conf-hard',
    axis: 'restraint-confidence',
    note: 'Weak third-party evidence must not overwrite a hard first-party fact.',
    sessions: [["I'm allergic to penicillin."], ['My mum reckons I grew out of the penicillin thing.']],
    expect: [{ kind: 'active', predicate: 'allergy', objectText: 'penicillin' }],
  },

  // ── anti-trap: the anchored answer is STILL CORRECT ──────────────────────
  {
    id: 'anti-trap-mentioned-old-job',
    axis: 'anti-trap',
    note: 'Talking about a past employer in the past tense is not a job change. '
      + 'Over-eager supersession is as damaging as under-eager and nobody measures it.',
    sessions: [['I work at Acme.'], ['I was telling someone about my old job at Initech, before Acme. Feels like a lifetime ago.']],
    expect: [
      { kind: 'active', predicate: 'works_at', objectText: 'Acme' },
      { kind: 'not-active', predicate: 'works_at', objectText: 'Initech' },
    ],
    probe: { question: 'Where do I work?', correct: 'Acme', drift: 'Initech', distractors: ['Globex'] },
  },
  {
    id: 'anti-trap-visiting-city',
    axis: 'anti-trap',
    note: 'Mentioning a city in any context is not moving to it.',
    sessions: [['I live in Berlin.'], ['Berlin is grim in February. Everyone I know is in Lisbon right now and I am jealous.']],
    expect: [{ kind: 'active', predicate: 'lives_in', objectText: 'Berlin' }],
    probe: { question: 'Where do I live?', correct: 'Berlin', drift: 'Lisbon', distractors: ['Munich'] },
  },
  {
    id: 'anti-trap-hypothetical-past',
    axis: 'anti-trap',
    note: 'A counterfactual is not a fact.',
    sessions: [["I'm single."], ["If I'd stayed with my ex I'd probably be married by now."]],
    expect: [{ kind: 'count-active', predicate: 'relationship_status', n: 1 }],
    probe: { question: 'Am I married?', correct: 'no', drift: 'yes', distractors: ['engaged'] },
  },

  // ── mechanical modes ─────────────────────────────────────────────────────
  {
    id: 'mech-status-anchor',
    axis: 'mechanical',
    note: 'Status: does the system anchor on the EARLIEST value across three states?',
    sessions: [
      ['I live in London.'],
      ["I've moved to Berlin."],
      ["Moved again — I'm in Lisbon now."],
    ],
    expect: [
      { kind: 'active', predicate: 'lives_in', objectText: 'Lisbon' },
      { kind: 'count-active', predicate: 'lives_in', n: 1 },
    ],
    probe: { question: 'Where do I live?', correct: 'Lisbon', drift: 'London', distractors: ['Berlin'] },
  },
  {
    id: 'mech-salience',
    axis: 'mechanical',
    note: 'Salience: frequency must not beat recency. London is said three times, '
      + 'Berlin once and last. Recency wins for a single-valued predicate.',
    sessions: [
      ['I live in London.'],
      ['London rent is insane.'],
      ['My whole life is in London really.'],
      ["I've moved to Berlin."],
    ],
    expect: [{ kind: 'active', predicate: 'lives_in', objectText: 'Berlin' }],
    probe: { question: 'Where do I live?', correct: 'Berlin', drift: 'London', distractors: ['Paris'] },
  },

  // ── confabulation ────────────────────────────────────────────────────────
  {
    id: 'confab-address-merge',
    axis: 'confabulation',
    note: 'The measured failure: a model spliced an old street onto a new city to '
      + 'produce an address present nowhere in the input, 3/3 runs. Nothing may be '
      + 'asserted here that is not literally in the transcript.',
    sessions: [['I live at 12 Mill Road in Cambridge.'], ["I've moved to Pune."]],
    expect: [{ kind: 'not-active', predicate: 'lives_in', objectText: '12 Mill Road, Pune' }],
  },
  {
    id: 'confab-no-invention',
    axis: 'confabulation',
    note: 'Vague input must produce no invented specifics.',
    sessions: [['Work has been a lot lately.']],
    expect: [{ kind: 'count-active', predicate: 'works_at', n: 0 }],
  },
];
