# FIX-1649 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child spec and implementation must satisfy, and what a cross-spec review
checks. Each says who owns it and where it's checked.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | App Lab opens on Chief of Staff. From there a person reaches every sidebar section (the org switcher, Jump to, Chief of Staff, Inbox, Tasks, Roster, PROJECTS with their workstreams, TEAMS as a row of status squares per team opening Roster filtered to it, the Day/Night switch), the Chief of Staff, Inbox, Tasks and Roster screens, every tab at each centre level (project: Stream, Board, Workstreams, Brief · workstream: Stream, Board, Brief, Results · task: Session, Diff, Checks, Brief), and the right panel at a workstream and at a task. The PRD's five destinations are reached as the tree and the tabs: projects and workstreams in the tree, chat as a workstream's stream and composer, attention as Inbox, every task in flight as Tasks, and resources from Jump to until [design pass 2](DECISIONS.md#design-pass-2) places it | FIX-1662 (the routes; FIX-1664 fills the task level, FIX-1722 Chief of Staff, FIX-1723 Roster and TEAMS, FIX-1725 the switch) | The closure's leg a |
| ER-2 | Every reused FSD component takes its colours, type and spacing from one token set, through the theme contract it already has (`--fsd-nav-*`, `--fsd-panel-*`, the registry's semantic tokens) | FIX-1655 ([D2](DECISIONS.md#d2)) | FIX-1655's tests · the closure's leg c |
| ER-3 | The token set's defaults are neutral values living beside the components that read them; the App Lab theme overrides them from outside FSD, and no FSD package holds an App Lab value | FIX-1655 | The closure's leg c, with its control, and its static check over `packages/` |
| ER-4 | A second Lab tree opens in App Lab with no shell code of its own and no wrapper, and only under an org. Its load path (the runtime Workforce loader or a per-Lab `fsdev gen` step) is FIX-1662's spec's call | FIX-1662 ([D3](DECISIONS.md#d3)) | The closure's leg b |
| ER-5 | A surface whose meaning isn't shipped (in Workforce, or by the sibling that owns it: [the table](DECISIONS.md#who-owns-what)) shows a named empty state that says what arrives, and an action with no shipped operation behind it is disabled and says the same; it never shows a model the shell invented | FIX-1662 | FIX-1662's and FIX-1664's spec reviews · the closure's gap sweep |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-6 | No child restyles an FSD component or hardcodes paint on it inside App Lab. Registry components arrive by `fsdev ui add` and stay unedited copies of their source; a component that can't take the skin is fixed at its source by FIX-1655 and re-synced, and FIX-1655's re-sync check fails on any App Lab copy that differs from its source | [D2](DECISIONS.md#d2). A restyled copy drifts from every later FSD fix, and a stale one makes leg c test the copy, not the skin |
| ER-7 | No child adds an L1 noun (Agent, Team, Channel, MessageBoard, Project-as-required) or puts Workforce concepts into `core` or `engine`; the design-system package imports nothing from `@flow-state-dev/workforce` | Jake's layer rule. L1 offers generic hooks only |
| ER-8 | No child builds anything below [the box's fence](SPEC.md#whats-in-the-box), and none adds `CHANNELS.md` or `kind:` frontmatter | The PRD's and the Architect's invent-kills, and D-12; the fence is their one list |
| ER-15 | No child writes into a worker's session except through that session's shipped operations: a turn from the task composer, a workstream's `@worker` or a reply from Inbox, Interrupt, Hand off. The shell writes no session item of its own and shows a message as delivered only when the session says so. Owned by FIX-1664; FIX-1662's composers (a workstream's, Inbox's reply) consume it | A second write path into a harness session is a model the shell invented; the stream's "sent into PAY-14" line must be the session's answer, not the shell's hope |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-9 | No child merges final visual values (the App Lab theme's light and dark token values, the shell's final proportions) before the final Claude Design hand-back is committed under [`assets/design/`](assets/design/DESIGN.md) and linked on FIX-1649. Hand-back v1 (Sep 30) fixes structure and may seed draft values; it is not final while [design pass 2](DECISIONS.md#design-pass-2) is open. The token contract with its neutral defaults, the levels and their bindings do not wait | Owner direction: the look from Claude Design; v1 came back with a correction and undrawn items |
| ER-10 | A hand-back that moves a level, a sidebar section, a tab or the right panel's content away from what hand-back v1 fixes, as amended for v2 on 2026-10-01, is an epic amendment (on this PR before merge, by a follow-up spec PR after), never a child's call | The structure is the epic's decision, not a child's |
| ER-11 | A child's Linear state is mirrored when it changes; a cross-cutting question goes to the epic coordinator, not decided locally; routes default to spec | The epic wake derives state from Linear; fail-closed routing |
| ER-12 | The epic finishes only when FIX-1663 closes: a clean run on one `main` commit, every bug an earlier run found fixed as a child of this epic and retested | Surface without proof doesn't move Goal 1 |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-13 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a, b and c pass, and leg c fails under its control | FIX-1663's goal check, in a browser, real model |
| ER-14 | The docs teach skinning FSD components from one token set, and App Lab's README says how to open a Lab in it, what each level and destination shows, and how to switch day and night | FIX-1655's, FIX-1662's, FIX-1664's, FIX-1722's, FIX-1723's and FIX-1725's docs, per [DOCS.md](DOCS.md) |
