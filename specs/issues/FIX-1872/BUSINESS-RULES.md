# FIX-1872 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. The *proved by* column is the check the plan runs. "The goal" is the
check `SPEC.md` names; "rerun" is the five existing checks re-run after the change. Epic rules
are cited as ER-n.

## Handing a post on

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A post is routed, under any policy, in any round | One row per picked delegate, filed and started through the one dispatch path, assigned to that delegate. It is worked in that delegate's own session for this conversation, the one today's deliveries use, which later posts reuse | CI · the goal, leg a |
| BR-2 | The same delegate record is picked twice for one post in one round: the judgment turn hands it on twice, or a routing is replayed | One row. The second is recorded `skipped`, "it was already handed this post in this round" | CI · the goal, leg b |
| BR-3 | A row is filed and started | The routing record says `delivered`. A delegate the check refuses is `skipped` with today's reason; a row that can't be filed or started is `failed` with why. The record's shape doesn't change | CI · rerun |
| BR-4 | A post row is filed | It carries the post as written (or the answers going back out), who wrote it, the coordinator, the conversation's recent lines, its round and, below the limit, the round's deadline. All server-written, at the top level of the row, never in `metadata` | CI |
| BR-5 | The judgment turn hands a post on with `dispatchTask` ([D2](DECISIONS.md#d2)) | The model chooses `to` and, for a workstream, `target`. Anything else it sends for the task is refused, naming the two it may send | CI |
| BR-6 | A delegate is handed a post row | It is shown exactly what a post shows today: `<from>, through <coordinator>: <post>`, with the recent lines as a message of the conversation for that turn only | CI · the followup-context tests |
| BR-7 | A delegate that takes tasks but not posts is picked | `skipped`, with today's reason, and the judgment turn's refusal names the delegates that take posts ([D1](DECISIONS.md#d1)) | CI · rerun |

## Answers

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A post row completes | Its reply lands once as a line under the delegate's name, releases best fit's hold when that delegate held it, and is kept in its round when the round is open. It wakes no coordinator turn of its own; a round it closes sends answers on as today | CI · the goal, leg a |
| BR-9 | A post row fails, its run is cancelled, or the reply is empty | No line. The row counts as ended for its round, which closes if nothing else is out. It wakes no turn of its own, and never the generic "task failed" line | CI · the goal, leg d |
| BR-10 | A post row's ending is sent more than once: board touches, a lost first send, a restart | It is acted on once, while the row still owes it. One line | CI · the goal, leg b and its control |
| BR-11 | A second settle reaches a post row: a stale attempt, or a turn still running after a cancel | Refused by the claim ticket. Nothing lands | CI · the goal, leg b |

## Rounds and deadlines

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A delegate is still working when its round's deadline passes | Its post entry sends the conversation a wake: a plain message, no row, no once-only check. The conversation closes every overdue round. The delegate's turn runs on, and its answer lands once and goes no further | CI · the goal, leg d |
| BR-13 | A round is open | It notes the rows filed in it and which have ended, only to know when it can close. It never refuses an answer and is gone when the round closes | CI · review |
| BR-14 | A round closes | As today: when no routing is still adding to it and every row in it has ended, or at its deadline. What goes on in the next round is unchanged | CI · rerun |

## Workstreams

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | An ordinary task names a workstream's delegate record: `addTask`, `assignTask`, or `dispatchTask` with no post | Refused as today: "a workstream takes posts, not tasks" | CI · the goal, leg c |
| BR-16 | A post goes to a workstream's delegate record | The row carries the record's `target`. At hand-over it is resolved to the user's own existing session that the workstream's entry names, and worked there. None yet: the row fails with today's reason, and the record says `failed` | CI · the goal, leg c |
| BR-17 | A post row reaches a session | That session takes it only when it is this conversation's session for the delegate, or the session the record's target resolves to. Any other is refused | CI |

## What goes, and old data

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A coordinator worker's file names `handOff` in `tools:`, or a coordinator session saved before this change holds a ledger | The file is refused at load, naming `dispatchTask`. The saved ledger is ignored and dropped at the session's next write. A delegate flow that declares the post entry where the board can't reach it is refused when the coordinator is built, naming where it goes (BP-030) | CI |
| BR-19 | An answer or a report of none arrives for a delivery made before the upgrade | Refused: the entries it would land on are gone. Its round closes at its deadline | CI |
| BR-20 | A delegate session made before this change takes its next post | The same session, with its history. Nothing the row path needs is read from its birth state | CI |
| BR-21 | Someone cancels a post row on the board, or tries to reassign it | Cancel ends that delegate's part with no line, as BR-9; a turn still running can't settle it after (BR-11). Reassign is refused | CI |

## What it costs

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | `everyone`, 25 delegates, `rounds: 3`, ten posts: 1,000 rows on one board | Routing the tenth post files and starts its rows in at most twice the first post's time and under two seconds on SQLite, delegate turns excluded. The store's growth per post is reported | Bench · [PLAN V8](PLAN.md#checks) |

## Failure taxonomy

Nothing here is fatal to a conversation. A delegate that fails, is cancelled or is late costs its
own line and nothing else (BR-9, BR-12). A post that can't be filed is recorded `failed` and the
others go on (BR-3). Refusals at load (BR-18) stop the app from starting with a stale worker file.
Nothing retries a post: a failed post row has one attempt, as a delivery has today.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): its four legs pass, the reruns pass with
a diff of names and fence lines only, and the same run fails under `GOAL_CONTROL=no-ending-dedupe`
and at `main` before this change. Epic ER-5 and ER-6 are proved here; the closure reruns them.
