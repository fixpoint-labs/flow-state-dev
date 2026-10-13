# coordinators › one fence answers each post once

**Issue:** FIX-1872 (epic FIX-1870). Its spec's goal: `specs/issues/FIX-1872/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a coordinator's post to each delegate is one row on the conversation's board, and the board's one-time ending is the only thing that decides an answer counts. However often an ending is replayed, the answer lands one line. A post handed to the same delegate twice in a round is one row. A post whose row is cancelled while its delegate works lands nothing when the delegate finishes. A failed delegate's round closes at once; a late one's closes at its deadline, and its answer lands once and goes no further. The conversation's record holds no delivery ledger.

This check covers only what no other check does: the fence's edges and the deadline. Lines, rounds, routing and workstreams are proven by the reruns of the FIX-1791, FIX-1794 and FIX-1610 checks and the two project goals, which read these rows where they read the ledger.

**Input:** a tree written at run time: four delegates on a goal-local `helper` flow, their ids and order picked at run time, and four coordinators over them, `desk.all` (`everyone`, all four), `desk.judge` (`judgment`, the first two), `desk.late` (`everyone`, `rounds: 1`, the first two) and `desk.fails` (`everyone`, `rounds: 1`, the first and third). The real engine over a SQLite file and its HTTP router, driven through the shipped clients as Alice, in its own process (`host.mts`), with the round deadline at 2 s. Scripted, no model: a delegate answers `<worker> answers: <what it was handed>`, holds its answer 3 s on `[slow:<worker>]` and fails on `[fail:<worker>]`; the judgment turn hands a `[judge]` post to the first delegate twice. Every word is picked at run time.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- **b**: `b:rows` one post to `desk.all` is one post row per delegate on its board, each worked in the delegate's session and answered; `b:no-ledger` none of the four conversations' records holds a delivery ledger; `b:one-line` five touches of the board, fired as soon as the first ending is written and while the rest are owed, still leave one line per delegate's answer; `b:skipped` the judgment turn handing the first delegate the same post twice files one row, records it delivered then skipped, and lands one line; `b:stale-settle` a post's row cancelled through the board while its delegate holds its answer stays cancelled, and the answer lands no line when the delegate finishes.
- **d**: `d:failed` a delegate that fails its post writes no line, its row ends errored, and its round closes as soon as both delegates have ended, before the deadline; `d:late` a delegate still working at the deadline sees its round close then, and its answer lands once when it comes and is handed to nobody in round 1, which carries only the other delegate's answer.

**Anti-game:** the check writes no row, ending or session: every change goes through an action, as Alice, through the router. The rows and the conversations' records are read from the SQLite file, read-only, from the rows Alice owns; no route sends a client a board's rows with their server-written payload, and the coordinator exposes none of its record. The lines and routing records are read through the session route as Alice. The deadline and the failed round are read at the moment they happen from the engine's stores, read-only. The engine's request store is read only to wait until nothing runs.

**Controls:**

- `GOAL_CONTROL=no-ending-dedupe` patches the conversation's notice entry so it acts on every copy of a row's ending: neither the row's owed marker nor the conversation's record of endings already acted on stops a second copy. It must FAIL `b:one-line`, or the fence was never tested.
- `GOAL_COMMIT=<main before FIX-1872's second part>` must FAIL `b:no-ledger` and `b:rows`: posts there are ledger deliveries, not rows.

**Run:**

```
pnpm tsx goals/coordinators/one-fence-answers-each-post-once/run.mts
GOAL_CONTROL=no-ending-dedupe pnpm tsx goals/coordinators/one-fence-answers-each-post-once/run.mts
GOAL_COMMIT=<sha> pnpm tsx goals/coordinators/one-fence-answers-each-post-once/run.mts
```

## Runs

| Date | Commit | Model | Verdict | Notes |
|---|---|---|---|---|
| 2026-10-13 | b5b0fdf91 + this goal, uncommitted | none (scripted) | **PASS** | One post to everyone: 4 rows, one per delegate, each answered; 5 touches as the endings came in, one line per delegate; handed one delegate twice: one row, delivered then skipped, one line; cancelled mid-turn: the row stayed cancelled and the late answer landed nothing; a failed delegate: no line, round 0 closed 1761 ms before its deadline; a late delegate: round 0 closed at its deadline, its answer landed once and went no further |
| 2026-10-13 | the same | none (scripted) | FAIL (control `no-ending-dedupe`, expected), 3 of 3 runs | Only `b:one-line`: lines per delegate 6 to 9 each, every run. Leg d and the rest of leg b PASS |
| 2026-10-13 | 7ff0d4c0d (`main` before FIX-1872's second part), `GOAL_COMMIT` | none (scripted) | FAIL (expected) | `b:rows` no post rows on any board; `b:no-ledger` each conversation's record holds a delivery ledger (`desk.all`'s four deliveries, each with its token). Everything else red too: there are no rows to touch, cancel or read |
