# FIX-1788 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. The
*proved by* column is the check the plan runs. A human reviews this page; the plan turns it into
work.

## Holding a worker

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice hires a worker | One row is written in her user scope, in this org. Nothing is registered. Her next turn on any process can use it | CI · VG leg a, second host |
| BR-2 | Alice forks a standard worker | A new worker of hers, with a copy of its configuration and shared instructions, under a new id ([D3](DECISIONS.md#d3)). A later edit to the files doesn't change it. The standard worker is unchanged for everyone | CI · VG leg a |
| BR-3 | Anyone writes, edits or deletes a standard worker, by any path | Refused, naming it as standard and suggesting a fork | CI |
| BR-4 | Alice hires or forks with an id already on her roster, or a standard worker's id | Refused, naming the id. Bob's roster is not consulted | CI |
| BR-5 | Alice and Bob each hire `researcher` | Two workers. Neither sees the other's in any listing | CI · VG leg b |
| BR-6 | A hire's configuration names a flow that isn't a registered worker flow, or one kept for standard workers ([FIX-1789](https://linear.app/fixpoint-labs/issue/FIX-1789) BR-14), or fails the flow's schema | Refused when saved, with the flow's own reason. Nothing written | CI |
| BR-6a | A hire or fork grants a document or collection its flow doesn't declare | Refused when saved, naming it. Only a standard worker, in files, brings a collection its flow declares for it (the concept's "resources are declared on flows") | CI |
| BR-7 | Alice fires a worker | Its row is deleted. Its sessions stay readable to her, and a new turn on one is refused, naming the worker as fired. Every process sees it on the next turn | CI · two hosts |
| BR-8 | A hire, fork or fire finishes a turn | The view reloads after the turn (the existing floor, [FIX-1761](https://linear.app/fixpoint-labs/issue/FIX-1761)), and no tool name is treated specially | CI |
| BR-9 | Alice lists her roster | Her own workers and every standard worker, each marked standard or hers and naming the flow it runs on (`flow`). Nothing of Bob's, nothing from another org | CI · VG |

## A session's worker

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | Alice creates a session naming her worker, on the flow it names | The server checks it at create and links the session to it, in a field only the server writes. Every turn runs as that worker | CI · VG leg a |
| BR-11 | A create names a worker of Bob's | Refused with the same answer as a worker that doesn't exist. No session written | CI · VG leg b |
| BR-12 | A create names a worker of Alice's on another flow | Refused, naming both flows. No session written | CI · VG leg b |
| BR-13 | A turn's input carries `worker`, or any route tries to change a session's link | Refused, naming the field. The link never changes: another worker is another session | CI · VG leg b |
| BR-13a | Two `ensureWorkerSession` calls with the same criteria race | One session is created and both return it. Two plain creates make two sessions, each checked | CI |
| BR-13b | A create uses a derived worker-session id that belongs to another user | Refused. Nobody can take Alice's id before her first `ensureWorkerSession` | CI |
| BR-14 | A session on a worker flow is created with no worker, by the create, by an action on a session id that doesn't exist, or by `fsdev run` without `--worker` | Refused at the door, saying a worker must be named. No session written | CI · VG leg b |
| BR-14a | Alice calls `findWorkerSession({ worker })`, or lists with a `worker` filter | Her sessions linked to that worker, most recent first for the helper; none if there are none. Never another user's. The helper matches on the key set (S5a): it returns only sessions that carry no criteria key it did not name, so plain talk never lands in a delegate, task or workstream session. The list filter is not narrowed | CI · VG leg b |
| BR-15 | A session is created with caller state for the link or a server-written field | Refused with 400, naming the field. Nothing written | CI · VG control `caller-link` |
| BR-16 | A session is deleted and its id created again | The new session's link is what its own create named and passed. Nothing carries over | CI |
| BR-17 | Bob opens, reads or sends to a session of Alice's | Refused, as today (engine ownership) | Existing suite · VG leg b |
| BR-18 | A task or a mailbox post opens a session for a worker | It names the worker at create, through the same check as BR-10 to BR-12, on the session's user. The worker comes from the dispatching flow's code, never the post's fields | CI |
| BR-18a | A coordinator's session records its delegates after create | Held in server-written session state: flow code writes it, a caller can't (BR-15), and the link beside it stays fixed. FIX-1791 consumes it. Its delivery opens each delegate's session through `ensureWorkerSession`, with the worker and FIX-1791's coordinator-conversation key named; it can't post to a fresh id and rely on the turn (BR-14) | CI, on a fixture flow |
| BR-19 | A linked worker is fired | The turn is refused, naming it as fired. The session stays readable | CI |
| BR-19a | A linked worker's flow is no longer registered | The turn is refused. The session reads as a session of any unregistered flow reads today: this issue adds no engine read path (ER-22) | CI |
| BR-19b | Alice edits a worker to name a different flow | The link holds. A turn on a session created before the edit is refused, naming both flows. New sessions are created on the new flow: `ensureWorkerSession` finds none there and creates one at a new id | CI |
| BR-19c | Alice forks a worker she already has sessions with | The fork is a new worker with no sessions. Those sessions stay with the original | CI |

## What a worker runs with

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | Alice edits her worker | Her next turn on any session linked to it runs the edit. No restart | CI · two hosts |
| ~~BR-21~~ | A stored configuration from an older version loads | Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): nothing reads a configuration stored before this release | — |
| BR-22 | A configuration names a tool, skill or package the installation no longer registers | That turn is refused, naming it. The row is untouched | CI |
| BR-22a | A user's own worker names a flow that has since become kept for standard workers | That turn is refused with [FIX-1789](https://linear.app/fixpoint-labs/issue/FIX-1789) BR-15's sentence. The row is untouched: a flag flip must not lose a user's worker | CI |
| BR-23 | Two of Alice's workers on `agent` keep private notes | Each reads only its own. Same for every flow-isolated resource on every worker flow | CI · VG leg a |
| BR-24 | A worker's file grants it one document, read-only | Its model reaches that document and no other, and can't write it, on every turn | CI · the grants goal, rewritten |
| BR-25 | A worker reaches a resource another of Alice's workers wrote at user scope | Allowed: user scope is Alice's, shared by her workers (the concept's memory table) | CI |
| BR-25a | Two of Alice's workers on one flow write a shared resource | Each entry's `writtenBy` names Alice and, as `workerId`, the worker its session is linked to: two workers, two ids. The worker comes from the link, never the input ([FIX-1789](https://linear.app/fixpoint-labs/issue/FIX-1789) BR-20, D1) | CI |

## One copy per flow

| # | When | Then | Proved by |
|---|---|---|---|
| BR-26 | The app starts with workers on several flows | Each flow a worker names is registered once. No copy per worker, no owner pin | CI · V0 · VG leg a |
| ~~BR-27~~ | Code calls `register(flow, { pin })` or declares collection cardinality | Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): no deprecation note. Both stay in the engine untouched until FIX-1798 deletes them | — |

## Coming across from today

Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9). Nothing reads or moves a hire made before this release, so
there is no step for these rules to govern. The IDs stay so a reader who remembers one finds where it went.

| # | When | Then | Proved by |
|---|---|---|---|
| ~~BR-28~~ | The new code boots on a store with old hires, before the step | Removed | — |
| ~~BR-29~~ | The step meets a hire owned by Alice | Removed | — |
| ~~BR-30~~ | The step meets an org-wide hire | Removed | — |
| ~~BR-31~~ | A moved worker's id is already on that member's roster, or is a standard worker's id | Removed | — |
| ~~BR-32~~ | The step runs twice, or stops halfway | Removed | — |
| ~~BR-33~~ | An old hire names a flow that's gone | Removed | — |
| ~~BR-33a~~ | An old hire names a flow now kept for standard workers | Removed | — |

## Failure taxonomy

A refused create, a refused turn and a refused write change nothing and name why. A configuration
that fails on load refuses that turn only; the row and the session survive for a fix. Nothing
retries, and nothing is deleted except by a fire.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met) passes on a scripted model with two users
and two hosts, after the same run fails under `org-scoped-workers` and `caller-link`. The epic's
early leg-c run ([ER-30](../../epics/FIX-1786/BUSINESS-RULES.md#the-closure)) then runs on the
merge commit, in Shift Manager; that run is FIX-1797's.
