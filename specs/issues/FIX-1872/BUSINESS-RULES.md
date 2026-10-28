# FIX-1872 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. The *proved by* column is the check the plan runs. "The goal" is the
check `SPEC.md` names; "rerun" is the five existing checks re-run after the change. Epic rules
are cited as ER-n.

## Handing a post on

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A post is routed, under any policy, in any round | One row per picked delegate, filed and started through the one dispatch path, assigned to that delegate. It is worked in that delegate's own session for this conversation, the one today's deliveries use, which later posts reuse | CI · the goal, leg b · rerun |
| BR-2 | The same delegate record is picked twice for one post in one round: the judgment turn hands it on twice, or a routing is replayed | One row. The second is recorded `skipped`, "it was already handed this post in this round" | CI · the goal, leg b |
| BR-3 | A row is filed and started | The routing record says `delivered`. A delegate the check refuses is `skipped` with today's reason; a row that can't be filed or started is `failed` with why. The record's shape doesn't change | CI · rerun |
| BR-4 | A post row is filed | It carries the post as written (or the answers going back out), who wrote it, the coordinator, the conversation's recent lines, its round, the session it is worked in (BR-16, BR-17) and, below the limit, the round's deadline. All server-written, at the top level of the row, never in `metadata` | CI |
| BR-5 | The judgment turn calls `dispatchTask` with `post: true` ([D2](DECISIONS.md#d2)) | It hands on the post being routed. The model chooses `assignee` and, for a workstream, `target`; any other task field, `goal` among them, is refused, naming the two it may send. With a `goal` instead, the same call files an ordinary task in the coordinator's words. Off a routing turn, `post` isn't in the schema (FIX-1875 D2, BR-26) | CI |
| BR-6 | A delegate is handed a post row | It is shown exactly what a post shows today: `<from>, through <coordinator>: <post>`, with the recent lines as a message of the conversation for that turn only | CI · the followup-context tests |
| BR-7 | A delegate that takes tasks but not posts is picked | `skipped`, with today's reason, and the judgment turn's refusal names the delegates that take posts ([D1](DECISIONS.md#d1)) | CI · rerun |

## Answers

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A post row completes | Its reply lands once as a line under the delegate's name, releases best fit's hold when that delegate held it, and is kept in its round when the round is open. It wakes no coordinator turn of its own; a round it closes sends answers on as today | CI · rerun |
| BR-9 | A post row fails, its run is cancelled, or the reply is empty | No line. The row counts as ended for its round, which closes if nothing else is out. It wakes no turn of its own, and never the generic "task failed" line. *Amended after merge (FIX-2266):* a failure lands one line under the delegate's name, `<delegate> couldn't answer: <the error>`, once; still no turn and never the generic line. A cancel or an empty reply stays silent | CI · the goal, leg d |
| BR-10 | A post row's ending is sent more than once: board touches, a lost first send, a restart | It is acted on once, while the row still owes it. One line | CI · the goal, leg b and its control |
| BR-11 | A second settle reaches a post row: a stale attempt, or a turn still running after a cancel | Refused by the claim ticket. Nothing lands | CI · the goal, leg b |
| BR-23 | A delegate's turn on a post row runs longer than the row's lease | The claim gate on the post entry renews the lease from claim to the settle, as for any task. The board doesn't hand the row out again, and one line lands | CI |

## Rounds and deadlines

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A delegate is still working when its round's deadline passes | Its post entry sends the conversation a wake: a plain message, no row, no once-only check. The conversation closes every overdue round. The delegate's turn runs on, and its answer lands once and goes no further | CI · the goal, leg d |
| BR-13 | A round is open | The coordinator keeps only its deadline and that it is open. Each post row carries its round; whether every row in it has ended is read from the board, filtered by round. No list of rows or deliveries is kept in the coordinator's state | CI · review |
| BR-14 | A round closes | As today: when no routing is still adding to it and every row in it has ended, or at its deadline. What goes on in the next round is unchanged | CI · rerun |

## Workstreams

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | An ordinary task names a workstream's delegate record: `addTask`, `assignTask`, or `dispatchTask` without `post: true` | Refused as today: "a workstream takes posts, not tasks" | CI |
| BR-16 | A post goes to a workstream's delegate record | When the post is filed, as today, the record's `target` is resolved to the user's own existing session that the workstream's entry names. The row carries the `target` and that session, server-written, and is worked there. None yet: no row is filed, and the record says `failed` with today's reason | CI · rerun |
| BR-17 | A post row reaches a session | That session takes it only when it is the session written on the row. Any other is refused | CI |

## What goes, and old data

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A coordinator worker's file names `handOff` in `tools:`, or a coordinator session saved before this change holds a ledger | The file is refused at load, naming `dispatchTask`. The saved ledger is ignored and dropped at the session's next write. A delegate flow that still declares the post entry under `internal` is refused when the coordinator is built, naming `task` (BP-030) | CI |
| BR-19 | An answer or a report of none arrives for a delivery made before the upgrade | Refused: the entries it would land on are gone. Its round closes at its deadline | CI |
| BR-20 | A delegate session made before this change takes its next post | The same session, with its history. Nothing the row path needs is read from its birth state | CI |
| BR-21 | Someone cancels a post row on the board, or tries to reassign it | Cancel ends that delegate's part with no line, as BR-9; a turn still running can't settle it after (BR-11). Reassign is refused | CI |

## Failure taxonomy

Nothing here is fatal to a conversation. A delegate that fails, is cancelled or is late costs its
own line and nothing else (BR-9, BR-12); a failure says so in that line (BR-9 as amended). A post that can't be filed is recorded `failed` and the
others go on (BR-3). Refusals at load (BR-18) stop the app from starting with a stale worker file.
Nothing retries a post: a failed post row has one attempt, as a delivery has today.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): both its legs pass, the reruns pass with
a diff of names and fence lines only, and the same run fails under `GOAL_CONTROL=no-ending-dedupe`
and at `main` before this change. Epic ER-5 and ER-6 are proved here; the closure reruns them.
BR-22 (a row-cost bench) was cut in the restraint pass: epic D2 accepts the row per delegate, and
the round limit already bounds it.
