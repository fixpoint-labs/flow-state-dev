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
| BR-2a | A project is created | It belongs to the organization and names no team. Its `workstreams` may come from any team, and a project spanning teams is the normal case. A project whose workstreams all sit in one team is allowed, and is not the default | Workforce spec: a row with workstreams from two teams · shell spec · goal, cross-team check |
| BR-3 | A row is created | With `create`, never an overwrite: an id already held, or `unassigned`, is refused, except that the same owner re-sending the same id gets the existing row back and it is re-bound (BR-8a). Its `members` include the creator | Workforce spec |
| BR-4 | A row is written with `workstreams` | Each id must be a declared channel in the inventory. Each is claimed first, by creating `workstream-claims/<channelId>` with `create`. The claim is one shared key, so a second project's claim is refused even when both write at once. Only after every claim lands is the row written. A refused claim fails the write, names the id, and releases the claims this write took. Removing a workstream deletes its claim | Workforce spec: two projects claiming one workstream at once |
| BR-5 | A workstream is in no row's `workstreams` | It belongs to no project (D3) | Shell spec · goal |

## The template and the talk session

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A talk template is declared | It's a template, not a channel: never opened at boot, never registered. The default is org-level, declared with the collection in `org/resources/projects.ts`. A team's `CHANNEL.md` marked `mintFor:` declares one for that team's projects. Its seats may name seats from any team. The bind refuses it, loudly and with every refusal reported together, in three cases: <br/>· the value names no collection <br/>· it declares `boards:` (D2) <br/>· a second template, at either site, names the same collection on the same kind | Binder spec, with a fixture of two teams' seats on one template |
| BR-7 | A `CHANNEL.md` declares no `mintFor:` | Exactly today (BP-030) | Every existing binder and Lab check, unchanged |
| BR-8 | A row is created inside a flow turn | The creator's talk session is minted by the reaction, holding `resourceId`, and the row lists it in `sessions`. The reaction is not atomic with the row | Workforce spec · goal |
| BR-8a | A row's owner has no entry in `sessions` (the mint failed or never ran) | The row is unbound, and the repair is idempotent: the owner's `join`, Shift Manager opening the project for its owner, or the owner re-sending the create binds it. No row stays unbound once its owner touches it | Workforce spec: a mint that fails after the row commits, then each repair path · shell spec |
| BR-9 | A row is created outside a turn | Nothing is minted. Members reach it through `join` | Workforce spec |
| BR-10 | `bind` names no row, or a session already bound to another row | Refused | Workforce spec |
| BR-11 | A member calls `join` | Their own talk session is minted and listed; a second `join` returns the one they have. A non-member's `join` binds nothing, and never adds them to `members` | Workforce spec · goal |
| BR-12 | A post wakes seats, or a session shows its charter | Seats and charter are read from the template's kind as built at the last boot, never from session state, so an edit lands on every project at the next restart (D2) | Workforce spec over a store that survives a restart |
| BR-13 | A talk session's state carries a `resourceId` | It grants nothing. A caller can write session state at create, so every room entry checks the row, never the state (BP-031) | Workforce spec: a session created with a forged `resourceId` by a non-member is refused · goal |
| BR-14 | A talk session calls `read` or `post` | Allowed only when the session's owner, as the engine recorded it, is in the row's `members`. Otherwise refused `not-a-member`, and nothing is written *(Q3)* | Workforce spec · goal, and its `no-gate` control |
| BR-15 | A line is posted | A `room-lines` row is created, never edited, with the next `seq`. Its `userId` is the session owner and never a field the caller sends. A seat's answer carries its `author`. Project talk lives in these rows only: no `channel-post` item is written for it, in any session | Workforce spec · goal |
| BR-16 | Several members post at once | Every post lands. The room retries the sequence counter after a lost race | Workforce spec · goal, and its `no-retry` control |
| BR-16a | Several windows or members join at once | `join` is keyed by `(projectId, userId)`, not by the calling session. It returns the session the row already lists for that user, so a second window adopts it. Otherwise it mints a session and appends it with the counter's retry. A mint that loses the race to an entry for the same user is discarded in favour of that entry. `sessions` never holds two entries for one user | Workforce spec: a parallel join burst, two members joining from two sessions each · goal |
| BR-16b | A line is allocated but not yet written, and a later one is written | No reader passes it. `room-seq/<projectId>` holds `next` and `committed`. A poster writes its line and then advances `committed` through every contiguous written line, by CAS. Reads return only `seq <= committed`. If a line is still missing after a grace period, the next poster creates a tombstone at its key with `create`. Then exactly one of the line and the tombstone exists, and `committed` moves on | Workforce spec: a read during a paused write returns nothing past the gap, then the line once written; with the watermark stubbed out, the read skips it |
| BR-17 | A session reads `after` a cursor | Committed lines with a greater `seq`, tombstones skipped, in order, at most one page, and the next cursor. Keys sort by `seq`, so a read starts after the cursor and never scans the room | Workforce spec · goal |
| BR-18 | A post wakes a seat | Once, under the poster: one seat conversation per person per room. The seat is given the room's recent lines, and its answer goes into the room for every member | Workforce spec · goal |
| BR-19 | Someone reads or posts into another person's talk session | 404, as for any session not theirs | Engine, unchanged; FIX-1729's N1 |
| BR-20 | The browser reads `room-lines` or `room-seq` directly | Refused: neither collection is readable by the browser | Workforce spec |
| BR-21 | The channel inventory is read | Only declared channels. No talk session is ever a row there | Inventory spec · goal |

## What Shift Manager shows

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | PROJECTS renders | Every row, by title, with its workstreams beneath; a project with none is still listed. Then No project with every workstream no row lists, only when there is one | Shell spec · goal |
| BR-23 | A project's Stream opens | For an owner whose row is unbound: the bind is repaired first (BR-8a). For a member with a talk session: the room, read through that session, on open, on focus and after their post's wake, with a composer. For a member without one: **Join**. For a non-member: a named state saying the conversation is for members *(Q1, Q3)* | Shell spec · goal |
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
- an id that's already held, by another owner;
- a workstream another project has claimed;
- a bad `bind`;
- a non-member's `read` or `post`.

A lost race on the sequence counter, the watermark or `sessions` is retried by the room. A failed mint leaves the row unbound until a repair (BR-8a).

**Read:** neither of these is an error:
- a stale workstream id is shown as gone;
- a tombstone in `seq` is skipped.

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
