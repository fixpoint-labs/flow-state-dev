# FIX-1718 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "Goal" is the goal check in
[SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met). Epic rules are cited as ER-n.

## What a workstream and a project are

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A channel is declared | It is a workstream: its id, its kind, its members and the boards it holds. There is no Workstream type (ER-2) | Docs; every rule below reads it so |
| BR-2 | A workstream's `CHANNEL.md` declares `project: <channel id>` naming another declared channel | That channel is a project, and the workstream is one of its workstreams | Binder spec · goal |
| BR-3 | No workstream names a declared channel | It is not a project. It is a workstream, listed under No project if it names none itself (D3) | Shift Manager spec |
| BR-4 | Workstreams in several teams name one project | All of them are its workstreams. A project crosses teams | Binder spec · Shift Manager spec |
| BR-5 | A project channel declares `boards:` | Its rows are on the project's Board, ahead of its workstreams' | Shift Manager spec |

## What boot checks

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A `CHANNEL.md` declares `project:` that is not text, or is empty | Refused by name; nothing registers. The other refusals are reported with it | Binder spec |
| BR-7 | `project:` names a channel the roster doesn't declare | Refused, naming the channel and the id it named (D2) | Binder spec |
| BR-8 | `project:` names its own channel | Refused (D2) | Binder spec |
| BR-9 | `project:` names a channel that itself declares `project:` | Refused: one level (D2) | Binder spec |
| BR-10 | A channel on a kind `defineChannelFlow` didn't build declares `project:` | Refused by name, as `boards:` is: only such a kind can carry the project to the row. A kind built with `defineChannelFlow` and passed under `kinds`, as the DevForce host does, carries it | Binder spec |
| BR-11 | A `CHANNEL.md` declares no `project:` | Exactly today: the binder, the session, and every check that ran before (BP-030) | Every existing binder and lab check, unchanged |
| BR-12 | `project:` is added, changed or removed, and the Lab restarts | The row carries the new value after that boot. The channel's session is untouched (D1) | Binder spec over a store that survives a restart |

## What the record says

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A channel registers in the inventory | Its row carries `project`, the id it names, or `null`. The value comes from the kind built at boot, never from the action's input (BP-031) | Inventory spec |
| BR-14 | A row was written before `project` existed | It reads as `null`: no project (BP-030). The next boot rewrites it | Inventory spec · Shift Manager spec |
| BR-15 | A browser reads the channel inventory | `project` is among the fields it gets (BP-015) | Inventory spec · goal |
| BR-16 | A seat reads `discover` | A workstream's entry names its project; a project's entry names the workstreams that name it. A seat joins a project by being in the project channel's `members:` (how FIX-1719's chief of staff joins) | Manifest-source spec |

## What Shift Manager shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | PROJECTS renders | Each project, by id, with its workstreams beneath it; then No project with every workstream that names none, only when there is one. A project channel is not listed among workstreams | Shell spec · goal |
| BR-18 | A project's Stream opens | The project channel's transcript, live, with the pending asks of its members; the composer posts to the project channel | Shell spec · goal |
| BR-19 | A project's Board opens | One swimlane per board-holding channel in the project, the project channel first, each in the workstream Board's columns. A workstream with no board shows no lane | Shell spec |
| BR-20 | A project's Workstreams opens | Each of its workstreams, linking to it, with its kind, members and boards | Shell spec |
| BR-21 | A project's Brief opens | The project channel's charter, as a workstream's Brief reads its own | Shell spec · goal |
| BR-22 | No project opens | Board and Workstreams list the workstreams under it; Stream and Brief each say that No project has no project channel, so there is no stream or brief to show | Shell spec |
| BR-23 | A route names a project id that is no project | A named state saying the Lab has no such project, linking to PROJECTS | Shell spec |
| BR-24 | A row names a project that has no row (its write failed) | The workstream is listed under No project, never dropped | Shell spec |
| BR-25 | The inventory read fails | PROJECTS shows its failed-read state with Retry, as today (FIX-1662 BR-4) | Existing shell spec, unchanged |
| BR-26 | Any project surface renders | No copy says a project "arrives with FIX-1650". The four project entries in `gaps.ts` are gone, and no other entry changed (ER-8) | Shell spec · goal |

## Failure taxonomy

Boot: every bad `project:` is a startup refusal collected with the binder's others, naming the
channel; nothing registers. Read: a row with no `project` is no project; a project with no
row is No project. Neither is an error. Nothing is retried by this issue.

## Acceptance criteria this issue owns

The goal: in the DevTeam profile, two projects with their workstreams and the four project tabs
from the project channel; `GOAL_CONTROL=unlinked` fails on the grouping. `discover` names the
project in its spec. The devforce-lab checks and Shift Manager's suites pass with the new tree. ER-1, ER-2,
ER-8 and ER-10 hold. [DOCS.md](DOCS.md)'s operations are published.

<a name="appendix--downstream-reads"></a>
## Appendix · Downstream reads

Not acceptance for this issue: what other screens consume, listed so their specs point here.

- **The channel row:** `{ id, kind, members, openedAt, project }`, `project` a channel id or
  `null`.
- **Shift Manager's `Workstream`:** gains `project: string | null`. A project is derived, never
  stored: the workstreams some row names, with the channels that name each one.
- **FIX-1719's chief of staff:** joins a project by its `members:` line on the project channel,
  and finds projects through `discover`.
- **Not carried:** per-participant sessions ([Not here](SPEC.md#not-here)), progress, results.
