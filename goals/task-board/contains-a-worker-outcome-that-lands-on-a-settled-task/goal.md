# task-board › it contains a worker outcome that lands on a settled task

**Issue:** FIX-951
**Outcome:** A board where one task is settled while its worker is still running finishes the rest of its work and returns results, instead of dying partway with an internal error about a status transition. The settled task keeps the status whoever settled it chose, and the siblings drain normally.
**Input:** `fixtures/input.json` — the task to settle mid-flight, the sibling task names, the reason the settler records, and a held-out `salt` every sibling worker echoes into its output. Held-out: swap the names, the reason, or the salt and a correct implementation still passes; every assertion reads the fixture and none reads a literal.
**Signal:** One `runAction` over a real four-task board (`concurrency: 2`, `onError: "skip"`) whose worker on the settled task cancels its own task and then returns normally — the *succeeding*-worker shape, which is the ordinary case rather than the exotic one, since cancelling does not stop the worker already running. The run reaches `completed`; every sibling reaches `completed` and its recorded output carries the held-out salt; the settled task holds `cancelled` with the settler's own reason intact.
**Anti-game:** Three hollow passes are closed. (1) **A board that never ran the siblings.** Asserting they reached `completed` is not enough, so the check asserts each sibling's recorded *output* carries the fixture salt — a status without the salt fails. (2) **Asserting on the drain's return value.** A board that abandoned its siblings still returns something, so every assertion reads the emitted `task-change` stream off the persisted request record, not the return value. (3) **A late result quietly overwriting the settlement.** Asserting the settled task is merely terminal would pass if the worker's result had overwritten the cancel, so the check asserts the settler's own reason survived.
**Model:** n/a — model-free. The outcome is a real board draining real work through the real substrate, and the race has to be seeded deterministically to be tested at all. A model would add flakiness without adding discrimination.
**Run:** `pnpm tsx goals/task-board/contains-a-worker-outcome-that-lands-on-a-settled-task/run.mts`

> Placed under a new `task-board` describe rather than under `delegation*` deliberately. The delegation layer *contains* this failure in its coordinator tool loop — the turn survives and the model gets an opaque error string — so a delegation-framed goal would be the least discriminating place to prove the fix. The pattern layer is where the escape is genuinely fatal.

> **Must fail before the fix**, and does: against `origin/main` the run status is `failed` and two siblings are still `pending`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-28 | fix/FIX-951 | n/a (model-free) | PASS | 3 siblings drained, each output carrying the held-out salt; `audit-ledger` held `cancelled` with the settler's reason; run status `completed`. |
| 2026-07-28 | origin/main | n/a (model-free) | FAIL (expected) | Pre-fix baseline, run with the source changes stashed: run status `failed`, `reconcile-invoices` and `notify-owner` still `pending` — the drain abandoned them. Recorded as the evidence that the check is not vacuous. |
