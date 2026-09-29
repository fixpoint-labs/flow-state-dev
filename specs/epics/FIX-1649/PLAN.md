# FIX-1649 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to build
any piece; that's each issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n)
and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path, as of 29 September 2026, drawn in phases rather than dates because Cycle PM has not scheduled the build. An input lane for the refined design: wireframes go to Claude Design at the gate and come back before any final visuals. An input lane for the sibling epics, which nothing waits on. This epic spec in review, with the now line on it. FIX-1655: spec, then the token contract and neutral theme, then the App Lab theme values after the hand-back. FIX-1662: spec, then regions and bindings, then the final visual pass after the hand-back. FIX-1663: the QA plan written beside them, and its run after both merge. The critical path runs gate, the hand-back, the two final passes, the closure run](figures/path.svg)

Two lanes run side by side from the gate, and both split at the same wait: the refined design.
Everything structural starts at the gate; only the final look waits
([ER-9](BUSINESS-RULES.md#how-the-set-is-run)). So the hand-back, not either child, is the
critical path's long pole. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time.

## The design hand-back is an input, not a child

The wireframes in [`assets/wireframes/`](assets/wireframes/README.md) go to Claude Design with
Jake. The refined design he hands back is linked on FIX-1649 and consumed by:

| Consumer | Takes from it | Before it arrives |
|---|---|---|
| **FIX-1655** | The App Lab theme's token values | Token names, the neutral theme, skin fixes in reused components |
| **FIX-1662** | Final proportions, density and states' look | Regions, destinations, bindings, empty states, in the neutral theme |

Neither child merges final visuals before it is linked. If it moves what the wireframes fix,
that is an amendment to this epic ([ER-10](BUSINESS-RULES.md#how-the-set-is-run)).

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1655** design system | spec → impl PR, theme values after the hand-back | The existing theme contracts · D2 · the refined design | The private package: token set, neutral and App Lab themes, the mapping; skin fixes in the eleven registry components | FIX-1662's final pass · the closure | Medium |
| **FIX-1662** App Lab shell | spec → impl PR, final pass after the hand-back | FIX-1655's token names · the wireframes · shipped react panels and ui components · a Lab's tree, org required | `labs/app-lab`: four regions, five destinations, empty states, the devtool trace link | The closure | Large (D1's split trigger applies) |
| **FIX-1663** closure · required | spec (the QA plan) → runs until one is clean → PR | Both children merged, on one `main` commit · the DevForce lab tree, and the pentest lab tree for leg b | The committed browser check, a QA report, a child for every finding | The wrap | Medium, repeats per finding |

FIX-1655 carries no Kind label in Linear, so its route defaults to spec. FIX-1662 is a Feature;
FIX-1663 an Improvement.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-29) is the review-time snapshot; follow its
Linear links for live state. The build is a Cycle 2 candidate: Cycle PM decides when it starts.

## What unblocks what, from here

1. **This spec is approved and merged** → the wireframes go to Claude Design; FIX-1655 and
   FIX-1662 specs start in parallel; FIX-1663's QA plan is written beside them.
2. **The refined design is linked on FIX-1649** → FIX-1655 sets the App Lab theme values;
   FIX-1662 does its final visual pass. A structural change goes to an amendment first.
3. **Both merge** → the closure run, on one `main` commit. A finding is filed as a child of
   FIX-1649 that blocks FIX-1663; the whole plan runs again after the last fix merges.
4. **Jake answers the [open fork](DECISIONS.md#open) the other way** → leg b becomes a second
   app importing the chrome, and FIX-1662 grows a package export. No new child.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The token names | FIX-1655 and FIX-1662 | 1655 names them in its spec; 1662 uses those names and never hardcodes a value |
| A reused component that won't take the skin | FIX-1655 and FIX-1662 | 1662 reports it; 1655 fixes it where it lives (ER-6) |
| An empty state a sibling fills | FIX-1662 and FIX-1650 to 1652 | The shell keeps the destination and its address; the sibling supplies the content |

## Not children, deliberately

FIX-1650, FIX-1651, FIX-1652 (meaning of the destinations) · FIX-1653 (review and GitHub wake,
an adjacent Lab surface) · FIX-1637 (wake spine, a docs pointer only) · FIX-1455 and FIX-1592
(kitchen-sink) · the DevForce Lab product.

## Wrap

When ER-12 holds: the lessons pass, docs polish over the pages the children published, and the
outcome reported from Linear and the implementation PRs. Design changes go through a
follow-up PR, not a final status commit.
