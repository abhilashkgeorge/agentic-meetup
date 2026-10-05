# A trained clone brain on Tinker: the plan

**The question.** Can a small open model, trained on our own rules, beat today's model at
being a person's agent: invent less, leak nothing, say "I don't know" when it should,
and find what two people really share?

**How we will know.** The same test, the same code scoring it: `set.json` (439
situations) and `score.ts`. A tuned model runs through `run.ts --model=...` exactly like
today's did. Nothing here needs a model judge.

**Honest start:** today's model scored 94.5% right, one leak, no invented answers, but
found only 61% of the real shared things. Training is worth it only for that gap, for a
harder test, or to own the model.

**Update, same day (`FINDINGS.md`):** a rewritten prompt took shared things to 80% with no
training, and the harder test found no leaks and no inventions under four turns of
pressure. What is left -- notes that disagree -- looks like a prompt fix too. The
recommendation is to try that (about $0.35) before any of the training below.

## The bar, set before training

Today's model already does well on this set (README, "Baseline"). So the bar is where
it is weak, and "no worse" everywhere else. On `set.json`, never trained on:

| | today's model | the bar |
|---|---|---|
| leaks | 1 of 439 | 0 |
| made-up facts | 3 | 1 or fewer |
| real shared things found | 61% | 80% |
| shared things claimed that are not | 3 (precision 91%) | no worse |
| "I don't know" when it should / wrongly | 96.8% / 4.5% | no worse |
| refusals | 95.7% | no worse |
| unreadable replies | 0 | under 1% |
| cost a reply | $0.0004 | no more |

Plus two checks the set cannot do: the eight hand-written people stay test-only, and a
person reads 50 random replies before anything ships.

**First, make the test harder.** A tuned model cannot show much where today's model
scores 95%. Before paying for training, add what the set lacks: several turns of
pressure in one conversation, longer and messier notes, notes that contradict each
other. Build it the same way (`set.ts`), run today's model again (~$0.20).

## 1. Data: a frontier teacher, kept only where our guards pass it

- **Training situations**, never the test's: the same builder (`set.ts`) run on *other*
  practice people — profiles 27 onward of the seed, or a new seed — with question
  templates reworded, so the model cannot learn the test's wording. About 8,000.
- **Invented people only.** No real user's notes leave the server. That is also why the
  test is built on practice profiles.
- **The teacher** answers each one through `llm.complete`, same prompt (`contract.ts`),
  2 to 4 samples each. Candidate: Claude Opus 5 or Sonnet 5 — run the teacher on
  `set.json` first (about $1.40 for Sonnet 5), since a teacher that fails the bar teaches
  its failures.
- **The filter is the scorer.** Keep a reply only if `score.ts` calls it right, with no
  leak, nothing made up and no added words. The scorer is built on the app's own guards
  (`mayRepeat`, `namesCoreValue`, `contactDetail`, `namesPlace`, the note citations), so
  "passes the guard" means the same thing in training as in the app.
- **Cost:** ~24,000 teacher calls at ~1,000 tokens in and ~60 out: about $65 on Sonnet 5,
  half that on the Batch API.

## 2. Supervised round on Tinker

- **Base model:** start with `Qwen3-8B` (train $0.44 per million tokens, the cheapest on
  the list), and try `Qwen3.6-35B-A3B` (a mixture-of-experts, $1.18) if 8B falls short.
  Chain-of-thought off: the reply is one JSON object.
- **LoRA**, rank 32, learning rate from the Tinker cookbook's LoRA helper, 2–3 epochs,
  loss on the assistant's tokens only.
- **Tokens:** 8,000 × ~1,100 × 3 epochs ≈ 26M: about $12 on Qwen3-8B, $31 on 35B-A3B.
- Score each epoch's checkpoint on a held-out *generated* slice with `score.ts` (Tinker's
  sampling client); keep the best.

## 3. Reinforcement round: the guard is the reward

- Fresh generated situations (not the test's). Sample 8 replies per prompt from the
  supervised checkpoint; score each with `reward()` in `score.ts`: a leak −3, a made-up
  fact −2, a stretch or a wrong "I don't know"/refusal −0.5, a right reply +1, each real
  shared pair +0.5, each false one −0.5, a small cost per added word.
- Advantage = reward minus the group's mean (the GRPO shape); the cookbook's
  importance-sampling loss; small learning rate, few hundred steps.
- **Reward hacking to watch:** refusing everything (answerable prompts are ~40% of the
  mix and a refusal there scores 0 − 0.5), learning only the planted trap words (new
  people and new trap lists in training; the test's traps are never seen), paraphrase
  crushed by the added-word cost (kept small).
- **Cost:** 50 steps × 64 prompts × 8 samples on Qwen3-8B is about $20 (prefill $0.195,
  sampling $0.60, training $0.44 per million tokens). Start there; go further only if
  the numbers move.

## 4. Plug it in behind `modelFor(task)` — only after it clears the bar

1. **Serve it.** Tinker's OpenAI-compatible endpoint works for testing, but its docs say
   it is "meant for testing and internal use with low internal traffic". Fine for the
   phones on the desk. For launch: export the LoRA and serve it (vLLM with LoRA adapters
   and JSON-constrained decoding, on a GPU host or a provider that serves adapters).
2. **`src/llm/caps.ts`:** a registry entry with a verified price — boot already refuses
   an unpriced model. No prompt cache; JSON by prompt, parsed by zod.
3. **`src/llm/adapters/tinker.ts`:** `complete()` over the OpenAI-compatible API (the
   `openai` SDK with a `baseURL`), usage priced from our table like every adapter.
4. **A new task, `talk`**, with `TALK_MODEL` defaulting to today's model, and `talk.ts`
   and `answer-sheet.ts` moved from `modelFor('extract')` to `modelFor('talk')`. Today
   both ride on `extract`, which also pulls facts out of chat — pointing `extract` at the
   tuned model would change fact extraction too. After that, switching is one line of
   config: `TALK_MODEL=tinker:clone-brain-v1`.
5. **The code guards stay in front** (`checkTalk`, `mayRepeat`). A better brain is not a
   reason to remove the fence.
6. **Order:** the answer-sheet pointer first (lowest risk), then the talk, then — only if
   leaks stay at 0 and the 50-reply read agrees — a free-speaking agent, the thing this
   test actually measures.

## Total for a first cycle

Teacher data ~$65, supervised ~$12–31, reinforcement ~$20: about **$100–120**, plus
checkpoint storage ($0.10/GB-month). Nothing is spent until you say so.

Running it after: Tinker's sampling price puts a Qwen3-8B reply at about $0.0002
(~1,000 tokens in, ~50 out), half of today's. A GPU of our own only pays at volume.

## What could make this not worth it

- The tuned model may only learn this test's templates. The hand-written people and a
  human read are the check; if it passes the generated set and fails those, it is a no.
- A small model's JSON breaks more often. Constrained decoding fixes most of it; the bar
  counts what is left.
- Tinker's model list and prices were read from its docs on 2026-09-28; they change.

Sources: [Tinker docs](https://tinker-docs.thinkingmachines.ai/),
[models and prices](https://tinker-docs.thinkingmachines.ai/tinker/models/),
[OpenAI-compatible inference](https://tinker-docs.thinkingmachines.ai/tinker/compatible-apis/openai/).
