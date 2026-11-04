# task-board › a settled task reaches the board

**Issue:** FIX-2429 (epic FIX-2367). Its spec's goal: `specs/issues/FIX-2429/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** On a long-lived host, a change to a conversation's task board, written by any session on any process, shows on every open view of that board within a second, and a view reads nothing between changes. Wherever push can miss a change, the same views keep a timer and miss nothing.

**Input:** Real `serve()` hosts on bound ports, behind a bearer-token sign-in, and real WebSocket clients. One user's conversation on a Workforce session board (`desk`, worker `lead`), whose turn runs no model: it files tasks for a handler delegate (`eng.doer`, which takes 1.5 s), files a plan step for itself (a 1.5 s step turn), or streams a 3 s reply that touches no task. Three board views of the conversation, each on its own client: the Teammates lab adapter's `watchTasks`, the claude-code-style lab adapter's `watchTasks` (the merged `listTasks_tasks` read, with no session stream beside it), and a live `BoardList`'s read (`client.subscribe` on `topic.session(id, { resource: "tasks" })`, `listCollectionItems` on mount and on each wake, at its 3 s fallback pace). Legs a and c run in memory, leg a on FIX-2426's crossing double (`goals/lib/crossing-bus.mts`); leg b runs two registries over one real Postgres (`goals/lib/postgres.mts`), each with its own Postgres bus. Held out: a second conversation of the same user, whose task settles during leg a's idle window and must not read the first's board; every id is stamped per run.

**Signal:**
- `a:within-1s` — each view shows the delegate's task `completed`, and the Teammates view its run's link, less than 1000 ms after the change can be read from the store (polled every 5 ms). The task settles in its own task session.
- `a:plan-step` — the claude-code-style view (the merged read) shows the conversation's plan step `completed` less than 1000 ms after the store.
- `a:0-reads` — over a 10 s window, starting once every view's socket said `crosses: true` and the views have sent no board read for 1 s (the reads their opening owed are done), with a task held open, each view makes 0 board reads (`/reads/listTasks_tasks`, `/resources/tasks`), while a reply streams in the conversation and the second conversation files and settles a task.
- `b:within-1s` — as `a:within-1s`, the task released and settled on process 2 (graded: the delegate ran there and nowhere else); the views are on process 1.
- `b:0-reads` — as `a:0-reads`, over 10 s from each view's first `crosses: true` frame (which on the Postgres bus waits for its first ping) and the views going quiet.
- `c:within-a-poll` — on a host with `push: false`, each view shows the task `completed` within its own poll interval plus 1 s (Teammates 1.5 s, claude-code-style 2 s, `BoardList` 3 s).

**Anti-game:** Not `publish` calls and not frames sent: every grade is what a view's own callback or read returned, timed against the store, or how many board reads its client's fetcher sent. The socket taps only time the start of the idle windows. Real sockets against bound ports, not an in-process fetch; two registries for leg b, not two clients of one. Each graded list is floored with `tell.over`. The `BoardList` view drives the call shape `BoardList` makes rather than rendering React in Node; that the component makes exactly that call (the narrowed topic, its pace, a read on mount and on each wake, coalesced) is proven by `packages/react/test/board-list.test.ts`. The plan step is graded on the claude-code-style view because the Teammates view also draws each `task-change` its conversation's own stream carries, which a step worked in the conversation's request would reach without any board notice.

**Model:** n/a, model-free (handler turns settle every task).

**Run:** `pnpm tsx goals/task-board/a-settled-task-reaches-the-board/run.mts`. `GOAL_LEGS=a,b,c` runs some legs. Leg b needs `initdb` and `pg_ctl`, or `FSD_DB_URL`.

**Controls:** each runs leg a with a scratch patch applied as the process loads (`goals/lib/module-patch.mts`).
- `GOAL_CONTROL=running-session` — the board notice goes on the session that wrote, not the one that filed. Must FAIL `a:within-1s`.
- `GOAL_CONTROL=whole-topic` — the two lab views subscribe the conversation's whole topic. Must FAIL `a:0-reads`.
- `GOAL_CONTROL=tasks-only` — the merged read's views subscribe `tasks` alone. Must FAIL `a:plan-step`.
- Today's `main` (the parent of this change) has no board notice and no `client.subscribe` in the labs, so this script doesn't load there; on it the claude-code-style list reads every 2 s whatever happens, which is what `a:0-reads` would catch. The three controls stand in for its red state.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-03 | fix/FIX-2429-board-notices (pre-commit) | n/a | FAIL | b: the Teammates view showed the run's link 2075 ms after the store. Its merge kept the conversation's own copy of a row over the board read's whenever the read named no `updatedAt`, which `listTasks` never does; leg a passed only because the read landed before the stream's copy. Fixed in the adapter (the read's fields win), with a regression test in `labs/teammates/test/run-link.test.ts` |
| 2026-11-03 | fix/FIX-2429-board-notices (pre-commit) | n/a | PASS | a: 0 reads in 10 s on 3 views (a reply streaming, another conversation's task settled); completed shown 96 / 44 / 16 ms, link 50 ms; plan step 48 ms · b (initdb): settled on p2, 0 reads in 10 s; shown 140 / 50 / 17 ms, link 31 ms · c: no push, shown 447 ms (bound 2500), 1966 ms (3000), 968 ms (4000) |
| 2026-11-03 | fix/FIX-2429-board-notices (pre-commit) | n/a | FAIL (expected) | `running-session`: `a:within-1s` only (Teammates showed the run's link 1661 ms after the store: the link is written in the run's session, so its notice went there; the ending still reached the conversation through the filer's own notice write) |
| 2026-11-03 | fix/FIX-2429-board-notices (pre-commit) | n/a | FAIL (expected) | `whole-topic`: `a:0-reads` only (Teammates 18 reads, claude-code-style 18 in 10 s) |
| 2026-11-03 | fix/FIX-2429-board-notices (pre-commit) | n/a | FAIL (expected) | `tasks-only`: `a:plan-step` only (the step never showed completed within 4 s) |
| 2026-11-03 | 531bf320d | n/a | FAIL | `b:0-reads`: claude-code-style made 1 read in the window. The read was its opening burst's last (the filing's notice and the Postgres bus's resync arrived after the sockets crossed), started the same millisecond the window did. The window now starts once the views have sent no read for 1 s, in both legs; 3 runs of leg b after that, all PASS |
| 2026-11-03 | 531bf320d + the quiet window (uncommitted) | n/a | PASS | a: 0 reads in 10 s on 3 views; completed shown 98 / 45 / 17 ms, link 25 ms; plan step 53 ms · b (initdb): settled on p2, 0 reads in 10 s; shown 142 / 52 / 15 ms, link 32 ms · c: no push, shown 416 ms (bound 2500), 1932 ms (3000), 930 ms (4000) |
| 2026-11-03 | 531bf320d + the quiet window (uncommitted) | n/a | FAIL (expected) | `running-session`: `a:within-1s` only (link 1527 ms) · `whole-topic`: `a:0-reads` only (18 and 18 reads) · `tasks-only`: `a:plan-step` only (never within 4 s) |
