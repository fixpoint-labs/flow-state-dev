# POC · a review after the coding run, looping back on a revision

Retained design evidence for [FIX-2163](../../SPEC.md). Throwaway code, excluded from every
default test and typecheck run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, and ESLint ignores `specs/**/poc/**`. `run.sh` copies the case into
`packages/engine/test/` for the run and removes it afterwards.

```bash
bash specs/issues/FIX-2163/poc/review-loops-back/run.sh
```

## The question

FIX-2163 suspends the harness manager's request for a person's review after the coding run.
An accepted review must complete without running the coding run again, and a revision must loop
back to the run step once, with the person's words. FIX-2132's POC
([answer-loops-back](../../../FIX-2132/poc/answer-loops-back/README.md)) found that with trace
observability off every resume ran the finished runs again; that became FIX-2137 (#3749,
merged). Does the shape hold on `main` now, with traces off as in production?

## What it runs

A durable sequencer shaped like the manager: `coding-run` (a side effect counted outside every
store) → `review` (`ctx.suspend` with `human_input`, standing in for FIX-2129's
`waitForUser({ kind: "review" })`) → `loopBack` to `coding-run` on a revision → `report`. Two
cases, each with traces off and on: accept at once; revise, then accept. Answers go through
`continueRequest`, as the resume route does. The `loopBack` here stands in for the manager's steer step and its
loop back (FIX-2086), which the real chain uses for a revision.

## What it showed · 2026-10-23, on `main` at `31d68caa`

```
[traces off, accept]        runs: pass 1                                      reviews: [accepted]
[traces off, revise+accept] runs: pass 1, pass 2 (revise: rename the flag)    reviews: [revise, accepted]
[traces on,  accept]        runs: pass 1                                      reviews: [accepted]
[traces on,  revise+accept] runs: pass 1, pass 2 (revise: rename the flag)    reviews: [revise, accepted]
```

- **The premise holds, traces off included.** An accepted review completes the request with the
  coding run run once. A revision runs one more pass with the words, and its own review suspends
  anew; the second accept completes with no run repeated and no state doubled.
- **The check reaches the code it covers.** FIX-2132's POC, the same harness, printed six runs
  for three passes with traces off at `f740b61c1`, before FIX-2137. Re-run at `31d68caa`, it
  prints three, and its two traces-off cases, which assert the old replay, now fail. So this
  POC's green is FIX-2137's fix, not a harness that can't see a replay.
- **Not tested here:** FIX-2129's `waitForUser` itself (not on `main`), the manager's real chain,
  and a host process restart between the stop and the answer. The goal check covers those.
