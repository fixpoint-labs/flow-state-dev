# views › screens read sessions live

**Issue:** FIX-2725
**Outcome:** A screen shows a user's sessions with a worker, a session's turns and a session's coding board by watching three views the kits install. Each is current within a second of a change, with no poll, and shows only the caller's own sessions, so an app writes none of that assembly.
**Input:** One `serve()` host on a bound port, built by workforce's conversation-board test host (the roster flow, the coordinator flow and its workers, a verified `x-user` header). Beside it, the harness kit's `harnesses` flow with its coding board view, built on the same installation. A real client (Node's `fetch` and `WebSocket`) watches the worker sessions view for Lead, the session turns view and the coding board for one of alice's Lead conversations. The poll is off, and its fetcher counts every view call. The steps:
- a second Lead session is opened from another client;
- a first task is filed on the conversation's empty board;
- the conversation is deleted, then recreated under its id;
- a turn of the conversation stores 40 chunks, one batch at a time, 25 ms apart, through the bus-wrapped store, as a streaming reply does;
- bob asks for alice's conversation; alice asks for her session in a second org and for her own write session (made by a roster write);
- three plain view calls.

**Signal:**
- `a:equals-store`: after each step, each of the three answers equals a fresh read of the store within 1 s, each on its own clock from the step's start:
  - the Lead sessions, and whether a turn action is in progress in each;
  - the conversation's turn requests and their status;
  - the board rows at the conversation's current partition.
- `b:quiet`: replies of 40 and of 120 chunks each run the three views the same number of times, so nothing wakes per chunk. The sessions view runs at most 4 times (2 per lifecycle edge); the turns view and the board run at most 3 times. The sessions bound is 2 per edge because one status write is heard twice: on the user topic, which the list hears, and on the session's `request`, which the running read hears. Each reply must also show: within 3 s of its start, its session reads running and its turn `in_progress`; within 3 s of its end, the turn reads `completed` and the session no longer running. The bound alone would pass a view that never woke.
- `c:own-only`: in none of the six cases does a view answer anything or name a topic of the session asked for, and bob's sessions list holds none of alice's.
- `d:no-actions`: the store holds no more requests after three view runs than before.

**Anti-game:** Every assertion reads what the watching client reported, or the calls its own fetcher made, against the store. Nothing reads the recorder, the hearing list or a view's unit test. The poll is off.
**Model:** n/a (no model turn: the reply's chunks are stored by the goal, not generated).
**Run:** `cd goals && pnpm tsx views/screens-read-sessions-live/run.mts` (with `FSDEV_DEFAULT_MODEL` and `FSDEV_INTENT_*` unset)
**Controls:**
- `GOAL_CONTROL=unrecorded-session-reads`: `list` records nothing (a scratch patch to `request-sessions.ts`). Must FAIL `a:equals-store`: a new session never reaches the list. Turns' hearing is broken by `turns-deaf-to-request` instead, so that each control fails only its own signal.
- `GOAL_CONTROL=admit-by-input`: the reads skip the owner rule. Must FAIL `c:own-only`.
- `GOAL_CONTROL=user-only-admission`: the reads check the user id alone, skipping org, tenant, the view's admission and the write-session drop. Must FAIL `c:own-only`.
- `GOAL_CONTROL=turns-deaf-to-request`: a session's turns hear no `request` notice (a scratch patch to `view-reads.ts`). Must FAIL `b:quiet`: the reply never shows as running, nor as done.

Not covered:
- **A coding worker running a scripted harness**, and with it the harness, review, landing and pull-request columns. Those are checked by `packages/harness-manager/test/coding-board.spec.ts`, against the harness kit's real install.
- **A cross-flow resolver**: a caller the roster flow admits whom the agent flow's own resolver refuses. Checked by `packages/engine/test/views-session-admission.test.ts`.
- **A work-project change.** What a row shows of it waits on the owner's decision.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-15 | origin/main src (88865c4fd3), goal from claude/fix-2725-impl-board | n/a | FAIL (red) | Loads nothing: main's roster flow has no session views (`SESSION_TURNS_VIEW` missing) |
| 2026-11-15 | claude/fix-2725-impl-board (pre-push) | n/a | PASS | a: new session 12 ms, first task on an empty board 77 ms, delete and recreate 28 ms · b: during 40 chunks, sessions 2, turns 1, board 0 view runs · c: 6 cases answered nothing, named no topic · d: no request |
| 2026-11-15 | claude/fix-2725-impl-board (pre-push) | n/a | FAIL (expected) | `unrecorded-session-reads`: `a:equals-store` only; the new session never reached the sessions screen within 3 s |
| 2026-11-15 | claude/fix-2725-impl-board (pre-push) | n/a | FAIL (expected) | `admit-by-input`: `c:own-only` only; bob's board and turns named alice's conversation's topics |
| 2026-11-15 | claude/fix-2725-impl-board (pre-push) | n/a | FAIL (expected) | `user-only-admission`: `c:own-only` only; alice's second-org session and her write session were named |
| 2026-11-15 | claude/fix-2725-impl-board, merged with sub-PR 1's Codex fixes (f7e8e63723), pre-push | n/a | PASS | a: 29 / 77 / 29 ms · b: 2 / 1 / 0 view runs over 40 chunks · c: 6 cases clean · d: no request. The board's own fallback dropped: the engine's `read` now hears an unanswered session on the caller's user topic. Controls re-run: each fails its own signal only (`unrecorded-session-reads` a, `admit-by-input` c, `user-only-admission` c) |
| 2026-11-16 | claude/fix-2725-impl-board (review round 1, pre-push) | n/a | FAIL (b) | `b:quiet` now also requires the reply to show. a, c and d pass. The reply showed running 23 ms after it started and completed 20 ms after it ended. But the sessions view ran 4 times (bound 3), in four runs out of four: twice at the reply's start (+1, +12 ms) and twice at its end (+1035, +1047 ms), none during the 40 chunks. Each lifecycle write wakes it on two topics: the list's user-topic `run` and the batched running read's session `request`. Under `turns-deaf-to-request` and `unrecorded-session-reads` it stays within 3. Open with the coordinator |
| 2026-11-16 | same | n/a | FAIL (expected) | `turns-deaf-to-request`: `b:quiet`, the reply never showed running or done · `unrecorded-session-reads`: `a` (and `b`) · `admit-by-input`, `user-only-admission`: `c` (and the same 4-run `b` as the base run) |
| 2026-11-16 | claude/fix-2725-impl-board, merged with bf330aeada (review round 2, pre-push) | n/a | PASS ×3 | Bound reshaped (the coordinator's decision, option b). b: sessions 4, turns 2, board 0 view runs at 40 chunks and the same at 120, in all three runs. Each reply showed running 21–31 ms after it started and completed 20–29 ms after it ended · a: 13–33 / 80–96 / 29–36 ms · c: 6 cases clean · d: no request |
| 2026-11-16 | same | n/a | FAIL (expected) | Each control fails its own signal only: `unrecorded-session-reads` fails a (the new session never reached the list); `admit-by-input` and `user-only-admission` fail c; `turns-deaf-to-request` fails b (neither reply showed running or done, at 40 or at 120 chunks) |
