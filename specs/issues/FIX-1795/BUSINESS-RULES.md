# FIX-1795 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Alice and Bob are users of org acme; Carol is in org globex. The
*proved by* column is the check the plan runs. Rules marked Q1 or Q2 are written for the
recommended answer and move with it.

## Publishing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice publishes a worker of her own | A template in acme's library: the worker's flow, instructions, team instructions, skill, tool, package and document names, the flow's own settings, a name, a description, version 1. It names Alice, and the worker too when a worker published it ([ER-11](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)). Her worker is unchanged | CI · VG leg a |
| BR-2 | Alice's worker has sessions, memory at any layer, or skills it wrote into its drawer | None of it is in the template. Only names cross | CI · VG leg a |
| BR-3 | Alice publishes a standard worker | Refused: every user already has it; fork it, then publish the fork. Nothing written | CI · VG leg c |
| BR-4 | Alice names a worker that isn't hers | Refused with the same answer as a worker that doesn't exist | CI |
| BR-5 | Alice's worker no longer passes the checks a save runs (its flow gone or kept for standard workers, its configuration refused) | Refused with that check's reason. Nothing written | CI |
| BR-6 | Alice and Bob each publish a template called `researcher` | Two templates, two ids from the server. The listing shows who published each | CI |
| BR-7 | Bob publishes his copy of Alice's template | A new template of Bob's. Alice's is unchanged | CI |
| BR-8 | A publish finishes a turn | The turn names the library as a collection it wrote, so a view reloads it. No tool name is special-cased ([ER-19](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do)) | CI |

## The library

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | Any member of acme lists the library | Every template in acme, each with its name, description, flow, version and who published it | CI · VG leg a |
| BR-10 | Carol lists her library | Nothing from acme. A user in both orgs sees each org's own library | CI · VG leg c |
| BR-11 | A caller writes a template through the app's resource routes | Not possible: only the library's own actions write templates | CI |

## Adding a copy

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | Bob adds Alice's template | A new worker of Bob's from the template's configuration, through [FIX-1788](../FIX-1788/BUSINESS-RULES.md#holding-a-worker)'s hire write and its save check. Its id is the one Bob gives, or the template's name. It records the template and version it came from. The turn names the roster as written | CI · VG leg a |
| BR-13 | Bob's copy runs | As Bob, in his sessions, with his own memory. It reads nothing of Alice's | CI · VG leg a |
| BR-14 | Bob adds the same template twice | Two workers. The second needs an id not on his roster; a taken id is refused, naming it (FIX-1788 BR-4) | CI |
| BR-15 | The template's flow is no longer registered, is kept for standard workers ([FIX-1789](../FIX-1789/BUSINESS-RULES.md#naming-a-flow) BR-14), or the flow refuses its configuration | Refused at add, naming the template and the reason. Nothing written | CI · VG leg c |
| BR-16 | The template grants a document or collection its flow doesn't declare | Refused at add, naming it (FIX-1788 BR-6a) | CI |
| BR-17 | Alice publishes her Codex, Claude and Cursor variants, and Bob adds all three | Three templates, three workers of Bob's. Each carries its own copy of the shared core instructions; none follows another | CI |
| BR-18 | A hire or an edit supplies a copy record of its own | Not taken from input: only adding and taking an update set it. It is never an access input, and it offers no update from a template the user can't read | CI |

## Updates

| # | When | Then | Proved by |
|---|---|---|---|
| BR-19 | Alice publishes her worker again onto her template | Version 2, naming Alice. Bob's copy is unchanged: his next turn runs version 1 | CI · VG leg b |
| BR-20 | Bob lists his roster after that | His copy is marked: version 2 exists, and whether he edited the copy since he took version 1 (Q2) | CI · VG leg b |
| BR-21 | Bob takes the update | His copy's configuration becomes version 2, through the same save check. Its id, sessions and memory stay ([D1](DECISIONS.md#d1)). His next turn runs version 2. The mark clears | CI · VG leg b |
| BR-22 | Bob edited his copy before taking the update | His edits are replaced, and the offer said so beforehand. Nothing merges | CI |
| BR-23 | Bob never takes it | His copy never changes | CI · VG leg b |
| BR-24 | Version 2 fails Bob's save check | The take is refused with the reason. His copy is unchanged | CI |
| BR-25 | Alice fires the worker her template came from | The template and every copy stay as they are. Alice can still remove the template, or publish another worker of hers onto it | CI |

## Changing and removing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-26 | Alice changes or removes her template | Allowed, under FIX-1793's "owner writes, org reads" rule (Q1) | CI |
| BR-27 | Bob changes or removes Alice's template, by any path | Refused by that rule (Q1). Who a template names is never what decides ([ER-11](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | CI · VG leg c |
| BR-28 | Alice removes her template | It leaves the library. Every copy keeps running, and its mark clears. A copy's record still names where it came from | CI |
| BR-29 | Alice no longer belongs to acme | Her templates stay. Nobody can change or remove them, short of an operator working on the store (Q1's price) | CI |
| BR-30 | A change or removal finishes a turn | The turn names the library as written | CI |

## Failure taxonomy

A refused publish, add, take or removal changes nothing and says why, naming the template or the
worker. A copy that its flow later refuses fails at its turn, as any worker does (FIX-1788
BR-22); its template is not consulted. Nothing retries, and nothing a user holds changes without
their action.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met) passes with three users across two orgs,
after the same run fails under `live-template` and `org-writes`.
[ER-10](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) holds for
every copy. The closure's leg a ([FIX-1797](https://linear.app/fixpoint-labs/issue/FIX-1797))
then copies a template in Shift Manager; that run is FIX-1797's.
