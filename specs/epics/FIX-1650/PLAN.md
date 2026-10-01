# FIX-1650 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Sequencing, not building: what order the work runs in, what each issue takes and hands on. How
to build any piece is that issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md)
(D-n, Q-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

<a name="timing"></a>
## Timing is Jake's call

FIX-1650 is **not Cycle 1**: no pour until Cycle PM is ready (Jake, 2026-09-29). The spec work
runs now. When the children build is Jake's decision through Cycle PM, so the path below is in
phases, not dates, and merging this spec schedules nothing ([ER-17](BUSINESS-RULES.md#how-the-set-is-run)).

## The path

![The path in phases: Jake's answer to Q1 as an input lane, Q2 answered; this spec in review at the now line; FIX-1621's spec and build from the gate; FIX-1718's spec after Q1 and its build; FIX-1719's spec from the gate and its build after FIX-1621; the closure's QA plan written beside them and its run after all three; the critical path through FIX-1621, the FIX-1719 build and the closure run](figures/path.svg)

With Q2 answered, the critical path runs through FIX-1621 into FIX-1719's build: FIX-1719 is
the largest child, carrying the org-seat hire change, and the only one that consumes another. FIX-1621 is the one child that can start at the gate. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time to it.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1621** orphan repair | spec → impl PR | Durable hire (FIX-1475), plane isolation (FIX-1529), FIX-1611's degrade-by-name | The orphan read, its reason, retire and re-hire on approval; fire and retire as one path that removes the inventory row, older rows still read ([ER-19](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | FIX-1719 | Medium |
| **FIX-1718** projects | spec (after Q1) → impl PR | Q1's answer · channels, boards, teams · Shift Manager's frame and `gaps.ts` | A project as the tree declares it; the project level and PROJECTS tree filled; the workstream written down | The closure | Medium |
| **FIX-1719** Chief of Staff | spec (Q2 answered) → impl PR | Q2's answer · the `agent` kind, `createSeatHireCapability`, the inventory · FIX-1621's read · FIX-1718's project channel, if built first | CoS as one document a Lab opts into; a declared `org/workers/` seat booted in Layer 2 (the roster reader and a teamless id); CoS's unasked hire and approved fire, the only hire door ([ER-4](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), [ER-20](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)); the DevTeam profile opted in | The closure | Large |
| **FIX-1720** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit | The committed browser checks, a QA report, a bug child for every failure | The wrap | Medium, repeats per retest |

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-10-01) is the review-time snapshot; follow its
Linear links for live state. Inputs as of 2026-10-01: Shift Manager's shell (FIX-1662) and task
view (FIX-1664) are Done and their closure (FIX-1663) is in development; the hire plane
(FIX-1475, FIX-1529, FIX-1414) is Done; channel admin (FIX-1415) is a ratified explore, not
shipped.

## What unblocks what, from here

1. **This spec merges** → FIX-1621's spec and FIX-1720's QA plan start. Nothing builds until
   Jake schedules it.
2. **Jake answers Q1** → recorded in *Decided in review* by an amendment → FIX-1718's spec starts.
3. **Jake answered Q2** (2026-10-01) → recorded the same way → FIX-1719's spec starts once that
   amendment merges. Its build waits for FIX-1621 to merge.
4. **An answer needs a folder or an L1 type** → it comes back here as an escalation
   ([ER-15](BUSINESS-RULES.md#how-the-set-is-run)); nothing in the set changes until it is settled.
5. **All three merge** → the closure's first run. Each finding is a child that blocks FIX-1720,
   and the whole plan runs again after the last one merges.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The fired seat's inventory row | FIX-1621 and FIX-1719 | One mutation path for fire and retire ([ER-19](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)), so the second-path checklist is walked once |
| The orphan read | FIX-1621 and FIX-1719 | FIX-1621 owns it ([ER-5](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)); CoS calls it |
| CoS in a project's channel | FIX-1718 and FIX-1719 | FIX-1718 defines how a project is declared; FIX-1719's documents join it that way |
| `labs/shift-manager/src/gaps.ts` | FIX-1718 and sibling FIX-1651 | Each replaces only its own entries ([ER-8](BUSINESS-RULES.md#what-no-child-may-do)) |
| The approval card in Inbox | FIX-1719 and sibling FIX-1652 | CoS's ask on a fire is a `human_approval` suspension Inbox already renders ([ER-20](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)); what counts as attention stays FIX-1652's |
| The Workforce loader | FIX-1719 and Workforce EM's tracks | FIX-1719's org-seat read is additive; the teams-only readers keep their behaviour |
| The DevTeam profile's tree | FIX-1718 and FIX-1719 | Both add to it; whichever lands second adds, never rewrites |

## Not children, deliberately

FIX-1715 and FIX-1716 (Workforce EM's parallel tracks) · FIX-1717 (a Claude thread's) · FIX-1651 (what sits on a
workstream's board) · FIX-1652 (attention) · FIX-1653 · FIX-1637 and FIX-1645 (wake and
principal) · FIX-1550 (org subscription registry) · FIX-1415 and FIX-1341 (channel admin and
Collab mint) · FIX-1480 (the seat-hire explore). Linked, never re-parented.

## Wrap

When ER-9 holds: run the lessons pass, dispatch docs polish over the Workforce and Shift Manager
pages the children published, and report the outcome from Linear and implementation evidence.
A meaningful design change after merge is a follow-up PR from `main`.
