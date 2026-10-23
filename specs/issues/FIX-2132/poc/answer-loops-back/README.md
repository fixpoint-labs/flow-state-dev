# POC · an answer loops a durable sequencer back to its run step

Retained design evidence for [FIX-2132](../../SPEC.md). Throwaway code, excluded from every
default test and typecheck run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, and ESLint ignores `specs/**/poc/**`. `run.sh` copies the case into
`packages/engine/test/` for the run and removes it afterwards.

```bash
bash specs/issues/FIX-2132/poc/answer-loops-back/run.sh
```

## The question

FIX-2132 puts a person's stop in the harness manager after its run step, and loops back to the
run step with the answer. That holds only if a resume does not run the completed run step again,
runs the next pass once, and suspends anew at the next pass's question. Does it, with trace
observability on (dev) and off (production)?

## What it runs

A durable sequencer shaped like the manager: `coding-run` (a side effect counted outside every
store) → `ask` (`ctx.suspend` with `human_input`, standing in for FIX-2129's `waitForUser`) →
`loopBack` to `coding-run` when answered → `report`. Pass 1 and pass 2 ask; pass 3 finishes. Two
answers, through `continueRequest`, as the resume route does.

## What it showed · 2026-10-23, on `main` at `f740b61c1`

```
[on, unguarded]  runs: pass 1, pass 2 (A1), pass 3 (A2)                                   answers: [A1, A2]
[off, unguarded] runs: pass 1, pass 1, pass 2 (A1), pass 1, pass 2 (A1), pass 3 (A2)       answers: [A1, A1, A2]
[off, guarded]   runs: pass 1, pass 2 (A1), pass 3 (A2)                                   answers: [A1, A1, A2]
```

- **Traces on: the premise holds.** Each answer resumes without running a finished pass again,
  the next pass runs once with the answer, and its own question is a new stop.
- **Traces off: the premise fails.** Every resume runs every finished pass again: three coding
  runs become six. Replay of a completed block reads its retained `block_trace` output, and
  production retains none. Filed as FIX-2137.
- **Traces off, the run wrapped in `ctx.runOnce` keyed by its pass:** each pass runs once, but
  state the later steps append to still doubles. A manager-side guard has to cover every
  non-idempotent step, not just the run.

This tested the suspension shape the spec first drew. The spec has since moved the question onto a
hold with no suspension. The finding (FIX-2137) still blocks FIX-2132 through a host's harness block
that suspends ([D1](../../DECISIONS.md#d1)).
