# FIX-1723 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. *Held* means a task on an attached board that the seat holds
(the seat a row resolves to, as the boards already resolve it) and that is running or waiting
on you. *Pending ask* means an ask in Inbox whose session names the seat.

<a name="status"></a>
## Status

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A seat holds a running task | **On shift**, whatever else it holds or waits on | Unit · goal check |
| BR-2 | A seat holds no running task, and holds a task waiting on you or has a pending ask | **On call** | Unit · goal check (both causes, on separate seats) |
| BR-3 | A seat holds neither | **Off shift**, including a seat with only queued, errored or finished tasks | Unit · goal check (the queued seat) |
| BR-4 | A row still carries the legacy waiting word (`awaiting_review`) | Read as waiting on you, as the boards read it | Unit |
| BR-5 | A row's assignee resolves to no single seat, or an ask's session names no seat | Counts for no seat. Never shown against a guess | Unit |
| BR-6 | The sidebar, the workstream panel and Roster draw a seat | The same word for the same seat, from the one rule | Unit · goal check (sidebar against page) |

## The Roster page

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | Roster opens with All | Every seat in the inventory, once, in three groups in the order on shift, on call, off shift; an empty group is not drawn | Goal check |
| BR-8 | A team is picked, on the page or from its TEAMS row | Exactly that team's seats; the title names the team; the counts are that team's | Goal check |
| BR-9 | A worker row is drawn | Its name, team and kind; slots in use as a number and one square per held task; HOLDING as one chip per held task, each opening that task; waits-on as one entry per waiting task and per pending ask | Goal check |
| BR-10 | A seat holds nothing / waits on nothing | *nothing assigned* / a dash, as v2 draws them | Goal check |
| BR-11 | Any worker row is drawn | Standing watches carry the line that names FIX-1675; the harness carries its existing FIX-1652 line | Unit · goal check |
| BR-12 | The summary is drawn | *N on shift · M on call · K off shift · J waiting on you*, and when the Lab was read. N, M and K count the shown workers in each group. J counts the waits-on entries across the shown workers: each parked task they hold plus each pending ask of theirs, so one worker can add several, and an on-shift worker's waiting entries count too | Unit · goal check |
| BR-13 | The URL carries a team the inventory doesn't have | All, not an empty page and not an error | Unit |
| BR-13a | A seat's id has no dot (an org seat: CoS, Ops) | It sits in one **Staff** group, first, on Roster and in TEAMS, never in a one-seat team of its own | Unit · goal check |
| BR-13b | A seat's id is `<org>.<seatId>` for this Lab's organization (a hired seat) | It is grouped by the seat id that address holds, split the way Workforce splits it; a user-owned hired seat likewise | Unit |

## The sidebar

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | The sidebar draws | A Roster entry under Tasks with *on shift · on call* counts; the footer carries the same counts | Goal check |
| BR-15 | TEAMS draws | One row per team with its on-shift count over its seats, and one square per seat in that team's order, naming the seat and its status on hover | Goal check · the `it-opens-a-lab` TEAMS leg, re-pointed at the squares |
| BR-16 | A TEAMS row is clicked | Roster, filtered to that team, with the row marked current | Goal check |
| BR-17 | Jump to finds a worker | It opens Roster | Unit |

## When a read fails

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | The inventory did not load | Roster and TEAMS show the inventory's failure with Retry; no counts are drawn | Unit |
| BR-19 | One workstream's boards did not load | Roster draws, says which workstream's tasks it could not read, and counts no task from it. A seat's status is never raised or lowered by a guess | Unit |
| BR-20 | Asks did not load | Roster draws from the boards, and says on-call may be missing waits on you | Unit |

## Failure taxonomy

Nothing here is fatal and nothing retries by itself. Every failed read degrades to a named,
partial Roster with Retry, the way each section of the app already does.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): on a Lab of two teams with each state
built in, every worker's group, slots, holding and waits-on on Roster equal the Lab's store, for
All and each team, and the same run fails under each named control.
