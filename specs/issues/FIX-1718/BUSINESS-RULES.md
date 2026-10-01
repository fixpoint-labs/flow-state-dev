# FIX-1718 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "Goal" is the goal check in
[SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met). Epic rules are cited as ER-n. Rules
marked *(baseline)* are the per-person conversation, and change if
[Q1](DECISIONS.md#q1) goes to a shared room (FIX-1729).

## What a workstream and a project are

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A channel is declared | It is a workstream: its id, kind, members and the boards it holds. There is no Workstream type (ER-2) | Docs; every rule below reads it so |
| BR-2 | A row exists in `projects/*` | It is a project. Its data lives only there: title, brief, status, owner, workstreams, sessions | Workforce spec · goal |
| BR-3 | A row is created | With `create`, never an overwrite: an id already held, or `unassigned`, is refused | Workforce spec |
| BR-4 | A row is written with `workstreams` | Each id must be a declared channel in the inventory, and listed by no other row. Otherwise the write is refused, naming the id | Workforce spec |
| BR-5 | A workstream is in no row's `workstreams` | It belongs to no project (D3) | Shell spec · goal |

## The template and the talk session

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A `CHANNEL.md` declares `mintFor:` | It's a template, not a channel: never opened at boot, never registered. Refused at bind, all reported together, when the value names no collection, or the file declares `boards:` (D2) | Binder spec |
| BR-7 | A `CHANNEL.md` declares no `mintFor:` | Exactly today (BP-030) | Every existing binder and Lab check, unchanged |
| BR-8 | A row is created inside a flow turn | The creator's talk session is minted from the template in the same turn, holding `resourceId`, and the row lists it in `sessions` | Workforce spec · goal |
| BR-9 | A row is created outside a turn | Nothing is minted. People reach it through `join` | Workforce spec |
| BR-10 | `bind` names no row, or a session already bound to another row | Refused | Workforce spec |
| BR-11 | Someone calls `join` on a project | Their own talk session is minted and listed; a second `join` returns the one they have *(baseline)* | Workforce spec |
| BR-12 | A talk session wakes its members or shows its charter | Read from the template's kind as built at the last boot, never from its state, so an edit lands on every project at the next restart (D2) | Workforce spec over a store that survives a restart |
| BR-13 | Someone reads or posts into another person's talk session | 404, as for any session not theirs *(baseline)* | Engine, unchanged; the spike's P3 and P6 |
| BR-14 | The channel inventory is read | Only declared channels. No talk session is ever a row there | Inventory spec · goal |

## What Shift Manager shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | PROJECTS renders | Every row, by title, with its workstreams beneath; a project with none still listed. Then No project with every workstream no row lists, only when there is one | Shell spec · goal |
| BR-16 | A project's Brief opens | The row's brief | Shell spec · goal |
| BR-17 | A project's Board opens | One lane per board-holding workstream, in the workstream Board's columns | Shell spec · goal |
| BR-18 | A project's Workstreams opens | Each listed workstream, linking to it. An id whose channel left the tree is shown as no longer in the Lab, without a link | Shell spec · goal |
| BR-19 | A project's Stream opens and the viewer has a session in its `sessions` | That session's transcript, live, with its composer | Shell spec · goal |
| BR-20 | The viewer has no session in `sessions` | **Join**, which calls `join` and opens what it returns. Another person's session is never linked *(baseline)* | Shell spec |
| BR-21 | No project opens | Board and Workstreams list its workstreams; Stream and Brief say No project has no conversation or brief | Shell spec |
| BR-22 | A route names a project id no row holds | A named state saying the Lab has no such project, linking to PROJECTS | Shell spec |
| BR-23 | The `projects` read fails | PROJECTS shows its failed-read state with Retry, as the inventory's does (FIX-1662 BR-4) | Shell spec |
| BR-24 | Any project surface renders | No copy says a project "arrives with FIX-1650". The four project entries in `gaps.ts` are gone, and no other entry changed (ER-8) | Shell spec · goal |

## Failure taxonomy

Boot: a bad `mintFor:` is a startup refusal collected with the binder's others. Write: a bad id
in `workstreams`, a held id or a bad `bind` is refused to the caller, and nothing is half
written. Read: a stale workstream id is shown as gone, never an error. Nothing is retried here.

## Acceptance criteria this issue owns

The goal, with both controls failing. The devforce-lab checks and Shift Manager's suites pass
on the new tree. ER-2, ER-8, ER-10 and ER-15 hold. [DOCS.md](DOCS.md)'s operations are published.

<a name="appendix--downstream-reads"></a>
## Appendix · Downstream reads

Not acceptance for this issue: what other screens and seats consume.

- **The project row:** `{ id, title, brief, status, ownerUserId, workstreams, sessions }`, as
  [PLAN pins it](PLAN.md#pinned-names).
- **Shift Manager's snapshot** gains `projects`, read once per refresh beside the inventory.
- **FIX-1719's chief of staff:** creates rows, sets `workstreams`, and joins, through the
  entries PR 1 ships. It reaches every project's conversation by being on the template's
  `members:` (D2).
- **Not carried:** a shared thread, progress, results, a Linear pointer.
