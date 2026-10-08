# POC · what a later turn in a task's own session is handed

An experiment retained as evidence for [FIX-1817](../../SPEC.md). Not production code: nothing
imports it, it has no package manifest, and it is outside default build, test, lint and knip
discovery ([specs/README.md](../../../../README.md)).

## The question

FIX-1817 promises that an answered question carries on in the task's own session "with everything
it already knew", and that a finished task's session answers a follow-up from its history. Both
rest on one premise nobody had run: **a later turn in a task session is handed the earlier task
turn.** The `agent` kind keeps `history: true`, but its task entry (`work`) declares no
`userMessage`, so what the history holds was a guess.

**What would show the design is wrong:** the same session not being reused on re-entry, or a
later turn being handed nothing from the task turn.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1817/poc/task-session-reentry/run.sh
```

The real engine (`createFlowState`, in-memory stores, `runAction` per request), the existing
hand-over fixture's host (a mailbox list, a coordinator board handing each task to `work` on the
shared `agent` copy, per-task sessions) and a scripted model. Nothing in the scope, store or task
layer is stubbed. One stand-in: R1 writes the finished row back to `pending` with an answer in
`feedback` by a raw store write, because an `agent` worker has no way to park today and
`answerTask` does not exist.

## What was observed

Against `main` at `b78c0ef58`: two tests, **passed**, with these readings.

| Leg | Observed | Reading for the design |
|---|---|---|
| F1 · a person's question to a finished task's session | Runs, no refusal. The model is handed the task turn's **answer** (`I found licence KESTREL-41…`) and the new question. The task's **own prompt is not there** | No lock at the framework. But the session doesn't know what it was asked: the task entry must keep the task message as the turn's user item (S5) |
| R1 · a row re-queued after its turn | Re-enters the **same session** (`run.sessionId` unchanged). The model is handed the earlier answer, then the task's goal again as a fresh message. The answer in `feedback` **never reaches the model**. The re-entry **spent one attempt** (`attempts` 1 → 2) | The board's own path already gives "same session" (D1 stands on it). Three gaps to close: the answer must be the turn (S5), the history must hold the first prompt (S5), and the re-entry must not be charged (S3) |

The premise held where it matters most, the same session and its history. What it found missing
is the plan's S3 and S5.
