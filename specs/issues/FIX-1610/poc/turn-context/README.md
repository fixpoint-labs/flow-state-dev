# poc/turn-context — can a routed turn see the channel's lines without keeping them?

Throwaway and retained as evidence. Nothing under `specs/` is built, tested or walked by
`fsdev gen`, and `knip` ignores `specs/issues/*/poc/**`. The script runs the real engine with
in-memory stores and scripted models, and reads what each model call was sent. Keyless.

**The question.** [D4](../../DECISIONS.md#d4) gives a routed specialist's turn the channel's
recent lines, so "where can I buy it?" finds its "it", and keeps them out of the specialist's
stored conversation, so they don't come back on every later turn. Does core's generator
`context` slot do both, as written today? And what does the built-in agent kind send its model
on a second turn, which decides whether the lines are the only place the referent is?

**What would have abandoned context-only:** the context slot's text stored as a message, or sent
again on the next turn by a generator that reads its history. The fallback would then have been
the lines in the turn's own text, which the control shows is stored.

## The checks

| | What runs | Passes when |
|---|---|---|
| C1 | The built-in agent kind, hired through `hireWorkforce`, two `run` turns in one conversation: "My MacBook won't join the office wifi.", then "Where can I buy it?" | Reported, not asserted: what turn 2 sends |
| C2 | A core `generator` with `history: true` and a `context` slot fed from an optional `recent` input field; two turns, each with its own recent line (`LINE-A`, then `LINE-B`) | Turn 1 sends `LINE-A` · turn 2 sends `LINE-B` · turn 2 sends turn 1's post as history · turn 2 does not send `LINE-A` · the stored conversation holds neither line |

`POC_CONTROL=in-user-message` writes the recent line into the turn's own text instead of the
context slot. C2 must then fail.

## Run it

From the repository root. No key needed.

```bash
pnpm exec tsx specs/issues/FIX-1610/poc/turn-context/run.mts                                # C2 HOLDS, exit 0
POC_CONTROL=in-user-message pnpm exec tsx specs/issues/FIX-1610/poc/turn-context/run.mts    # C2 FAILS, exit 1
```

## Results, 2026-09-27

| Check | Default | Control |
|---|---|---|
| C1 · turn 2 sends | system, user: turn 1 is stored but not sent | same |
| C2 · turn 1 sends `LINE-A` | PASS | PASS |
| C2 · turn 2 sends `LINE-B` | PASS | PASS |
| C2 · turn 2 sends turn 1's post as history | PASS | PASS |
| C2 · turn 2 does not send `LINE-A` | PASS | **FAIL** |
| C2 · the stored conversation holds neither line | PASS | **FAIL** |

## What it showed

1. **Context-only works as core stands.** The `context` slot is resolved per call into the
   system message and never stored as a conversation message, even for a generator that reads
   its history. No core change.
2. **The control is red.** Lines written into the turn's text are stored with it and come back
   on the next turn as history, which is the second store D4 rejects.
3. **The built-in agent kind sends its model no earlier turn.** Turn 2 is the system prompt and
   the new message; turn 1 is stored but not sent. So a seat remembers nothing of its own
   conversation, in a channel or in direct talk, and the recent lines are the only place a
   routed turn can find a referent. Direct talk is out of this issue
   ([PLAN → Follow-ups](../../PLAN.md#follow-ups)).
4. **Where the lines are still visible.** The run's `block_trace` item records the block's input,
   lines included. No turn reads it; it is there for inspection.

Raw output: [`evidence.txt`](evidence.txt).
