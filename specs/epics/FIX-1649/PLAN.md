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

## The design hand-back is an input, not a child

Hand-back v1 is in [`assets/design/`](assets/design/DESIGN.md) and fixes the structure. Design
pass 2 takes [its open items](DECISIONS.md#design-pass-2) back to Claude Design with Jake; the
final hand-back is committed beside v1, linked on FIX-1649, and consumed by:

| Consumer | Takes from it | Before it arrives |
|---|---|---|
| **FIX-1655** | The App Lab theme's light and dark token values | Token names and neutral defaults, skin fixes at the source, the re-sync check; draft values from v1 and the ticket |
| **FIX-1662** | Final proportions, density and states' look for the frame and two levels | The sidebar, routes, the project and workstream levels, bindings and empty states, on the neutral defaults |
| **FIX-1664** | The same, for the task level | The task level's tabs, actions and inspector, bindings and empty states |

No child merges final visuals before the final hand-back is linked. A hand-back that moves what
v1 fixes is an amendment to this epic ([ER-10](BUSINESS-RULES.md#how-the-set-is-run)).

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1655** design system | spec → impl PR, theme values after the hand-back | The existing theme contracts · D2 · the refined design | The token set's neutral defaults beside the components; the private package with the App Lab theme and the mapping; skin fixes at the source of the registry components with fixed palette colours; the re-sync check | FIX-1662's final pass · the closure | Medium |
| **FIX-1662** App Lab shell | spec → impl PR, final pass after the hand-back | FIX-1655's token names · hand-back v1 · shipped react panels and ui components · a Lab's tree, org required | `labs/app-lab`: the sidebar, Jump to, the routes and the right panel's slot; the project and workstream levels and the workstream's panel; empty states | FIX-1664's build · the closure | Large |
| **FIX-1664** task view | spec beside FIX-1662's → impl PR after FIX-1662 merges, final pass after the hand-back | FIX-1662's routes and panel slot · FIX-1655's token names · hand-back v1 · the harness session's shipped reads and operations | The task level: Session, Diff, Checks, Brief; Interrupt, Hand off, Open PR; the composer's turn; the task inspector with the devtool trace link | The closure | Medium |
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
4. **All three merge** → the closure run, on one `main` commit. A finding is filed as a child
   of FIX-1649 that blocks FIX-1663; the whole plan runs again after the last fix merges.

The plan is written on the [open fork](DECISIONS.md#open)'s recommended answer;
[what changes under the kit](DECISIONS.md#if-kit) is stated with the fork.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The token names | FIX-1655 and FIX-1662 | 1655 names them in its spec; 1662 uses those names and never hardcodes a value |
| A reused component that won't take the skin | FIX-1655 and FIX-1662 | 1662 reports it; 1655 fixes it at its source and App Lab's copy is re-synced (ER-6) |
| The task route and the right panel's slot | FIX-1662 and FIX-1664 | 1662 names both in its spec and owns them; 1664 fills them and adds no route of its own |
| A write into a worker's session | FIX-1664 and FIX-1662 | 1664 names the shipped operation in its spec; 1662's `@worker` composer uses it, and neither adds another (ER-15) |
| An empty state a sibling fills | FIX-1662, FIX-1664 and FIX-1650 to 1652 | The shell keeps the surface and its address; the sibling supplies the content |

## Not children, deliberately

Listed once, with the reason for each, in [what stays as it is](SPEC.md#what-stays-as-it-is).

## Wrap

When ER-12 holds: the lessons pass, docs polish over the pages the children published, and the
outcome reported from Linear and the implementation PRs. Design changes go through a
follow-up PR, not a final status commit.
