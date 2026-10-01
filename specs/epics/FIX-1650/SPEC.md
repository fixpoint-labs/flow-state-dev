# FIX-1650 · Org primitives: one person runs a Lab's projects and people from Shift Manager

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

## Four teams, before and after

| A team that… | Today | After this epic |
|---|---|---|
| **runs a Lab alone in Shift Manager** (the owner, dogfooding) | PROJECTS lists every workstream on its own, and the project level shows four named empty states | Workstreams sit under the project they belong to; the project's Stream, Board, Workstreams and Brief read from the Lab's own tree |
| **needs one more seat, or one fewer** | Edits a `WORKER.md`, or writes and guards its own hire action, then restarts | Asks CoS. CoS hires on the spot; a fire it raises in Inbox and makes on Approve. Either survives a restart |
| **shipped a release that cut a kind** | The seat that ran it is refused at boot, named, and stays broken | Sees which seats lost their kind and why, and retires or re-hires each one on approval |
| **builds the next Lab** (DevTeam, then CyberForce) | Would invent its own idea of a project and of an admin seat | Declares its projects in its tree and opts into CoS as one document, writing no code for it |

**Why now.** Shift Manager shipped: its shell and task view are Done and its closure is
running. Its project level is drawn as named empty states that say "arrives with FIX-1650",
and since #2423 it waits on this epic for what a workstream is too. Under it, the hire plane is
finished (durable hire, plane isolation, the seat-hire capability), but nothing a person can
use rides on it. The spec work proceeds now; when the build runs is Jake's call
([PLAN.md](PLAN.md#timing)).

## The goal, and how we'll know it's met

**One person opens a Lab in Shift Manager, finds its workstreams under the projects the Lab
declares, and changes who works there by asking CoS, which hires on its own and fires on the
person's approval in Inbox, with every change surviving a restart, from what the Lab's tree declares, with nothing new in Layer 1, no new noun
and no second hire store.**

| Is it the right goal? | |
|---|---|
| **The real need** | Jake's PRD line: project, workstream-as-channel+flow, CoS + Ops defaults (hire/fire/channels), single-user; Jake has since made CoS the one admin seat ([Q2](DECISIONS.md#q2)). The Architect's fences: product framing over the tree, no new L1 noun, no `workforce/projects/` |
| **Smaller, and rejected** | "Projects render." FIX-1718 alone meets it, and the person still edits files and restarts to change who works there, which is the half of "org" a single user feels most |
| **Bigger, and not this epic's** | Multi-user orgs and the org subscription registry (FIX-1550) · opening and retiring channels at runtime (channel admin, parked: [D3](DECISIONS.md#d3)) · what sits on a workstream's board (FIX-1651) · attention (FIX-1652) · wake and principal (FIX-1637, FIX-1645) |
| **Not done if** | Every child is Done and the closure check hasn't run · a project needs a folder or a type of its own · a fire lands without the person's approval, a seat other than CoS hires, or a hire reuses a declared seat's id · a fired seat is back after a restart, or still listed under TEAMS · a seat whose kind is gone is mapped onto another kind without anyone asking |

```mermaid
flowchart LR
  A["Shift Manager · DevTeam profile · one main commit"] --> L1["leg a · the project level"]
  A --> L2["leg b · hire, then fire, through CoS"]
  A --> L3["leg c · a seat whose kind was cut"]
  L1 -->|"no project gap copy on screen"| P["PASS · the epic's goal is met"]
  L2 -->|"seat there, then gone, across restarts"| P
  L3 -->|"named, then retired on approval"| P
  C["control · Deny the fire"] -.-> L2
  L2 -.->|"under the control"| F["must FAIL · seat still present"]
```

Leg b is the one the smaller goal would skip. CoS hires without asking ([Q2](DECISIONS.md#q2)),
so the fire is where the person decides: denying it must leave the seat in place, which is what
makes its PASS mean the person still holds the hard-to-undo direction.

| How we verify | |
|---|---|
| **Goal check** | The closure issue's goal check ([FIX-1720](https://linear.app/fixpoint-labs/issue/FIX-1720)), in a browser over Shift Manager, on one `main` commit after every other child merges ([ER-9](BUSINESS-RULES.md#the-closure)) |
| **Signal** | Leg a: PROJECTS lists at least two projects with their workstreams beneath them, and each project's Stream, Board, Workstreams and Brief show the Lab's content, not a gap entry. Leg b: the person asks CoS for a second coder and, with no approval asked, TEAMS shows the seat, and still does after a restart; the person asks CoS to fire it, an approval appears in Inbox, Approve, and it is gone after the next. A process killed between the decision (CoS's hire, or Approve on the fire) and the change landing comes back with it either made or not yet made, the fire still asked, never half-made. Leg c: a stored seat whose kind the profile no longer registers is listed with the reason, retired on approval, and the next boot names no refused seat |
| **Input** | The DevTeam profile (`labs/shift-manager/teams/devteam`) with its tree carrying what FIX-1718 and FIX-1719 add, a real model, one org from the Lab's resolver. Leg c seeds its orphan by hiring a kind, then booting without it |
| **Anti-game** | No asserting on a child's own tests. No Lab code that names a project or CoS beyond the documents. No restart skipped |
| **Control that must fail** | Deny instead of Approve on the fire: leg b's "seat gone" must FAIL, the seat still present. The same hire ask in a Lab that did not opt into CoS: "seat appears" must FAIL. Today's `main`: all three legs FAIL |

## What's in the box

![What's in the box: projects in Shift Manager (FIX-1718, waits for Q1), the CoS org seat, hiring on its own and firing on approval (FIX-1719, Q2 answered) and orphan repair (FIX-1621, starts at the gate); composed from channels, boards, teams, the inventory, durable hire, the seat-hire capability, plane isolation and the agent kind; owned elsewhere: board contents, attention, wake, runtime channel admin, the org subscription registry; the invent-kills fenced off below](figures/end-state.svg)

One box is dashed because it waits on Jake's answer to Q1; Q2 is answered. Everything the
three compose already ships, and the fence is the Architect's invent-kill list, where an org epic would drift.

## The set · as of 2026-10-01

A dated snapshot. Live state is Linear and the implementation PRs.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-1718](https://linear.app/fixpoint-labs/issue/FIX-1718) · projects | A project as the tree declares it ([Q1](DECISIONS.md#open)); the project level and the PROJECTS tree filled; what a workstream is, written down | Half the goal: the shell's project level is empty | Backlog · spec route · **holds for Q1** |
| [FIX-1621](https://linear.app/fixpoint-labs/issue/FIX-1621) · orphan repair | Finds stored seats whose kind is gone, names the reason, retires or re-hires each on approval | Without it, a cut kind leaves a broken seat nobody can clear, and CoS would invent its own detector | Backlog · spec route · adopted from Workforce L2 |
| [FIX-1719](https://linear.app/fixpoint-labs/issue/FIX-1719) · Chief of Staff | One org admin seat a Lab opts into, booted from `org/workers/`; it hires on its own, fires on approval and calls FIX-1621's repair; other seats ask it by message | The other half: who works here, changed without a file edit | Backlog · spec route · Q2 answered 2026-10-01 · blocked by FIX-1621 |
| [FIX-1720](https://linear.app/fixpoint-labs/issue/FIX-1720) · closure · **required** | The QA plan and its runs on one `main` commit | Proves the whole | Backlog · blocked by FIX-1718, FIX-1621, FIX-1719 |

3 issues and a closure, none started. Why not two or four: [D1](DECISIONS.md#d1).

## How the issues flow into each other

```mermaid
flowchart LR
  Q["Jake · Q1"] -.->|"what a project is"| A["FIX-1718 · projects"]
  Q2["Q2 · answered · CoS hires unasked"] -.->|"the seat set and policy"| B["FIX-1719 · Chief of Staff"]
  R["FIX-1621 · orphan repair"] -->|"the orphan read"| B
  A --> Z["FIX-1720 · closure · required"]
  R --> Z
  B --> Z
  S["FIX-1649 · Shift Manager"] -.->|"the frame and its gap entries"| A
```

Dashed edges are inputs from outside the set. Jake's answer to Q1 holds FIX-1718's spec from
starting, not a build from merging; Q2 is answered; FIX-1621 starts at the gate. Shift Manager is shipped, so FIX-1718 fills
its frame without waiting on it.

## What stays as it is

- **Channels stay declared** on disk and opened at boot; a new workstream is a `CHANNEL.md`
  ([D3](DECISIONS.md#d3)).
- **The hire plane** (durable hire, plane isolation, the seat-hire capability) is composed, not
  rebuilt; degrade-by-name at boot stays the default until FIX-1621 ships.
- **Shift Manager's frame** stays FIX-1649's; this epic replaces only the gap entries it fills.
- **Related, deliberately not children:** FIX-1715 and FIX-1716 (Workforce EM's tracks), FIX-1717
  (a Claude thread's)
  · FIX-1651, FIX-1652, FIX-1653 · FIX-1637 and FIX-1645 · FIX-1550 · FIX-1415 and FIX-1341.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** projects from the tree,
and the roster changed through CoS, which hires on its own and fires on approval, single user. If wrong: we ship projects while the org's
people are still managed by editing files.

1. **[D1](DECISIONS.md#d1) · Three issues and a closure; only the two the open questions touch
   wait.** If wrong: CoS's own behaviour outgrows one issue and splits off, as FIX-1726 now has.
2. **[D2](DECISIONS.md#d2) · Project and workstream are product framing over what the tree
   already holds; nothing new in L1, no new folder.** If wrong: an answer to Q1 needs a type
   of its own, and that comes back here as an escalation.
3. **[D3](DECISIONS.md#d3) · Channels stay declared in this epic.** If wrong: a new workstream
   costs a file and a restart until channel admin ships.

**Open: one, for Jake.** [Q1](DECISIONS.md#open), what a project is, with a recommendation.
[Q2](DECISIONS.md#q2) is answered: CoS is the one admin seat and hires without asking; a fire still asks in Inbox,
my default for him to reverse. The seat set is pending his direct confirmation. Rules: [BUSINESS-RULES.md](BUSINESS-RULES.md). Order:
[PLAN.md](PLAN.md).

Epic · three issues and a closure · Workforce: Shift Manager · Goal 1, validate through real
usage ([`docs/objectives.md`](../../../docs/objectives.md)): one more goal check, the closure's,
in the corpus; a small part of the gap · [FIX-1650](https://linear.app/fixpoint-labs/issue/FIX-1650)
· not Cycle 1
