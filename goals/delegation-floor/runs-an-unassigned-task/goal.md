# delegation-floor › it runs an unassigned task on the default worker

**Issue:** FIX-940
**Outcome:** A skill can delegate without hand-writing a roster: a task whose `assignee` is unset or names no declared worker is run by an on-demand default worker (the floor), and that worker's result is recorded on the task — instead of the task erroring out of the board.
**Input:** `fixtures/input.json` — a held-out factual `question` + its `answer`, and a deterministic `specialistMarker`. Held-out: swap in any other question+answer (whose answer is absent from the question) and a correct implementation still passes; the check reads the answer from the fixture, never a literal.
**Signal:** Over the same two seeded tasks (one unassigned, one assigned to a declared worker):
- floor-ON board: the unassigned task settles `completed` and its recorded `output` contains the held-out answer; the declared task settles `completed` with the specialist marker.
- floor-OFF board (identical minus `defaultWorker`): the unassigned task settles `errored` with no output; the declared task still completes with the marker.
**Anti-game:** Two contrasts guard against a hollow pass. (A) floor-ON vs floor-OFF over the identical board and tasks: if the "completed with answer" came from anything other than the floor, the floor-OFF board — same registry, same task — would produce it too; it instead errors, so only the wired floor could have produced the answer. The check asserts on the recorded output **content** (the held-out answer), not on `completed` status alone, so an empty-output completion fails. (B) declared vs floor: the declared task must show the deterministic specialist marker and never the floor's answer, proving the floor is reached only on a genuine miss (not hijacking declared work). The answer is graded from the fixture, so it cannot be hardcoded in the runner.
**Model:** real — openai/gpt-5.4-mini (the floor is a `materializeWorker`-built generator; the declared worker is a deterministic handler by design, so only the floor's answer exercises the model).
**Run:** `pnpm tsx goals/delegation-floor/runs-an-unassigned-task/run.mts`

> Note: this isolates the FIX-940 seam — `taskBoard({ defaultWorker })` → `buildWorkerStep` router `fallback` → the floor generator runs on a real model and records output. The delegation surface's model-facing plumbing (the coordinator's `addTask`/`runBoard` tool calls, rosterless install, floor materialization + wiring) is covered deterministically by the mocked specs in `packages/orchestration/test/skills/delegation-floor.test.ts` and `test/task-board/task-board.test.ts`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-24 | fix/FIX-940 | openai/gpt-5.4-mini | PASS | floor-on unassigned → "...Canberra"; floor-off unassigned → errored/undefined; declared → SPECIALIST-SENTINEL-7318. Asserted on output content, both contrasts held. |
