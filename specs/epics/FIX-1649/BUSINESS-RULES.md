# FIX-1649 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child spec and implementation must satisfy, and what a cross-spec review
checks. Each says who owns it and where it's checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | From App Lab's first screen a person reaches every sidebar section (NEEDS YOU, channels, ON SHIFT), every centre surface (stream, board, brief, results), the run inspector, and all five destinations, each destination one click from anywhere | FIX-1662 | The closure's leg a |
| ER-2 | Every reused FSD component takes its colours, type and spacing from one token set, through the theme contract it already has (`--fsd-nav-*`, `--fsd-panel-*`, the registry's semantic tokens) | FIX-1655 ([D2](DECISIONS.md#d2)) | FIX-1655's tests · the closure's leg c |
| ER-3 | The design system ships a neutral theme beside the App Lab theme, and no FSD package holds an App Lab value | FIX-1655 | The closure's leg c, with its control |
| ER-4 | A second Lab opens in the shell with no shell code of its own and no wrapper, and only under an org | FIX-1662 ([open fork](DECISIONS.md#open)) | The closure's leg b |
| ER-5 | A destination whose meaning its sibling epic hasn't shipped shows a named empty state that says what arrives; it never shows a model the shell invented | FIX-1662 | FIX-1662's spec review · the closure's gap sweep |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | No child copies an FSD component into App Lab to restyle it. A component that can't take the skin is fixed where it lives, by FIX-1655 | [D2](DECISIONS.md#d2). A fork drifts from every later FSD fix |
| ER-7 | No child adds an L1 noun (Agent, Team, Channel, MessageBoard, Project-as-required) or puts Workforce concepts into `core` or `engine`; the design-system package imports nothing from `@flow-state-dev/workforce` | Jake's layer rule. L1 offers generic hooks only |
| ER-8 | No Heartbeats, Paperclip or Grok Bot clone; no factory or Conductor shell; kitchen-sink is not the shell; no Thought Fabric attention for the attention destination; no `CHANNELS.md` and no `kind:` frontmatter; no second design system per Lab | The PRD's and the Architect's invent-kills, and D-12 |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-9 | No child merges final visual values (the App Lab theme's token values, the shell's final proportions) before Jake hands back the refined design from Claude Design and it is linked on FIX-1649. The token contract, the neutral theme, the regions and their bindings do not wait | Owner direction: wireframes first, the look from Claude Design |
| ER-10 | A hand-back that moves a region, a sidebar section or a destination away from what the wireframes fix is an epic amendment, made by a follow-up spec PR, not by either child | The wireframes' fixed half is the epic's decision, not a child's |
| ER-11 | A child's Linear state is mirrored when it changes; a cross-cutting question goes to the epic coordinator, not decided locally; routes default to spec | The epic wake derives state from Linear; fail-closed routing |
| ER-12 | The epic finishes only when FIX-1663 closes: a clean run on one `main` commit, every bug an earlier run found fixed as a child of this epic and retested | Surface without proof doesn't move Goal 1 |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-13 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a, b and c pass, and leg c fails under its control | FIX-1663's goal check, in a browser, real model |
| ER-14 | The docs teach skinning FSD components from one token set, and App Lab's README says how to open a Lab in it | FIX-1655 and FIX-1662's docs, per [DOCS.md](DOCS.md) |
