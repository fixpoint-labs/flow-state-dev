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
- `b:quiet`: during the 40-chunk reply, the sessions, turns and board views each run at most 3 times.
- `c:own-only`: in none of the six cases does a view answer anything or name a topic of the session asked for, and bob's sessions list holds none of alice's.
- `d:no-actions`: the store holds no more requests after three view runs than before.

**Anti-game:** Every assertion reads what the watching client reported, or the calls its own fetcher made, against the store. Nothing reads the recorder, the hearing list or a view's unit test. The poll is off.
**Model:** n/a (no model turn: the reply's chunks are stored by the goal, not generated).
**Run:** `cd goals && pnpm tsx views/screens-read-sessions-live/run.mts` (with `FSDEV_DEFAULT_MODEL` and `FSDEV_INTENT_*` unset)
**Controls:**
- `GOAL_CONTROL=unrecorded-session-reads`: `list` and `turns` record nothing (a scratch patch to `request-sessions.ts`). Must FAIL `a:equals-store`: a new session never reaches the list.
- `GOAL_CONTROL=admit-by-input`: the reads skip the owner rule. Must FAIL `c:own-only`.
- `GOAL_CONTROL=user-only-admission`: the reads check the user id alone, skipping org, tenant, the view's admission and the write-session drop. Must FAIL `c:own-only`.

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
