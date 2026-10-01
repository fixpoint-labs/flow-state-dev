# FIX-1718 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "Goal" is the goal check in
[SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met). Epic rules are cited as ER-n. Rules
marked *(Q1)* or *(Q3)* hold under the recommended answer on Jake's card.

## What a workstream and a project are

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A channel is declared | It is a workstream: its id, kind, members and the boards it holds. There is no Workstream type (ER-2) | Docs; every rule below reads it so |
| BR-2 | A row exists in `projects/*` | It is a project. Its data lives only there: title, brief, status, owner, members, workstreams, sessions | Workforce spec · goal |
| BR-3 | A row is created | With `create`, never an overwrite: an id already held, or `unassigned`, is refused. Its `members` include the creator | Workforce spec |
| BR-4 | A row is written with `workstreams` | Each id must be a declared channel in the inventory, and listed by no other row. Otherwise the write is refused, naming the id | Workforce spec |
| BR-5 | A workstream is in no row's `workstreams` | It belongs to no project (D3) | Shell spec · goal |

## The template and the talk session

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A `CHANNEL.md` declares `mintFor:` | It's a template, not a channel: never opened at boot, never registered. Refused at bind, all reported together, when the value names no collection, or the file declares `boards:` (D2) | Binder spec |
| BR-7 | A `CHANNEL.md` declares no `mintFor:` | Exactly today (BP-030) | Every existing binder and Lab check, unchanged |
| BR-8 | A row is created inside a flow turn | The creator's talk session is minted from the template in the same turn, holding `resourceId`, and the row lists it in `sessions` | Workforce spec · goal |
| BR-9 | A row is created outside a turn | Nothing is minted. Members reach it through `join` | Workforce spec |
| BR-10 | `bind` names no row, or a session already bound to another row | Refused | Workforce spec |
| BR-11 | A member calls `join` | Their own talk session is minted and listed; a second `join` returns the one they have. A non-member's `join` binds nothing, and never adds them to `members` | Workforce spec · goal |
| BR-12 | A post wakes seats, or a session shows its charter | Seats and charter are read from the template's kind as built at the last boot, never from session state, so an edit lands on every project at the next restart (D2) | Workforce spec over a store that survives a restart |
| BR-13 | A talk session's state carries a `resourceId` | It grants nothing. A caller can write session state at create, so every room entry checks the row, never the state (BP-031) | Workforce spec: a session created with a forged `resourceId` by a non-member is refused · goal |
| BR-14 | A talk session calls `read` or `post` | Allowed only when the session's owner, as the engine recorded it, is in the row's `members`. Otherwise refused `not-a-member`, and nothing is written *(Q3)* | Workforce spec · goal, and its `no-gate` control |
| BR-15 | A line is posted | A `room-lines` row is created, never edited, with the next `seq`. Its `userId` is the session owner and never a field the caller sends. A seat's answer carries its `author`. Project talk lives in these rows only: no `channel-post` item is written for it, in any session | Workforce spec · goal |
| BR-16 | Several members post at once | Every post lands. The room retries the sequence counter after a lost race. A sequence number whose line was never written leaves a gap, and readers skip it | Workforce spec · goal, and its `no-retry` control |
| BR-16a | Several members join at once, or one member joins twice at once | Each member ends with exactly one talk session on the row, and no entry is lost. `join` returns the session the row already lists for that member; otherwise it mints, then appends with the same retry as the counter, and a mint that loses the race to its own member's earlier entry is discarded in favour of it | Workforce spec: a parallel join burst · goal |
| BR-17 | A session reads `after` a cursor | Lines with a greater `seq`, in order, at most one page, and the next cursor. Keys sort by `seq`, so a read starts after the cursor and never scans the room | Workforce spec · goal |
| BR-18 | A post wakes a seat | Once, under the poster: one seat conversation per person per room. The seat is given the room's recent lines, and its answer goes into the room for every member | Workforce spec · goal |
| BR-19 | Someone reads or posts into another person's talk session | 404, as for any session not theirs | Engine, unchanged; FIX-1729's N1 |
| BR-20 | The browser reads `room-lines` or `room-seq` directly | Refused: neither collection is readable by the browser | Workforce spec |
| BR-21 | The channel inventory is read | Only declared channels. No talk session is ever a row there | Inventory spec · goal |

## What Shift Manager shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | PROJECTS renders | Every row, by title, with its workstreams beneath; a project with none is still listed. Then No project with every workstream no row lists, only when there is one | Shell spec · goal |
| BR-23 | A project's Stream opens | For a member with a talk session: the room, read through that session, on open, on focus and after their post's wake, with a composer. For a member without one: **Join**. For a non-member: a named state saying the conversation is for members *(Q1, Q3)* | Shell spec · goal |
| BR-24 | Another member posts while the view is open | The line shows on the next read, not live | Shell spec |
| BR-25 | A project's Brief opens | The row's brief | Shell spec · goal |
| BR-26 | A project's Board opens | One lane per board-holding workstream, in the workstream Board's columns | Shell spec · goal |
| BR-27 | A project's Workstreams opens | Each listed workstream, linking to it. An id whose channel left the tree is shown as no longer in the Lab, with no link | Shell spec · goal |
| BR-28 | No project opens | Board and Workstreams list its workstreams; Stream and Brief say No project has no room or brief | Shell spec |
| BR-29 | A route names a project id no row holds | A named state saying the Lab has no such project, linking to PROJECTS | Shell spec |
| BR-30 | The `projects` read fails | PROJECTS shows its failed-read state with Retry, as the inventory's does (FIX-1662 BR-4) | Shell spec |
| BR-31 | Any project surface renders | No copy says a project "arrives with FIX-1650". The four project entries in `gaps.ts` are gone, and no other entry changed (ER-8) | Shell spec · goal |

## Failure taxonomy

**Boot:** a bad `mintFor:` is a startup refusal, collected with the binder's others.

**Write:** each of these is refused to the caller, and nothing is half written:
- a bad id in `workstreams`;
- an id that's already held;
- a bad `bind`;
- a non-member's `read` or `post`.

A lost race on the sequence counter or on `sessions` is retried by the room.

**Read:** neither of these is an error:
- a stale workstream id is shown as gone;
- a gap in `seq` is skipped.

## Acceptance criteria this issue owns

- The goal passes, and all four controls fail.
- The devforce-lab checks and Shift Manager's suites pass on the new tree.
- ER-2, ER-8, ER-10 and ER-15 hold.
- [DOCS.md](DOCS.md)'s operations are published.

<a name="appendix--downstream-reads"></a>
## Appendix · Downstream reads

Not acceptance for this issue. This is what other screens and seats consume.

- **The project row:** `{ id, title, brief, status, ownerUserId, members, workstreams, sessions }`,
  as [PLAN pins it](PLAN.md#pinned-names).
- **A room line:** `{ projectId, seq, userId, author, body }`, read only through a member's talk
  session.
- **Shift Manager's snapshot** gains `projects`, read once per refresh beside the inventory.
- **FIX-1719's chief of staff:** creates rows, sets `members` and `workstreams`, and joins,
  through the entries PR 1 ships. It reaches every project's room by being on the template's
  `members:` (D2).
- **Not carried:** live push, unread, invites, progress, results, a Linear pointer.
