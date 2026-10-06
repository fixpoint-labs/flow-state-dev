# FIX-1649 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The as-shipped path, 30 September to 4 October 2026; the detail is in the prose below](figures/path.svg)

Each bar runs from filed (or the gate) to merged. FIX-1655, FIX-1662 and FIX-1664, with the DevForce
lab prerequisites FIX-1666 to 1668, specced and built on 30 September. Closure run 1's findings
(FIX-1684, FIX-1688 to 1696) merged overnight, and FIX-1690's door into a running session on 1
October. Design v2 landed that evening, then FIX-1725, FIX-1722 and FIX-1723. The late fixes,
FIX-1730 to 1735, FIX-1747 and FIX-1749, landed on 2 and 3 October. The v2-look audit filed
FIX-1736, merged on 2 October, and FIX-1737, whose four slices landed early on 4 October beside
FIX-1650's FIX-1718 and FIX-1752. The closure ran until one run was clean, on `01444863c`, and
[#2709](https://github.com/fixpoint-labs/flow-state-dev/pull/2709) merged that day.

The long pole was v2's look, not the shell: the structure the 30 September plan named merged on
the first day, and the last three went to design v2, the look it set
([ER-16](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) and the closure's findings. The
plan's critical path ran through design pass 2 and the final passes; that held, with FIX-1736 and
FIX-1737 as the final pass. Four children filed under the
epic (FIX-1671, 1673, 1675, 1705) are not on the path and did not block the closure.

## The design hand-back is an input, not a child

Hand-back v1 is in [`assets/design/`](assets/design/DESIGN.md) and fixes the structure. Design
pass 2 takes [its open items](DECISIONS.md#design-pass-2) back to Claude Design with Jake; the
final hand-back is committed beside v1, linked on FIX-1649, and consumed by:

| Consumer | Takes from it | Before it arrives |
|---|---|---|
| **FIX-1655** | The App Lab theme's light and dark token values | Token names and neutral defaults, skin fixes at the source, the re-sync check; draft values from v1 and the ticket |
| **FIX-1662** | Final proportions, density and states' look for the frame, Inbox, Tasks and two levels | The sidebar, routes, Inbox and Tasks, the project and workstream levels, bindings and empty states, on the neutral defaults |
| **FIX-1664** | The same, for the task level | The task level's tabs, actions and inspector, bindings and empty states |

No child merges final visuals before the final hand-back is linked. A hand-back that moves what
v1 fixes is an amendment to this epic ([ER-10](BUSINESS-RULES.md#how-the-set-is-run)).

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1655** design system | spec → impl PR, theme values after the hand-back | The existing theme contracts · D2 · the refined design | The token set's neutral defaults beside the components; the private package with the App Lab theme and the mapping; skin fixes at the source of the registry components with fixed palette colours; the re-sync check | FIX-1662's final pass · the closure | Medium |
| **FIX-1662** App Lab shell | spec → impl PR, final pass after the hand-back | FIX-1655's token names · hand-back v1 · shipped react panels and ui components · a Lab's tree, org required | `labs/app-lab`: the sidebar, Jump to, the routes and the right panel's slot; Inbox and Tasks; the project and workstream levels and the workstream's panel; empty states | FIX-1664's build · the closure | Large |
| **FIX-1664** task view | spec beside FIX-1662's → impl PR after FIX-1662 merges, final pass after the hand-back | FIX-1662's routes and panel slot · FIX-1655's token names · hand-back v1 · the harness session's shipped reads and operations | The task level: Session, Diff, Checks, Brief; Interrupt, Hand off, Open PR; the composer's turn; the task inspector with the devtool trace link | The closure | Medium |
| **FIX-1722** Chief of Staff | spec → impl PR, in the final look | FIX-1662's frame and its snapshot · Inbox's card and answer path · the shipped send path · the CoS seat (FIX-1719; a Lab-declared `chief-of-staff` seat until then) · FIX-1723's status rule, for the ON CALL rail only, which shows a named gap until FIX-1723 merges | The landing view: its sidebar entry, the shift summary, the conversation with the CoS seat, the STREAMS and ON CALL rail | The closure | Medium |
| **FIX-1723** Roster | spec → impl PR, in the final look | FIX-1662's frame and snapshot · board rows and pending asks · the seat inventory (FIX-1719's org seats) | The Roster page, TEAMS as team rows of status squares, the footer counts; one status rule (on shift, on call, off shift) and slots in use, read by every screen that shows them | FIX-1722's ON CALL · the closure | Medium |
| **FIX-1725** Day/Night switch | direct → impl PR | FIX-1655's light and dark variants | The sidebar switch that flips the look live; look only | The closure | Small |
| **FIX-1736** fonts | direct → impl PR | The design-system package · v2's font link | Both families loaded from the design-system import, and a check that they loaded | FIX-1737 · the closure | Small |
| **FIX-1737** v2's look | spec → four impl PRs (a foundation with the check, then three screen slices) | FIX-1736's fonts · v2 · the shipped screens · the audit's 53 drawable rows | Every screen in v2's look where no sibling decides it; the screen-vs-v2 goal check, leg d | The closure | Large |
| **FIX-1663** closure · required | spec (the QA plan) → runs until one is clean → PR | Every child merged, on one `main` commit · the DevForce lab tree, and the pentest lab tree for leg b | The committed browser check, a QA report, a child for every finding | The wrap | Medium, repeats per finding |

FIX-1655 carries no Kind label in Linear, so its route defaults to spec. FIX-1662 and FIX-1664
are Features; FIX-1663 an Improvement.

## Where it ended

[The set table](SPEC.md#the-set--as-of-2026-09-30) is the review-time snapshot. The build was
planned as a Cycle 2 candidate; it ran from the gate on 30 September to the closure's merge on
4 October, as [the path](#the-path) shows. Linear and the implementation PRs hold the final state.

## What unblocked what, as it happened

1. **The spec merged** (30 September): the FIX-1655, FIX-1662 and FIX-1664 specs ran in parallel,
   with FIX-1663's QA plan beside them, and design pass 2 went to Claude Design.
2. **FIX-1662 merged**, and FIX-1664's build merged into its frame the same day.
3. **The final hand-back, v2, landed** (1 October): FIX-1655's light and dark values came with it.
   Its structural changes went to the 2026-10-01 amendment first (FIX-1722, FIX-1723, FIX-1725),
   and its look to the 2026-10-02 amendment (FIX-1736, FIX-1737).
4. **Every other child merged**, and the closure ran on one `main` commit, legs a to d. Each
   finding was filed as a child of FIX-1649 blocking FIX-1663, and the whole plan ran again after
   the last fix merged, until it was clean on `01444863c`.

The plan is written on [D3](DECISIONS.md#d3): one app, so no child builds a chrome package.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The token names | FIX-1655 and FIX-1662 | 1655 names them in its spec; 1662 uses those names and never hardcodes a value |
| A reused component that won't take the skin | FIX-1655 and FIX-1662 | 1662 reports it; 1655 fixes it at its source and App Lab's copy is re-synced (ER-6) |
| The task route and the right panel's slot | FIX-1662 and FIX-1664 | 1662 names both in its spec and owns them; 1664 fills them and adds no route of its own |
| A write into a worker's session | FIX-1664, FIX-1662 and FIX-1722 | 1664 names the shipped operation in its spec; 1662's `@worker` composer and Inbox reply, and 1722's CoS composer, use it, and none adds another (ER-15) |
| The sidebar | FIX-1662, FIX-1722, FIX-1723 and FIX-1725 | 1662 owns the frame; 1722 adds Chief of Staff above Inbox; 1723 adds Roster, the TEAMS rows and the footer counts; 1725 adds the switch. None touches another's entries |
| A worker's status | FIX-1723, FIX-1722 and FIX-1662 | 1723 pins one function for on shift, on call and off shift; 1722's ON CALL and 1662's workstream panel read it and never decide it again |
| Seat data | FIX-1719 (FIX-1650 epic), FIX-1722 and FIX-1723 | 1719 owns the seat inventory and the CoS and Ops seats; 1722 finds the CoS and 1723 groups seats by its addresses, adding no field |
| How an ask is drawn | FIX-1662 and FIX-1652 | One rendering per ask kind, shared by the stream's approval card and Inbox's detail pane; 1652 says what the kinds are and what Approve and Deny do |
| An empty state a sibling fills | FIX-1662, FIX-1664 and FIX-1650 to 1652 | The shell keeps the surface and its address; the sibling supplies the content |
| A row of v2's look a sibling unblocks | FIX-1737 and FIX-1650 to 1652 | FIX-1737 draws only rows nobody waits on; a sibling that ships a row's data draws it to v2 and adds its row to FIX-1737's look table |

## Not children, deliberately

Listed once, with the reason for each, in [what stays as it is](SPEC.md#what-stays-as-it-is).

## Wrap

When ER-12 holds: the lessons pass, docs polish over the pages the children published, and the
outcome reported from Linear and the implementation PRs. Design changes go through a
follow-up PR, not a final status commit.
