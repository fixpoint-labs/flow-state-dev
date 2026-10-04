# FIX-1649 · Workforce lab shell: one app a Lab is used through, in one skin

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Epic · six issues and a closure · Workforce App Lab · Goal 1, validate through real usage
([`docs/objectives.md`](../../../docs/objectives.md)) · [FIX-1649](https://linear.app/fixpoint-labs/issue/FIX-1649)
· Cycle 2 candidate, not Cycle 1

**The design: [`assets/design/DESIGN.md`](assets/design/DESIGN.md).** Claude Design's hand-back
v1 (five screens, Sep 30, the last two adding Inbox and Tasks) fixes the structure this epic builds; each screen is walked through
beside the [wireframe](assets/wireframes/README.md) it replaced. It reads without the rest of this set.

**Amended 2026-10-01 ([ER-10](BUSINESS-RULES.md#how-the-set-is-run)): design v2's structure, in part.**
Jake's final hand-back, v2 ([PR #2605](https://github.com/fixpoint-labs/flow-state-dev/blob/fa1b85160b477ea7d58b73da3f6e2cc051914c87/specs/epics/FIX-1649/assets/design/v2/README.md)),
adds Chief of Staff as the landing view (FIX-1722), Roster with TEAMS as rows of status squares
(FIX-1723), and a live Day/Night switch in the sidebar (FIX-1725). v2's removal of the
workstream, task and project tabs is not adopted. What moved, and why: [EVOLUTION.md](EVOLUTION.md#amendment--2026-10-01--design-v2s-structure).
**One rule for the name:** App Lab now ships as **Shift Manager** (FIX-1706). Implementation
and the closure's legs use `labs/shift-manager` wherever this set says `labs/app-lab`; the
prose keeps "App Lab" as the product name it was approved under.

**Amended 2026-10-02 ([ER-16](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)): the epic
targets v2's look.** Asked whether the epic delivers v2's theme and base UI, the answer is now yes
for everything not blocked on a sibling's data: an audit of the shipped shell
([FIX-1737's copy](../../issues/FIX-1737/assets/GAPS.md)) found 110 gaps, 53 drawable now.
FIX-1736 makes the fonts load; FIX-1737 draws the rest and owns the check that compares each
screen with v2, which the closure runs as leg d. Rows waiting on FIX-1650 to 1652, the v1
structure kept above, and the registry parts stay out. What moved:
[EVOLUTION.md](EVOLUTION.md#amendment--2026-10-02--v2s-look).

**Amended 2026-10-04, at wrap: leg c as the closure checks it.** The closure (FIX-1663,
[#2709](https://github.com/fixpoint-labs/flow-state-dev/pull/2709)) passed on `01444863c` with
every control right. Leg c's sweep and control below now say what its goal check runs, and the
calls made during closure (Inbox's workstreams, ER-15's room writes) are recorded:
[EVOLUTION.md](EVOLUTION.md#amendment--2026-10-04--wrap). [The path](PLAN.md#the-path) is
redrawn as it shipped.

## Four teams, before and after

| A team that… | Today | After this epic |
|---|---|---|
| **uses a Lab day to day** (the owner, dogfooding) | Has kitchen-sink, a teach surface, and the devtool, a debugger. Neither is where a Lab is used | Opens App Lab on Chief of Staff: a shift summary and the Lab's chief of staff to talk to. From there, an Inbox of what waits on them, every task in flight, a Roster of who is on shift, on call or off shift, the projects and their workstreams, and a task's live session two clicks away |
| **builds the next Lab** (DevForce, then CyberForce) | Would write its own chrome, and reach channels, boards and runs its own way | Opens its Workforce tree in App Lab and writes no shell code ([D3](DECISIONS.md#d3)) |
| **reuses FSD UI in its own app** | Themes the navigator and panels through `--fsd-nav-*` and `--fsd-panel-*`; some `@flow-state-dev/ui` registry components use fixed palette colours rather than semantic tokens | One token set with neutral defaults skins every reused component; copies stay unedited |
| **owns a sibling horizon epic** (FIX-1650, 1651, 1652) | Needs a screen before anyone can see what it means | Fills a destination the shell already reaches |

**Why now.** Claude Design's first hand-back is in, and the structure it shows should be fixed
before anything is built. The build is a Cycle 2 candidate beside FIX-1650; Cycle PM schedules it.

## The goal, and how we'll know it's met

**A person can use a Workforce Lab from one app, reaching every surface the shell promises,
with reused FSD components in one skin that is not baked into FSD itself, and every screen in
design v2's look wherever a sibling's data doesn't decide it; and a second Lab opens in the same
shell with no shell code of its own.**

| Is it the right goal? | |
|---|---|
| **The real need** | Jake's PRD: app lab, design system, and nav across projects, workstreams, chat, attention and resources. The Architect's line: Labs share one app chrome and design system without a second product shell or new L1 nouns |
| **Smaller, and rejected** | "App Lab renders in the skin." FIX-1662 alone meets it, while a second Lab could still need its own chrome and a reused component could still carry App Lab paint in FSD |
| **Bigger, and not this epic's** | What projects and workstreams (FIX-1650), what a workstream holds: its Board, Brief and Results, with tasks and their states (FIX-1651) and attention (FIX-1652) *mean* · review and GitHub wake (FIX-1653) · the DevForce Lab product itself |
| **Not done if** | Every child is Done and the closure check hasn't run · a reused FSD component was restyled in App Lab, or a copy differs from its source · an App Lab skin value sits in an FSD package · a surface shows a model the shell invented · a Lab needs a wrapper, or opens with no org · final visuals merged before the final hand-back · a screen departs from v2's look on a row nobody waits on, or a font is named but not loaded |

```mermaid
flowchart LR
  A["App Lab · one main commit · a browser"] --> L1["leg a · the DevForce tree · the design's journeys"]
  A --> L2["leg b · the pentest tree · no shell code"]
  A --> L3["leg c · no App Lab theme loaded"]
  A --> L4["leg d · every screen against v2 · day and night"]
  L1 --> P["PASS · the epic's goal is met"]
  L2 --> P
  L3 -->|"no App Lab value on any swept part"| P
  L4 -->|"every element matches its v2 row"| P
  C["control · the tool card's copy with a hardcoded accent"] -.-> L3
  L3 -.->|"under the control"| F["must FAIL at c:tool, and only there"]
```

Leg c makes "not baked in" checkable; its control plants the failure it exists to catch. Leg d
makes "v2's look" checkable, with FIX-1737's controls.

| How we verify | |
|---|---|
| **Goal check** | The closure issue's goal check ([FIX-1663](https://linear.app/fixpoint-labs/issue/FIX-1663)), in a browser, on one `main` commit after every other child merges ([ER-12](BUSINESS-RULES.md#how-the-set-is-run)) |
| **Signal** | Leg a lands on Chief of Staff, App Lab's first screen, and walks the design's two journeys from there: **Inbox → an approval → Approve & run**, and it leaves Inbox and its card on every workstream's Stream that draws it together (the channel a post started it from, else every channel the store lists the asking seat in, per FIX-1662's BR-18; decided at closure, [EVOLUTION](EVOLUTION.md#amendment--2026-10-04--wrap)); **Tasks or the project board → a task → its Session**, with the task inspector beside it. Then every sidebar section, every tab at the three levels, the right panel at a workstream and at a task, and resources from Jump to are reached; a message to `@worker` in a workstream's composer arrives in that worker's session as a turn. Where FIX-1650 hasn't shipped projects, the project level passes on its named empty state and the second journey starts from Tasks or the workstream's Board. Leg b: the second tree opens through FIX-1662's load path and reaches the same surfaces, with no shell code of its own. Leg c: on a build with only the theme import removed, day then night, the computed colour, background, border and font of every swept part match no value the Shift Manager theme declares (a hit fails at `c:<part>`), and every swept part renders at least once per pass (`c:sweep`); FIX-1655's static check over `packages/**` finds none (`c:static`). Leg d (amended 2026-10-02): FIX-1737's goal check (`goals/shift-manager/it-draws-v2s-look/`) on the same commit over the DevForce tree and its own keyless desk Lab, day and night: both fonts loaded, every look-table row rendered, and every visible element matches its row in a v2 look table that cites v2's lines, outside the rows that wait on a sibling and the registry parts it lists |
| **Input** | The DevForce lab's tree (`goals/devforce-lab/lab/workforce/`) with a real model, under a real org; for leg b, the pentest lab's tree (`goals/pentest-lab/lab/workforce/`), the nearest to CyberForce in the repo. Kitchen-sink's tree stands in for neither |
| **Anti-game** | No asserting on a child's own tests. No App Lab code that names the second tree. No swept part left out, and no copy out of sync with its source |
| **Control that must fail** | `hardcoded-accent`, the tool card's copy given Shift Manager's accent as a literal: leg c must FAIL at `c:tool` and nowhere else. FIX-1737's three controls, each must FAIL leg d where it names: `drift` (one row rounded, one ID column in sans), `unclassified` (an element no row covers), `missing` (the Tasks ID column removed). Today's `main`: legs a, b and d fail, and leg c's static half stays green |

**Leg c's sweep, pinned once** (amended at wrap, [EVOLUTION](EVOLUTION.md#amendment--2026-10-04--wrap)):
the `@flow-state-dev/ui` registry cards Shift Manager draws, each found on the page that draws it:
the message, reasoning, tool, code block and ask cards (the ask in Inbox's detail and on the Stream),
and the devtool page the task inspector's trace link opens. Shift Manager mounts no
`@flow-state-dev/react` chrome, so no navigator, roster, board panel or seat detail is swept. A
pass that never draws a part fails at `c:sweep`; FIX-1664's `worker-session` control, which
points the run-lab's Session elsewhere, may turn `c:sweep` red beside its own `a2`; no control other
than these two may reach leg c.

## What's in the box

![What's in the box: App Lab with one sidebar, three centre levels and a contextual right panel; the design system's App Lab theme in light and dark over neutral token defaults; skin fixes at the source; FSD UI reused, not restyled; the invent-kills fenced off below](figures/end-state.svg)

The screens are [the design](assets/design/DESIGN.md). Inside the box is one app and one skin;
the fence is the PRD's invent-kills, drawn where a shell epic would drift.

## The set · as of 2026-09-30

A dated snapshot. Live state is Linear and the implementation PRs.

| Issue | What it delivers | Why the set needs it | Status |
|---|---|---|---|
| [FIX-1655](https://linear.app/fixpoint-labs/issue/FIX-1655) · design system | The token set's neutral defaults beside the components; a private package with the App Lab theme in light and dark, mapped onto the existing contracts; skin gaps fixed at the source; the re-sync check | The skin, and the proof it isn't paint on FSD ([D2](DECISIONS.md#d2)) | Todo · spec route (no Kind label, defaults to spec) |
| [FIX-1662](https://linear.app/fixpoint-labs/issue/FIX-1662) · App Lab shell | `labs/app-lab` over a Lab's tree, org required: the sidebar, the routes and the right panel's slot; the Inbox and Tasks screens; the project and workstream levels with their tabs and the workstream's panel; empty states for what siblings haven't shipped | The substance: where a Lab is used ([D1](DECISIONS.md#d1)) | Backlog · spec route |
| [FIX-1664](https://linear.app/fixpoint-labs/issue/FIX-1664) · task view | The task level inside FIX-1662's frame: Session, Diff, Checks and Brief; Interrupt, Hand off, Open PR; the composer's turn; the task inspector | Where a person watches and steers one worker ([D1](DECISIONS.md#d1)) | Backlog · spec route · blocked by FIX-1662 |
| [FIX-1722](https://linear.app/fixpoint-labs/issue/FIX-1722) · Chief of Staff | The landing view inside FIX-1662's frame: its sidebar entry, a shift summary drawn from the shell's reads, and a conversation with the Lab's CoS seat | Where a person starts, and talks to the operation rather than to one worker ([D1](DECISIONS.md#d1)) | Added Oct 1 · In Spec Review · [#2616](https://github.com/fixpoint-labs/flow-state-dev/pull/2616) |
| [FIX-1723](https://linear.app/fixpoint-labs/issue/FIX-1723) · Roster | The Roster page and its sidebar entries: TEAMS as rows of status squares, the footer counts; one status rule (on shift, on call, off shift) and slots in use | Who is working, who waits on the person, who is free ([D1](DECISIONS.md#d1)) | Added Oct 1 · In Spec Review · [#2614](https://github.com/fixpoint-labs/flow-state-dev/pull/2614) |
| [FIX-1725](https://linear.app/fixpoint-labs/issue/FIX-1725) · Day/Night switch | A sidebar switch that flips the theme's light and dark variants live; look only | v2 draws the switch | Added Oct 1 · direct route, no spec · In Review · [#2618](https://github.com/fixpoint-labs/flow-state-dev/pull/2618) |
| [FIX-1736](https://linear.app/fixpoint-labs/issue/FIX-1736) · fonts | Space Grotesk and IBM Plex Mono load from the design-system package, with a check that they loaded, not that they're named | v2's type; every look check rests on it | Added Oct 2 · direct route, no spec · blocks FIX-1737 |
| [FIX-1737](https://linear.app/fixpoint-labs/issue/FIX-1737) · v2's look | The 53 look, layout and content gaps drawable now, in four PRs; the check that compares each screen with v2 | The epic targets v2's look ([ER-16](BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)) | Added Oct 2 · spec route · blocked by FIX-1736 |
| [FIX-1663](https://linear.app/fixpoint-labs/issue/FIX-1663) · closure · **required** | The QA plan and runs on one `main` commit | Proves the whole | Backlog · blocked by FIX-1655, FIX-1662, FIX-1664, FIX-1722, FIX-1723, FIX-1725, and since Oct 2 FIX-1736 and FIX-1737 |

The design system has consumers beyond App Lab, so it is its own issue; why the shell splits at
the task level, and at Chief of Staff and Roster, is [D1](DECISIONS.md#d1).

## How the issues flow into each other

```mermaid
flowchart LR
  H["Claude Design · v2, the final hand-back"] -.->|"token values"| A["FIX-1655 · design system"]
  H -.->|"final layout"| B["FIX-1662 · App Lab shell"]
  A -->|"the token contract, by name"| B
  B -->|"routes and the panel slot"| C["FIX-1664 · task view"]
  B -->|"the frame and the sidebar"| K["FIX-1722 · Chief of Staff"]
  B -->|"the frame and the sidebar"| R["FIX-1723 · Roster"]
  A -->|"light and dark variants"| W["FIX-1725 · Day/Night switch"]
  R -.->|"on call, once it merges"| K
  A --> Z["FIX-1663 · closure · required"]
  B --> Z
  C --> Z
  K --> Z
  R --> Z
  W --> Z
  A -->|"the theme and its fonts"| FN["FIX-1736 · fonts"]
  FN --> V["FIX-1737 · v2's look"]
  B -->|"the screens it redraws"| V
  V --> Z
  S["FIX-1650 · 1651 · 1652 · sibling epics"] -.->|"meaning for the empty states"| B
  F["FIX-1719 · seats, CoS and Ops"] -.->|"seat data"| K
  F -.->|"seat data"| R
```

Dashed edges are inputs from outside the set: the final hand-back gates final visuals only
([ER-9](BUSINESS-RULES.md#how-the-set-is-run)), and the siblings gate nothing (they feed
FIX-1664's empty states the same way). FIX-1662 names FIX-1655's tokens in its spec but does not
wait for its merge; FIX-1664's spec runs beside FIX-1662's, and its build merges after it.
FIX-1722 and FIX-1723 build in FIX-1662's frame, which has shipped. FIX-1719 (the FIX-1650
epic) supplies the seat data both read; neither waits for it, since a Lab-declared seat stands
in until it lands. Within FIX-1722, only its ON CALL rail waits on FIX-1723, and it shows a
named gap until then; the rest of FIX-1722 does not wait. The closure waits on every child as a
whole, FIX-1725 included: Linear has each one blocking FIX-1663.

## What stays as it is

- **The tabs v2 removes** (workstream Brief and Results; task Diff, Checks and Brief; project
  Stream, Workstreams and Brief) and the actions it drops (Open PR, Pause stream, + Team,
  + Workstream): kept. The shell keeps those surfaces ([EVOLUTION.md](EVOLUTION.md#amendment--2026-10-01--design-v2s-structure)).
- **Kitchen-sink** stays the teach surface, and the **devtool** stays the debugger; App Lab
  links the devtool's trace rather than rebuilding it.
- **The wireframes** stay in [`assets/wireframes/`](assets/wireframes/README.md) as the history
  of what went to Claude Design; the hand-back replaced them as structure.
- **The theme contracts** (`--fsd-nav-*`, `--fsd-panel-*`, the registry's semantic tokens) and
  the registry's copy-in distribution: used, not replaced ([EVOLUTION.md](EVOLUTION.md)).
- **Related, deliberately not children:** FIX-1650 to 1652 (what the destinations mean) ·
  FIX-1653 (review and GitHub wake) · FIX-1637 (wake spine, a docs pointer only) · FIX-1455
  and FIX-1592 (kitchen-sink) · FIX-1407, FIX-1442 · the DevForce Lab product.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** every surface reached, one
skin not baked into FSD, v2's look wherever no sibling decides it, a second Lab with no shell
code. If wrong: we ship a shell only App Lab can use, skin FSD in App Lab's colours, or call
screens v2's that still read as v1.

1. **[D1](DECISIONS.md#d1) · The shell splits at the task level (FIX-1664) and at each later
   destination with reads of its own (Chief of Staff, FIX-1722; Roster, FIX-1723); the shell
   owns reach and look, the siblings own meaning.** If wrong: one more seam than the work needs,
   and a split child folds back into FIX-1662 at its spec.
2. **[D2](DECISIONS.md#d2) · One skin through the contracts FSD components already have: the
   chrome imported from `react`, registry components copied in and never restyled.** If wrong:
   the skin can't reach a look Claude Design asks for without changing a component's public API.

3. **[D3](DECISIONS.md#d3) · One app that opens any Lab; a Lab is the Workforce tree it
   opens.** Decided by Jake on Sep 30. If wrong: DevForce or CyberForce must ship as separate
   products, and extracting the chrome into a package is about one issue.

**Open: none.** Rules: [BUSINESS-RULES.md](BUSINESS-RULES.md).
Order, and where the hand-back sits: [PLAN.md](PLAN.md).
