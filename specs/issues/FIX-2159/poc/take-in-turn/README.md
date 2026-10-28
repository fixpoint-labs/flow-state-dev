# POC · a running turn takes a settled notice through the existing take record

Retained design evidence for [FIX-2159](../../SPEC.md). Throwaway code, excluded from every
default test and typecheck run: nothing under `specs/` is in a package's vitest `include` or
`tsc` roots, and ESLint ignores `specs/**/poc/**`. `run.sh` copies the case into
`packages/orchestration/test/tasks/` for the run and removes it afterwards.

```bash
bash specs/issues/FIX-2159/poc/take-in-turn/run.sh
```

## The question

Epic D2 asks for "one durable *taken in request R* mark, like `steersTakenIn`", and changes its
mind if the take can't be made crash-safe. `onTaskSettled` already writes a durable take record
naming its request (FIX-2123), and a later copy takes the notice over once that request ended
without clearing it. Can a **running conversation request** take the notice in its own name
through that same record, so the queued `onTaskSettled` copy never handles it twice and never
loses it?

## What it runs

The real engine, a durable host, a resource-backed board. A `respond` action stands in for the
person's turn: it reads the board, waits on a gate (a model call), then does what the context
entry would do before its next model call: a committed read, `takeNotice({ by: its request })`,
the clear, and only then the line (the queued handling's order, D1). The ending is written by another request while the turn waits. Then the
queued `onTaskSettled` copy runs, as it does after the turn.

## What it showed · 2026-10-23, on `main` at `3d131544`

```
✓ 1+2 · sees the ending by a committed read, takes it, and the queued copy finds nothing owed
✓ 3   · when the queued copy took it first, the turn's take is refused: heard once, by the copy
✓ 4   · a turn that took it and failed before its acknowledgement: the copy takes it over, heard once
✓ 4b  · a turn that failed after its acknowledgement, before its line: dropped, never twice (at most once)
✓ 5   · a turn that only reads the finished row: the queued copy says it again, heard twice
Tests  5 passed (5)
```

- The turn's own snapshot of the board does **not** show the ending (`sawInSnapshot: false`); a
  committed read does. The context entry must read committed, as `takeRunningSteers` does.
- The take record stays after the clear, naming the turn's request: that is the durable
  "taken in R" mark, the way `steersTakenIn` names the read that took a steer.
- **Control:** with the turn's clear removed, case 1 goes red (`expected { owed: true, … } to
  deeply equal { owed: false }`): the queued copy takes the notice over and it is heard twice.
  So the check reaches the clear.

## Verdict

**CONFIRMED.** No new mark is needed: the take record FIX-2123 added is crash-safe and already
transfers a notice between requests in one conditional write. [D1](../../DECISIONS.md#d1) rests
on this.

Case 5 is the evidence that a lab can't do this on public entries alone
([D3](../../DECISIONS.md#d3)): a turn that reads a finished row without taking it leaves the
notice owed, and the queued copy hears it again. Cases 4b and 5 were added in review; all five are green on the same base.

Not covered here, and left to the implementation's tests: the Workforce handling (Error Reporter,
dedupe, freeing the session, the line) and the answer-again hook.
