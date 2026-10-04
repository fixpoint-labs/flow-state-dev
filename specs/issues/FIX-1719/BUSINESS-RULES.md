# FIX-1719 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "Goal" is the goal check in
[SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met). Epic rules are cited as ER-n.

## Declaring an org seat

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A tree has `org/workers/<name>/WORKER.md` | The reader lists a seat with id `<name>`, and the app boots it with the team seats | Loader spec · goal |
| BR-2 | A tree has no `org/workers/` | Exactly today's roster. A Lab that doesn't add the CoS file has no CoS (ER-6) | Every existing loader and lab check, unchanged |
| BR-3 | A folder under `org/workers/` has no `WORKER.md`, is a symlink, or breaks the name rules | Reported in `errors` under its path, as the team walk reports it. Nothing else in the tree is lost | Loader spec |
| BR-4 | An org seat's `WORKER.md` declares a refused key | Refused by name, as for a team seat | Loader spec |
| BR-5 | An org seat is read | It gets org-level skills, packages and references, then its own folder's. No team level, no `TEAM.md` instructions | Loader spec |
| BR-6 | An org seat and a team seat share a folder name | Both load: `chief-of-staff` and `eng.chief-of-staff` are different ids | Loader spec |
| BR-7 | A document sits under `org/workers/<name>/resources/` | Its address names a seat that now exists. The published-tree check's unresolvable row for `build` is deleted | `published-tree-surface` |

## CoS changes the roster

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A person asks CoS for a seat of a kind the Lab allows | CoS hires it at once: a roster row in the person's own org cell, an inventory row, an address that answers. No approval is raised | Goal |
| BR-9 | CoS is asked for a kind the Lab does not allow, or does not register | Refused with the kinds it may hire. Nothing is written | Capability spec |
| BR-10 | CoS is asked to fire a seat it hired | A `human_approval` ask appears in Inbox naming the seat and its kind. Nothing changes yet | Goal · capability spec |
| BR-11 | The person approves | The seat is removed through FIX-1621's one path (ER-19): roster row, address and inventory row. Gone after a restart | Goal |
| BR-12 | The person denies | Nothing changes. CoS is told, and says so. The seat is listed after a restart | Goal's control |
| BR-13 | The process stops between the ask and the answer | After restart the ask is still in Inbox and the seat still runs. Approve then removes it (ER-20) | Capability spec over a durable store |
| BR-14 | CoS is asked to fire itself or a declared team seat | Refused: a declared seat is removed by editing its folder. No ask is raised | Capability spec |
| BR-15 | The Lab's list of changes that ask first includes `hire` | Every hire asks first, as BR-10 to BR-13 describe for fire. Seats already hired are untouched | Capability spec |
| BR-16 | A change that asks first runs in an app without durable execution | Refused by name, never run unasked | Capability spec |
| BR-17 | An action mounts the hire blocks directly, as an admin route does | Nothing asks: the person calling it already decided | Existing `seat-hire-blocks` suite, unchanged |
| BR-18 | CoS repairs a seat whose kind is gone, through FIX-1621's `rehire` | It always asks, whatever the list says (ER-5) | FIX-1621's suite, plus one case here |
| BR-19 | A request body names another org | Ignored. Every change lands in the principal's own cell (ER-7) | Existing `hire-plane` checks |
| BR-20 | A hire names a seat id a declared seat already has (`chief-of-staff`, or any `<team>.<name>`) | Refused by name before any row is written, so no hired seat shares a declared seat's name. Checked through the capability's existing `kindAt` on the bare id, where declared seats are registered | Capability spec |

## Who may ask for a change

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | Another seat wants someone hired or fired | It messages CoS through CoS's door, like any message. CoS decides, and a hire it makes follows BR-8, a fire BR-10. Nothing new carries the request | Lab spec: a seat's message to CoS that leads to a hire |
| BR-22 | A seat other than CoS tries to hire or fire | It holds no such tool: in the DevTeam tree only CoS's `tools:` names them, and an unnamed catalog tool is not callable (FIX-1393) | Goal: the coder holds no `hire` |
| BR-23 | A person asks CoS who is on a channel or what seats exist | It answers from `discover`: declared and hired seats, with their kinds | Goal |

## Failure taxonomy

Boot: an org seat that fails to load is reported beside team-seat failures; the Lab's host
already treats any as fatal. Hire: today's refusals, unchanged. Fire: a denial is a result CoS
reads, not an error. A change that asks first with no durable execution is a refusal at the
call, named. Nothing is retried by this issue.

## Acceptance criteria this issue owns

The goal: in the DevTeam Lab with the CoS template, CoS's hire lands with no ask, its fire lands
only on Approve, and both hold across restarts; `GOAL_CONTROL=deny-fire` fails on "seat gone".
CoS names the declared seats, and no other seat holds a hire tool. ER-6, ER-20 and ER-3 hold.
The four existing `devforce-lab` checks pass. [DOCS.md](DOCS.md)'s operations are published.

## Appendix · Downstream reads (FIX-1722/1723)

Not acceptance for this issue: what the Chief of Staff and Roster screens consume, listed so
their specs can point here. Nothing is a new field.

- **Seat inventory, per org:** `{ id, kind, door }`. Org seats keyed by bare name, no team;
  team seats `<team>.<name>`; hired seats `<org>.<seatId>`, split with `splitSeatAddress`. A
  fired seat has no row (ER-19).
- **CoS:** the template id `chief-of-staff`, reached through its door like any seat.
- **CoS's asks:** stock `human_approval` records; the `data` shape is pinned in
  [PLAN → Pinned names](PLAN.md#pinned-names).
- **Not carried:** shift status, slot use, "on call for". FIX-1723 derives the first two from
  board rows and runs; FIX-1637 owns wakes.
