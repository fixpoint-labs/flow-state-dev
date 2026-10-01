# FIX-1650 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child spec and implementation satisfies, and where a cross-spec review
checks them. Each has one owner, matching [the ownership matrix](DECISIONS.md#who-owns-what).

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A project, its workstreams, stream, board and brief are read from what the Lab's tree declares, as Q1's answer defines it | FIX-1718 decides · FIX-1719 consumes | The closure's leg a |
| ER-2 | A workstream is a declared channel with its kind and the boards it holds. There is no Workstream type | FIX-1718 decides · FIX-1719, FIX-1720 consume | FIX-1719's spec review |
| ER-4 | Every hire and every fire is an approval the person answers; Deny changes nothing (pending Q2) | FIX-1719 decides · FIX-1621 consumes for retire and re-hire | The closure's leg b and its control |
| ER-5 | An orphan is a stored seat whose kind is not in the map the Lab boots with. It is named with the reason and repaired only on approval: retired, or re-hired onto a registered kind | FIX-1621 decides · FIX-1719 consumes | The closure's leg c |
| ER-6 | CoS and Ops are documents on the shipped `agent` kind and seat-hire capability, which a Lab opts into. A Lab that adds neither gets neither | FIX-1719 decides · FIX-1718 consumes | FIX-1719's spec review |
| ER-7 | Every hire, fire and repair lands in the organization the request's principal names, in that owner's cell. Single user; no org id is read from a body | FIX-1621 builds · FIX-1719 consumes | FIX-1621's tests · the closure |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-3 | Open, retire or invite to a channel at runtime | [D3](DECISIONS.md#d3). Owner: FIX-1719, where it would appear; FIX-1718 consumes |
| ER-8 | Remove a Shift Manager gap entry it does not fill, or change the shell's frame | FIX-1649 owns the frame; the issue that fills a surface replaces its entry and nothing else. Owner: FIX-1718 for the project entries |
| ER-10 | Add `workforce/projects/`, `workforce/agents/`, a `CHANNELS.md` convention, or an L1 Agent, Team, Channel, Project or Workstream | [D2](DECISIONS.md#d2) and the Architect's invent-kills |
| ER-11 | Add a CoS or Ops type, a second hire store, or a parallel ops taxonomy | Composed from existing seat and kind registers |
| ER-12 | Map a cut kind onto another kind, or register a missing kind so an orphan boots | FIX-1621's fences: no auto-migrate, kinds enter only through the boot map |
| ER-13 | Call a seat or an assignee a "worker" in a new product noun, or productize Kind | The Architect's vocabulary fence |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | FIX-1718's spec starts only after Jake answers Q1, and FIX-1719's only after Q2. FIX-1621 and the closure's QA plan start at the gate | [D1](DECISIONS.md#d1). An answer is recorded in *Decided in review* by an amendment before the held spec starts |
| ER-15 | An answer that needs a folder or an L1 type comes back to this epic as an escalation | [D2](DECISIONS.md#d2) |
| ER-16 | A cross-cutting question is raised to the epic coordinator, not decided in one child | The retained decisions are canonical; after merge, a change is a follow-up PR |
| ER-17 | Implementation starts when Jake schedules it, not when this spec merges | Not Cycle 1; [PLAN.md](PLAN.md#timing) |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-9 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a, b and c pass, and leg b fails under Deny, on one `main` commit with every bug an earlier run found fixed as a child of this epic | FIX-1720's goal check, real model, in a browser |
| ER-18 | The docs teach projects and the org seats as things a Lab declares, and the orphan repair as the answer to a refused seat | The publishers in [DOCS.md](DOCS.md#ownership) |
