# FIX-1788 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org; Carol is in another. The
*proved by* column is the check the plan runs. A human reviews this page; the plan turns it into
work.

## Holding a worker

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice hires a worker | One row is written in her user scope, in this org. Nothing is registered. Her next turn on any process can use it | CI · VG leg a, second host |
| BR-2 | Alice forks a standard worker | A new worker of hers, starting from its configuration, under a new id ([Q1](DECISIONS.md#q1) decides the shared instructions). The standard worker is unchanged for everyone | CI · VG leg a |
| BR-3 | Anyone writes, edits or deletes a standard worker, by any path | Refused, naming it as standard and suggesting a fork | CI |
| BR-4 | Alice hires or forks with an id already on her roster, or a standard worker's id | Refused, naming the id. Bob's roster is not consulted | CI |
| BR-5 | Alice and Bob each hire `researcher` | Two workers. Neither sees the other's in any listing | CI · VG leg b |
| BR-6 | A hire's configuration names a flow that isn't a registered worker flow, or fails the flow's schema | Refused when saved, with the flow's own reason. Nothing written | CI |
| BR-6a | A hire or fork grants a document or collection its flow doesn't declare | Refused when saved, naming it. Only a standard worker, in files, brings a collection its flow declares for it (the concept's "resources are declared on flows") | CI |
| BR-7 | Alice fires a worker | Its row is deleted. Its sessions stay readable to her, and a new turn on one is refused, naming the worker as fired. Every process sees it on the next turn | CI · two hosts |
| BR-8 | A hire, fork or fire finishes a turn | The turn names the worker collection it wrote, so a view reloads it ([FIX-1761](https://linear.app/fixpoint-labs/issue/FIX-1761)). No tool name is special-cased | CI |
| BR-9 | Alice lists her roster | Her own workers and every standard worker, each marked standard or hers. Nothing of Bob's, nothing from another org | CI · VG |

## A session's worker

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | Alice's first turn in a session names her worker, on the flow it names | The server links the session to it and runs the turn as it | CI · VG leg a |
| BR-11 | A first turn names a worker of Bob's | Refused with the same answer as a worker that doesn't exist. Nothing linked | CI · VG leg b |
| BR-12 | A first turn names a worker of Alice's on another flow | Refused, naming both flows. Nothing linked | CI · VG leg b |
| BR-13 | A later turn names a different worker | Refused. The link never changes. A later turn may omit the worker | CI |
| BR-14 | A turn arrives on a session with no link and names no worker | Refused, saying a worker must be named | CI |
| BR-15 | A session is created with caller state for the link | Refused with 400, naming the field. Nothing written | CI · VG control `caller-link` |
| BR-16 | A session is deleted and its id created again | The new session has no link | CI |
| BR-17 | Bob opens, reads or sends to a session of Alice's | Refused, as today (engine ownership) | Existing suite · VG leg b |
| BR-18 | A task or a mailbox post opens a session for a worker | The same check as BR-10 to BR-12, on the session's user. The worker comes from the dispatching flow's code, never the post's fields | CI |
| BR-19 | A linked worker is fired, or its flow is no longer registered | The turn is refused, naming why. The session stays readable | CI |

## What a worker runs with

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | Alice edits her worker | Her next turn on any session linked to it runs the edit. No restart | CI · two hosts |
| BR-21 | A stored configuration from an older version loads | It reads (BP-030), or the turn is refused naming the field. Never silently dropped | CI |
| BR-22 | A configuration names a tool, skill or package the installation no longer registers | That turn is refused, naming it. The row is untouched | CI |
| BR-23 | Two of Alice's workers on `agent` keep private notes | Each reads only its own. Same for every flow-isolated resource on every worker flow | CI · VG leg a |
| BR-24 | A worker's file grants it one document, read-only | Its model reaches that document and no other, and can't write it, on every turn | CI · the grants goal, rewritten |
| BR-25 | A worker reaches a resource another of Alice's workers wrote at user scope | Allowed: user scope is Alice's, shared by her workers (the concept's memory table) | CI |

## One copy per flow

| # | When | Then | Proved by |
|---|---|---|---|
| BR-26 | The app starts with workers on several flows | Each flow a worker names is registered once. No copy per worker, no owner pin | CI · V0 · VG leg a |
| BR-27 | Code calls `register(flow, { pin })` or declares collection cardinality | It works as before, with a deprecation note naming FIX-1798 | CI |

## Coming across from today

| # | When | Then | Proved by |
|---|---|---|---|
| BR-28 | The new code boots on a store with old hires, before the step | Old hires don't run. The boot reports how many wait for the step. Nothing is read across users or orgs | CI · VG leg c |
| BR-29 | The step meets a hire owned by Alice | It becomes her worker under its id. Its private cells move to the worker's key, and its sessions link to it | CI · VG leg c |
| BR-30 | The step meets an org-wide hire | A private copy for each member with a session on it ([D2](DECISIONS.md#d2)), each with that member's sessions. Members without one get none | CI · VG leg c |
| BR-31 | A copy's id is already on that member's roster | That member's copy is skipped and reported. Nothing overwritten | CI |
| BR-32 | The step runs twice, or stops halfway | The second run finishes the first and changes nothing done. The old rows stay | CI |
| BR-33 | An old hire names a flow that's gone | Reported, not moved | CI |

## Failure taxonomy

A refused link, a refused turn and a refused write change nothing and name why. A configuration
that fails on load refuses that turn only; the row and the session survive for a fix. A missing
step is not an error: old hires wait, reported. Nothing retries, and nothing is deleted except
by a fire.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met) passes on a scripted model with two users
and two hosts, after the same run fails under `org-scoped-workers` and `caller-link`. The epic's
early leg-c run ([ER-30](../../epics/FIX-1786/BUSINESS-RULES.md#the-closure)) then runs on the
merge commit, in Shift Manager; that run is FIX-1797's.
