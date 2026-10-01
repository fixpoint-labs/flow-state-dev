# FIX-1649 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path, as of 30 September 2026, drawn in phases rather than dates because Cycle PM has not scheduled the build. An input lane for the design: hand-back v1 came back during review; design pass 2 runs from the gate to the final hand-back, a vertical line that gates final visuals only. An input lane for the sibling epics, which nothing waits on. This epic spec in review, with the now line on it. FIX-1655: spec, then the token contract, neutral defaults, skin fixes and the re-sync check, then the light and dark App Lab values after the final hand-back. FIX-1662: spec, then the frame and the project and workstream levels, then its final visual pass. FIX-1664: spec beside FIX-1662's, then the task level once FIX-1662's frame lands, then its final visual pass. FIX-1663: the QA plan written beside them, and its run after all three merge. The critical path runs the gate, design pass 2, the final passes and the closure run](figures/path.svg)

Three lanes run from the gate, and all split at the same wait: the final hand-back. Everything
structural starts at the gate, except the task view's build, which waits for FIX-1662's frame;
only the final look waits on design ([ER-9](BUSINESS-RULES.md#how-the-set-is-run)). So design
pass 2, not any child, is the critical path's long pole. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time.

The figure is the 30 September path. The 2026-10-01 amendment adds three lanes after it: FIX-1722
and FIX-1723 (spec, then build in the shipped frame) and FIX-1725 (built directly). They start
after the final hand-back, and the closure run now waits for them too.

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
| **FIX-1722** Chief of Staff | spec → impl PR, in the final look | FIX-1662's frame and its snapshot · Inbox's card and answer path · the shipped send path · the CoS seat (FIX-1719; a Lab-declared `chief-of-staff` seat until then) · FIX-1723's status rule once it merges | The landing view: its sidebar entry, the shift summary, the conversation with the CoS seat, the STREAMS and ON CALL rail | The closure | Medium |
| **FIX-1723** Roster | spec → impl PR, in the final look | FIX-1662's frame and snapshot · board rows and pending asks · the seat inventory (FIX-1719's org seats) | The Roster page, TEAMS as team rows of status squares, the footer counts; one status rule (on shift, on call, off shift) and slots in use, read by every screen that shows them | FIX-1722's ON CALL · the closure | Medium |
| **FIX-1725** Day/Night switch | direct → impl PR | FIX-1655's light and dark variants | The sidebar switch that flips the look live; look only | The closure | Small |
| **FIX-1663** closure · required | spec (the QA plan) → runs until one is clean → PR | Every child merged, on one `main` commit · the DevForce lab tree, and the pentest lab tree for leg b | The committed browser check, a QA report, a child for every finding | The wrap | Medium, repeats per finding |

FIX-1655 carries no Kind label in Linear, so its route defaults to spec. FIX-1662 and FIX-1664
are Features; FIX-1663 an Improvement.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-30) is the review-time snapshot; follow its
Linear links for live state. The build is a Cycle 2 candidate: Cycle PM decides when it starts.

## What unblocks what, from here

1. **This spec is approved and merged** → design pass 2 goes to Claude Design; the FIX-1655,
   FIX-1662 and FIX-1664 specs start in parallel; FIX-1663's QA plan is written beside them.
2. **FIX-1662 merges** → FIX-1664's build merges into its frame.
3. **The final hand-back is linked on FIX-1649** → FIX-1655 sets the light and dark values;
   FIX-1662 and FIX-1664 do their final visual passes. A structural change goes to an
   amendment first.
4. **Every other child merges** (FIX-1655, FIX-1662, FIX-1664, and since the 2026-10-01
   amendment FIX-1722, FIX-1723 and FIX-1725) → the closure run, on one `main` commit. A finding is filed as a child
   of FIX-1649 that blocks FIX-1663; the whole plan runs again after the last fix merges.

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

## Not children, deliberately

Listed once, with the reason for each, in [what stays as it is](SPEC.md#what-stays-as-it-is).

## Wrap

When ER-12 holds: the lessons pass, docs polish over the pages the children published, and the
outcome reported from Linear and the implementation PRs. Design changes go through a
follow-up PR, not a final status commit.
