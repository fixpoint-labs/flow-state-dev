# coordinators › a task's session stays open until it's done

**Issue:** FIX-1817 (epic FIX-1815). Its spec's goal: `specs/issues/FIX-1817/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a task that stops on a question carries on in its own session once answered, and finishes from there. Once finished, that session still answers a question about what it did, and takes a follow-up task that runs in it.

**Input:** a goal-local Lab (`lab/fsdev.config.mts` over the tree in `fixtures/workforce/`) on the real engine and a SQLite store, served over HTTP by Shift Manager's own command. Alice signs in with a verified bearer and acts through the shipped clients (the session client, an action client per flow, `createWorkforceClient`). `desk.lead` is a coordinator whose one delegate is `desk.ops`, on the built-in `agent` flow and the real model `openai/gpt-5.4-mini` through the AI Gateway, with one goal-local tool, `drawTicket`, which draws a fresh random ticket on every call. The coordinator's judgment turn, which each notice wakes, is scripted to note it. The task's brief says to draw a ticket, then ask which region to deploy to, then finish naming both. Held out, picked at run time: the region (one of six) and the follow-up's wording (one of three).

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **a** (the task asks, the app answers): `a:parked` the task parks with one `parked` notice; `a:answered` `answerTask_tasks` with `Use <region>.` answers `{ ok: true }`; `a:completed-90s` the task is `completed` within 90 s of the answer; `a:same-session` it ended in the session that parked; `a:names-ticket` its output names the ticket `drawTicket` drew before the question; `a:names-region` it names the answered region; `a:one-completed` one `completed` notice; `a:unspent` one attempt charged (`attempts - turnReentries - abandonments` is 1), so the answer spent none.
- **b** (ask the finished session): `b:names-ticket` the session `findWorkerSession({ worker, taskId, filingSessionId })` returns is the task's own, and its `run` door answers "Which ticket did you draw?" with the ticket.
- **c** (a follow-up task): `c:completed` an `addTask_tasks` naming the finished task in `followUpOf` completes; `c:same-session` it ran in the task's session; `c:names-ticket` its output names the ticket; `c:one-draw` `drawTicket` ran once in total; `c:one-completed` one `completed` notice for it.

**Anti-game:** no row, notice or session is written by the check: every change is an action Alice sends, or what the system does with it. The ticket appears in no prompt the check sends. Every grade reads the store file the run wrote (`../files-tasks-down-the-owners-chain/store.mts`), except what an action answered.

**Attempts:** real model, so it runs until it first passes, up to three attempts (`GOAL_ATTEMPTS`), each on a fresh store and Lab. One attempt under a control.

**Model:** `openai/gpt-5.4-mini` through the AI Gateway (`AI_GATEWAY_API_KEY`); blocked, not failed, without the key.

**Run:** `pnpm tsx goals/coordinators/task-session-stays-open/run.mts`. On demand only, never a CI gate.

**Controls:** scratch patches to Workforce modules, applied as the Lab loads them (`goals/lib/module-patch.mjs`), printed by the run, and refused when they never reached the code.

- `GOAL_CONTROL=new-session`: every attempt and every follow-up is handed to a fresh session (`conversation-board/board.ts`, the hand-off's session key). Must fail **`a:names-ticket`** and **`c:names-ticket`**.
- `GOAL_CONTROL=drop-answer`: the re-entered turn is handed the task again, not the answer (`conversation-board/task-entry.ts`). Must fail **`a:names-region`**.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-10 | 566291ccc | openai/gpt-5.4-mini (vercel gateway) | PASS | Attempt 1 of 1. a: parked, answered `eu-north`, completed 1 s later in the session that parked, output "Ticket TCK-161E8C, region eu-north.", attempts 2 with 1 re-entry. b: "TCK-161E8C". c: the follow-up completed in the same session, named the ticket; `drawTicket` ran once |
| 2026-10-10 | 566291ccc | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `new-session`, expected) | `a:names-ticket` and `c:names-ticket`: the re-entry drew a second ticket in a fresh session, the follow-up a third; `a:same-session`, `b:names-ticket`, `c:same-session`, `c:one-draw` red with them |
| 2026-10-10 | 566291ccc | openai/gpt-5.4-mini (vercel gateway) | FAIL (control `drop-answer`, expected) | `a:names-region` alone: "I drew ticket TCK-E0AF77 and am waiting for the deployment region." |
