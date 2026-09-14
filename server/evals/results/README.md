# Measurement results, kept

Raw output from measurements worth being able to re-read. `server/var/` is
gitignored -- it holds uploaded photos -- so anything that should survive lives here
instead.

## 2026-09-14-pairs-47.json

47 completed pairs from the synthetic pool, five runs planned each, $1.01 of Gemini,
59 minutes. Produced by `scripts/measure-pairs.ts`, read by `scripts/analyse-pairs.ts`.

The three results, in order of how much they should change:

1. **Two instances of one model agree 79.3% of the time.** The pass mark is 50%, so
   36 of 47 pairs passed. A threshold that sits far below its own base rate is not
   selecting anything. This is the caveat already written at the top of
   `src/matching/rendezvous.ts`, measured for the first time.

2. **Not one pair completed all five runs.** 49% managed four, 32% three, 17% two,
   one managed one. Nothing scored 5-of-5 in the entire run -- because nothing was
   asked five times. This produced the `quorum` rule; it does not fix the underlying
   loss, which wants a retry on the dropped call rather than on the verdict.

3. **The system says no to the only real person and yes to almost everyone
   invented.** The founder's seven rounds: `both_yes` of 1, 1, 0, 0, 0, 1, 0, about
   12% agreement against the pool's 79%. At the observed base rate, zero passes in
   seven has odds of 3.9e-5, and two of those seven completed all five runs, so it is
   not the dropped-run problem. Twenty specific public facts give the assessor
   concrete grounds to object; a 967-character generated dossier gives it none.

A hypothesis that did NOT survive: that agreement was driven by the synthetic pool
handing both sides identical sentences. 73% of pairs do share one word for word, but
the correlation with agreement is r = -0.07 over 47 pairs. The duplicated quotes are
a real bug and they explain nothing.

Re-run with `tsx scripts/measure-pairs.ts 50 1.50`, analyse with
`tsx scripts/analyse-pairs.ts evals/results/2026-09-14-pairs-47.json`.
