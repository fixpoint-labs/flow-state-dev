# POC · a board drain inside the approved branch of a durable request

Throwaway design evidence for [FIX-1666](../../SPEC.md). Not production code, not a workspace
package, in no default build, test, lint or knip discovery. Nothing outside this folder imports it.

## The question

D1's "Approve & run" rests on one premise the repo had not shown: that a task-board drain which
hands a row to **another flow kind** still runs when it sits in the approved branch of a durable
action, continued by the engine's own resume route. The suspend and resume path was proved alone
(`goals/suspension/`), and drain inside a sequencer was proved alone (the task board's
`unparkAndDrain`), but not the two in one request.

If it does not compose, D1 can only file on approve and leave the run to someone else, which is
a different decision.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1666/poc/durable-drain/check.mts
GOAL_CONTROL=no-gate pnpm exec tsx specs/issues/FIX-1666/poc/durable-drain/check.mts   # must FAIL
```

Exit 0 and `PASS` on the first; exit 1 naming "a row existed before any approval" on the second.
No key, no model. Uses the repo's own `pnpm install`.

## What it builds

Two flow kinds on one in-memory store with durable execution on, mirroring the lab's shape
without importing it: an EM-like kind whose durable `ask` action is prepare → stock
`human_approval` suspension → on approve file one row and run `board.drain` → on reject say so;
and a coder-like kind that receives the row through a cross-flow hand-off. Everything is driven
through the flow router, as a client would: dispatch, read the pending suspension, POST
`/:flowKind/requests/:requestId/resume`, poll status.

## What it showed (2026-09-30)

| Check | Result |
|---|---|
| The ask suspends with no row and no coder run | Held. One pending `human_approval` naming the feature |
| Resume answers before the work runs | `202`, and the coder had not run when it returned. The drain runs in the continued request, so Approve does not hold a person's click for a coding run |
| Approve | Request `completed`; exactly one row, `completed`; coder ran once; its child session is parented under the EM's session (`flowKind` = the coder kind); nothing left pending |
| Reject | Request `completed`; no row; no run; nothing left pending |
| Control `no-gate` | FAIL on "a row existed before any approval", as it must |

One thing the run taught that the lab already does: the board's capability is keyed by the
board's `name`, so the handler that files reads `ctx.cap[<board name>]`. The lab names its board
by its id, which is why its `addRow` works; the first run of this POC did not, and failed there.

Verdict: **confirmed.** The premise holds with the stock pieces. Recorded in
[DECISIONS.md → Settled](../../DECISIONS.md#open--settled).
