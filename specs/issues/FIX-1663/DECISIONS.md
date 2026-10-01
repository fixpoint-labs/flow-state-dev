# FIX-1663 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The [closure rule](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa)
fixes what the plan contains and in what order, and the epic fixes the legs, their inputs and
leg c's control ([FIX-1649 → How we verify](../../epics/FIX-1649/SPEC.md#the-goal-and-how-well-know-its-met),
[ER-12, ER-13](../../epics/FIX-1649/BUSINESS-RULES.md#the-closure)). These cards are the calls
left open. D1 and D2 are the sign-off; the rest are decided so nobody decides them on the day.

## The tree

```mermaid
flowchart TD
  I["FIX-1663"] --> D1["D1 · leg a on the DevForce tree · its two gaps filed now"]
  D1 -.->|"rejected · rewrites the epic's input"| X1a["walk the journeys on multi-seat-collab"]
  D1 -.->|"rejected · a known red, one run late"| X1b["let the first run find them"]
  I --> D2["D2 · the closure writes the pentest config from the README"]
  D2 -.->|"rejected · a child for one input file"| X2a["file the config as a child"]
  D2 -.->|"rejected · proves only what 1662 tested"| X2b["leg b on multi-seat-collab"]
  I --> E1["engineering · leg c builds Shift Manager without the theme import"]
  E1 -.->|"rejected · a product switch for a test"| X3["a no-theme switch in Shift Manager"]
```

Solid edges are what was chosen. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Leg a stays on the DevForce tree; the two journeys it can't produce today are filed now as children of FIX-1649 that block this issue

| | |
|---|---|
| **Instead of** | (a) Walking the design's two journeys on a tree that can produce them, such as `goals/multi-seat-collab/lab/`, which has a board with a parked row. (b) Leaving them for the first closure run to find |
| **Because** | The epic pins leg a's input to the DevForce tree and names both journeys as its signal. As the tree stands on `main`, neither can run on it: no seat, flow or stub in `goals/devforce-lab/lab/` raises an approval, so Inbox → Approve & run has nothing to answer; and its board is declared in the `coder` kind's code, not attached to the feature channel, so the workstream's Board and Tasks are empty (FIX-1662 flags this in its [PLAN → Follow-ups](https://github.com/fixpoint-labs/flow-state-dev/pull/2424) and gives it no owner). (a) passes leg a by rewriting the epic's input, which the Architect's guidance names as an invent-kill. (b) costs a full run to learn what we know now, and the fixes would start after every child has merged instead of beside them |
| **Locks in** | On approval, two children of FIX-1649 filed through `issue-manager`, each blocking this issue: **the DevForce tree raises an ask a person can approve, on a deterministic path** (a stub or seeded step, not a model choosing to ask), and **the DevForce feature channel carries the board its rows sit on** (FIX-1385's channel-attached direction). They change the goal lab's tree only, and its three existing checks stay green (part 3). Neither is DevForce the product. If FIX-1662 or FIX-1664 closes either gap first, that child is closed with a pointer |

**What would change my mind:** the owner saying the DevForce tree is evidence that must not grow,
and leg a's journeys may run on a second tree. Then the epic's input changes by amendment, not
here.

**What being wrong costs:** two small children the epic didn't plan, one of which may prove
unnecessary.

![D1: leg a on the DevForce tree with its two gaps filed now, chosen, beside walking the journeys on multi-seat-collab; decided by who changes the epic's input](figures/d1-devforce-gaps.svg)

It comes down to the epic's input: moving leg a to a tree that already works is a change only the
epic can make.

<a name="d2"></a>
## D2 · The closure writes the pentest Lab's host config, following Shift Manager's README and nothing else

| | |
|---|---|
| **Instead of** | (a) Filing the config as a child of FIX-1649. (b) Running leg b on multi-seat-collab, whose config already exists |
| **Because** | A Lab opens in Shift Manager through the one server config it already needs ([FIX-1662 D1](https://github.com/fixpoint-labs/flow-state-dev/pull/2424)), and FIX-1662 hands the pentest one to this issue. Writing it from the README is the "builds the next Lab" team's journey: if a person following the README can open a Lab Shift Manager has never seen, the promise holds; if they can't, the README is the finding. (a) is a child for one input file, and loses the journey. (b) proves only the tree FIX-1662's own check already ran on |
| **Locks in** | `goals/pentest-lab/lab/fsdev.config.mts`, host only, written by an isolated sub-agent that sees only Shift Manager's README and the pentest tree, never this spec or DevForce's config. Every step it had to guess, and every line that differs from DevForce's config for a reason other than the tree, is reported and filed. `labs/shift-manager` is untouched. The pentest lab's two existing checks stay green |

**What would change my mind:** the README naming a generator (`fsdev gen` or similar) that writes
the config. Then the closure runs the generator instead of writing the file.

**What being wrong costs:** a file written by the check it feeds, which could smooth over a gap in
the README; the writer's isolation, and its list of guessed steps, are what guard against that.

![D2: the closure writes the pentest config from the README, chosen, beside filing it as a child; decided by whether the README is tested](figures/d2-pentest-config.svg)

It comes down to the README: writing the file from it is the only way leg b tests what a Lab
author reads.

## Decided, not asked

- **Leg c builds Shift Manager a second time with only the theme import removed** (engineering call).
  Removing a stylesheet at the network fails once the bundler inlines it, and a no-theme switch
  in Shift Manager is product code written for a test. The patch is applied to a scratch copy of the
  commit, never committed, and its diff is in the report. If Shift Manager cannot build or render
  without that one import, that is a finding against FIX-1662.
- **The control `hardcoded-accent` plants Shift Manager's accent as a literal colour in Shift Manager's copy
  of the tool card**, in the same scratch way. It borrows FIX-1655's name so a reader knows it;
  the drift check going red under it too is reported, not graded.
- **Leg c reads light and dark**, started on `--shift day` and then `--shift night`. With no theme, the neutral defaults' dark values must carry no
  Shift Manager value either.
- **Leg c's value list is read from the design-system package**, every colour and font the
  Shift Manager theme declares in both variants, as FIX-1655's static check reads it, so it can't go
  stale.
- **The sweep is what Shift Manager promised to draw**: the message, reasoning, tool, code block
  and ask cards, found through its install list, plus the devtool trace page. Amended after merge;
  see [How it got here](#how-it-got-here).
- **Only a4's answer rests on the real model.** a1 to a3 raise their ask and board row through
  D1's children's deterministic paths, so a miss there is a shell finding, not model behaviour.
  The leg still runs under a real org with a real model set, as the epic's input says. The one
  real-model step is never retried: a missing answer is a finding, not flake.
- **The run waits for the final design hand-back** to be linked on FIX-1649 ([epic
  ER-9](../../epics/FIX-1649/BUSINESS-RULES.md#how-the-set-is-run)). Before it, the run is
  blocked, not failed.
- **FIX-1664's goal check and controls are read off its merged spec**, now
  `goals/shift-manager/it-shows-and-stops-a-task-run/`; this plan names no switch for it.
- **Docs get a smoke-follow:** Shift Manager's README by leg b, the token section by part 2. Corpus
  polish is the epic's wrap.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Kitchen-sink's tree for either leg | A teach surface; the epic and the Architect rule it out |
| Leg c by stripping CSS rules in the page after load | Grades a page the app never shipped; a rule left behind looks like a pass |
| Skip a child's check because a leg covers it | "Covers" becomes a judgement nobody can check |
| Fix a small gap inside the closure PR | A gap is a child of the epic, on its own route |

## Open / Settled

**Open: none.** Settled: none. No POC: the one premise the legs need but the children don't
prove, that the DevForce tree can't produce the two journeys, is read off the tree (the grep is
in [PLAN.md → At implement time](PLAN.md#at-implement-time)).

## How it got here

- **Draft** — the epic's legs on the trees it pins, one commit, one real-model leg; the two
  DevForce gaps FIX-1662 surfaced filed now rather than found late; the pentest config written
  from the README as the next-Lab team's journey.
- **Review round 1** — b0's writer made isolated (it sees only the README and the pentest tree),
  because a worker that has read this spec can't be the README's cold reader; the real model
  confined to a4's answer, with a1 to a3 on D1's deterministic paths, because a whole leg of
  model-dependent steps turns every miss into a full re-run; `optimistic-post` graded as the pair
  it fails (a4 and b's post), because the table and its caveat contradicted each other.
- **Amendment after merge** (Oct 1; original review
  [#2426](https://github.com/fixpoint-labs/flow-state-dev/pull/2426)), five calls already made
  elsewhere, recorded here so the closure re-run reads them off this spec. The goal, D1, D2, the
  controls and the rules for findings are unchanged.
  1. **Shift Manager.** The shell was renamed by
     [#2588](https://github.com/fixpoint-labs/flow-state-dev/pull/2588) on the owner's naming
     decision (mailbox #29): `labs/shift-manager`, `goals/shift-manager/`, the
     DevForce tree opened as the DevTeam profile (`--team devteam`), and `--shift day|night` for
     light and dark. Paths and commands now name it; the DevForce tree keeps
     `goals/devforce-lab/lab/`. The `teams/devteam` profile is the one Shift Manager file that
     points at that tree, so the anti-game line excepts it. Quotes in Notes from review keep the
     old name.
  2. **Leg c's sweep is the promised set**: message, reasoning, tool, code block and ask cards, and
     the devtool page. Shift Manager mounts no `@flow-state-dev/react` chrome, so the navigator,
     roster, board panels and seat detail aren't there to sweep; the task plan card and the
     twelve FIX-1655 fixes were never promised to draw. EM call recorded with FIX-1688/1689
     ([#2532](https://github.com/fixpoint-labs/flow-state-dev/pull/2532)) after closure run #1 at
     `899e059`. This narrows the epic's pinned sweep ([epic SPEC](../../epics/FIX-1649/SPEC.md#the-goal-and-how-well-know-its-met));
     see [Evolution](EVOLUTION.md).
  3. **a4 targets `eng.coder`'s running task session.** The seat has no session outside a task
     run; FIX-1690 shipped the door that puts a person's line there
     ([#2538](https://github.com/fixpoint-labs/flow-state-dev/pull/2538),
     [#2544](https://github.com/fixpoint-labs/flow-state-dev/pull/2544),
     [#2565](https://github.com/fixpoint-labs/flow-state-dev/pull/2565)), as
     [FIX-1690's evolution](../FIX-1690/EVOLUTION.md) asked of this spec.
  4. **Part 4's Inbox reply is graded on the test seat.** DevForce's EM takes no message, so its
     reply is disabled with its line, and the turn is proven on the fixture seat in FIX-1690's goal
     check. Decided in [FIX-1690's second fork](../FIX-1690/DECISIONS.md#open-inbox), merged with
     [#2525](https://github.com/fixpoint-labs/flow-state-dev/pull/2525).
  5. **a2 runs without `--devtool`.** Shift Manager serves the devtool in-process over the same
     Lab, so the trace link lands on in-memory runs
     ([#2531](https://github.com/fixpoint-labs/flow-state-dev/pull/2531), FIX-1691/1692).
