# Supersession eval

The acceptance criterion the earlier study said was missing. `RUBRIC.md` is frozen —
read it before changing anything here, and do not edit it to fit a result.

    npm run eval              # full matrix + G0 A/B. Needs API keys. Costs money.
    npm run eval:structural   # skip probes: cheaper, no G0
    npm run eval -- --axis=restraint-hedged
    npm test                  # G7/G9/G10 only. No key, no cost, runs on every commit.

Exits non-zero when a gate fails.

## Why not promptfoo

The plan named promptfoo and this deviates from it, deliberately.

promptfoo is built for stateless prompt × testcase grids. This eval is neither: each
case replays *several sequential sessions* through the real pipeline — episodes, P1
extraction, the commit gates, the fact store — and then asserts on database state.
Wrapping that in a custom provider would be indirection around the part that matters.
Revisit if we ever need the model-matrix or the web viewer.

## Two scoring modes

**Structural** — assert the fact store's state in SQL after replay. Deterministic,
free, no model at scoring time. Covers every axis except G0.

**Probe** — used only for G0. The clone answers a question; the answer is matched
against a **closed pool** by string containment. Not an LLM judge, on purpose: an
audited `gpt-4o-mini` judge accepted 63% of intentionally wrong answers, and a LoCoMo
audit found 6.4% of the published answer key was itself wrong. A judge we don't need
can't betray us.

Every pool carries a **drift** entry — what an agent anchored on the pre-update value
would say. That's what makes this measure stale-state bias rather than generic
failure. Without it you cannot tell "wrong" from "wrong in the specific way this
product fails".

## G0 is the one that matters

G0 asks whether the fact store beats the verbatim-episode RAG control that has been
sitting in `src/memory/retrieval.ts` since W1.

Published measurements have verbatim RAG matching full context, and agent self-memory
*losing* to basic retrieval. If G0 fails, the LLM write path is a net negative and the
designed response is to **ship the control and delete the write path** — not to tune
until the number moves. That is why the control was built first, and why collapsing
to it is a config change rather than a rewrite.

## The corpus is scaffolding

`cases/seed.ts` holds 19 cases written to exercise the format and the harness. It is
**not** the corpus. The rubric is explicit: sixty cases from the founder's own life
beat six hundred generated ones, and only real ones carry real ASR output — which
matters, because no published benchmark in this space uses ASR at all, and ASR is
exactly where hedges die.

Build the real corpus by living it. During weeks 1–2 of dogfooding, deliberately act
out supersession scenarios: announce a move three sessions before you arrive; mention
a job you're considering, then take it, then refer to it as past; change a dietary
restriction; stay somewhere temporarily *and say so*. Then write 30 more from things
that were true of you five years ago and aren't now.

**Keep few-shot examples and eval cases disjoint.** The examples in the extraction
prompt were written from different scenarios than `seed.ts` for exactly this reason —
few-shots that mirror the test cases leak the answers and turn the matrix into a
memorisation check.

## Adding a case

```ts
{
  id: 'restraint-temp-housesit',
  axis: 'restraint-temporary',
  note: 'Why this case exists. Read before changing its expectations.',
  sessions: [['I live in Berlin.'], ['House-sitting in Vienna for three weeks.']],
  expect: [{ kind: 'active', predicate: 'lives_in', objectText: 'Berlin' }],
  probe: { question: 'Where do I live?', correct: 'Berlin', drift: 'Vienna', distractors: ['Prague'] },
}
```

Write the expectation before you run it. A case whose expectation you decide after
seeing the output is not a test.
