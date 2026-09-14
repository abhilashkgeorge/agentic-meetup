# Supersession eval — rubric

**Written before any case was adjudicated. Do not edit it to fit a result.**

Letta's own report documents failure counts drifting 15 → 17 on *identical* runs once
written rules replaced intuition. That drift is the reason this file exists and the
reason it is dated and versioned rather than discussed.

Rubric version: `1` · frozen 2026-09-08

---

## What is being measured

One claim: **when a fact about the user changes, the old fact stops being asserted —
and when a fact only *looks* like it changed, it does not.**

Both halves count. Over-eager supersession is as damaging as under-eager, and almost
nobody measures it, which is why the anti-trap axis carries the second-largest weight.

## Scoring modes

**Structural (default).** Assert the state of the fact store directly in SQL after
replaying the sessions. Deterministic, free, no model in the loop at scoring time.

Use this wherever possible. It sidesteps the LLM-judge failure entirely: an audited
`gpt-4o-mini` judge accepted **63% of intentionally wrong answers**, and a LoCoMo
audit found 6.4% of the published answer key itself was wrong. A judge we do not need
is a judge that cannot betray us.

**Probe (only for G0).** Ask the assembled clone a question and match the reply
against a **closed answer pool**. Multiple-choice matching, never open-ended judging.
Every pool contains:

- the **correct** answer,
- the **drift** answer — what an anchored agent that missed the update would say,
- 1–2 neutral distractors.

The drift entry is what makes this measure *stale-state bias* rather than generic
failure. Models that err on an evolved preference pick the user's original, now-stale
value on more than a third of their wrong answers — 1.5× the uniform rate, rising to
~48% on short histories. A pool without a drift entry cannot see that.

## Adjudication rules

1. **A case has exactly one correct outcome, fixed when the case is written.** If a
   case turns out to be ambiguous, delete it or rewrite it — never re-score it.
2. **Partial credit does not exist.** Each case is pass or fail.
3. **A staged fact is not an asserted fact.** A candidate that lands `staged` counts
   as "not asserted" everywhere in this matrix.
4. **Silence is not evidence.** Failing to mention something is never grounds for
   supersession, and a case that expects one is a bug in the case.
5. **A single anecdote never overturns a `hard` fact.** Expect a conflict question,
   not a retraction.
6. **Confabulation is checked on every case, not only on its own axis.** Any object
   string appearing nowhere in the transcript is a G5 failure regardless of which
   axis the case belongs to.

## Axes and weights

| Axis | Cases | What fails it |
|---|---|---|
| action-single | 15 | old single-valued fact still active after an explicit change |
| action-multi | 10 | a compatible addition wrongly displaced an existing value |
| restraint-temporary | 10 | "staying at my sister's for two weeks" moved `lives_in` |
| restraint-anecdote | 10 | one prawn curry retracted a shellfish allergy |
| restraint-hedged | 10 | "I might quit" registered as a job change |
| restraint-confidence | 5 | weak new evidence overwrote a `hard` fact |
| anti-trap | 15 | the anchored answer was still correct and got superseded anyway |
| mechanical | 15 | anchors on earliest value; frequency beats recency; derived quantity not recomputed |
| confabulation | 10 | any object not present in the input |

## Gates

Thresholds are fixed here, before the first run. A gate is not renegotiated because
a run missed it — that is what "gate" means.

| Gate | Threshold | Why this number |
|---|---|---|
| **G0** | fact store **beats** verbatim-RAG control on the full matrix | Verbatim RAG has been measured matching full context, and agent self-memory *losing* to basic retrieval. If G0 fails, the LLM write path is a net negative: ship the control and delete the write path. |
| **G1** action-single | **≥ 98%** | Enforced by a unique index, not a model. Below 98% is a bug in our writer, not model variance. |
| **G2** action-multi | ≥ 90% | LLM action-type passes measure ~100% in the wild; 90% is slack for extraction noise. |
| **G3** restraint | **≥ 80%** | The frontier baseline is ~50%. This is the gate that actually measures the product. |
| **G4** anti-trap | ≥ 90% | Over-eager supersession is as damaging as under-eager. |
| **G5** confabulation | **exactly 0. Hard fail.** | The two-integer-list contract in P2 makes this structurally impossible; if it fires, the contract leaked. |

## Standing rules

- **Never a generous judge.** Closed pools and exact matching only.
- **Treat every vendor benchmark score as marketing.** The same system has been
  published at 65.99% and 75.14% by two parties.
- **Gate every model swap on G1–G5.** Restraint failures cluster by model *family*,
  not size — a swap can flip memory safety from 100% to 0% with identical prompts.
  Swappability is nearly free at the chat layer and costs a day of re-adjudication at
  the write path. Budget it as recurring engineering time.
- **The corpus is the founder's life, not synthetic text.** Sixty real cases beat six
  hundred generated ones, and real cases are the only ones that carry real ASR output
  — which matters, because no published benchmark in this space uses ASR at all, and
  ASR is exactly where hedges die.
