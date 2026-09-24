# Core Blocks

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Core has four block kinds: handler, generator, sequencer, router. This project owns any kind added
after them, and the utilities that compose one. Right now that means one kind, `evaluator`, and one
utility, `cascadingRouter`.

## The outcome

| | |
|---|---|
| **Winning when** | An author asks a model a typed question about state (*which skill?*, *which facet?*, *keep this memory?*) with a core block and gets a typed answer. When the model can't back that answer with a confidence, the route stops instead of taking a branch. Code that routes this way still runs when no evaluation-capable model is configured |
| **The read** | The three named consumer seams (skill activation tier 3, index-time facets, memory capture) that use `evaluator` when it is present and fall back when it isn't. Zero today; three is done. Plus one check that shows a missing confidence refuses the route rather than choosing a branch |
| **Now** | 0 done · 1 in flight · 0 not started. The first epic, FIX-1553, had its direction approved on Sep 24 and its epic spec merged to main ([PR #2166](https://github.com/fixpoint-labs/flow-state-dev/pull/2166)). None of its six child issues has started. The project is outside the current cycle and is not on the W4 / Workforce critical path |
| **Kill line** | If no consumer does measurably better with `evaluator` than with the classifier it has once both are available, the fifth kind has not earned its place in core. What changes is the kind count. The seams can stay |

![The territory: new core kinds and the utilities that compose them are in the project. The consumer seams sit beside them, installed in other packages. The substrate is below the fence. The Evaluation System, a dispatcher kind, a System One package and a Decisions client are outside.](figures/territory.svg)

The fence is one question: *does it need a model call no existing kind can make?* That test gives
`evaluator` a kind of its own and leaves dispatch as a handler extender. `cascadingRouter` is
above the line only because it composes the new kind. It is a utility, not a kind.

## The epics — as of 2026-09-24

| Epic | Outcome it owns | State | Surface |
|---|---|---|---|
| [FIX-1553](https://linear.app/fixpoint-labs/issue/FIX-1553) · **evaluator + cascadingRouter** | Adds `evaluator` as a core kind and `cascadingRouter` as a fail-closed utility, and wires the three consumer seams to prefer it | **in flight**: Linear Spec Approved (direction approved Sep 24). 6 children, all Backlog, no implementation PR yet | [`specs/epics/FIX-1553/SPEC.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-1553/SPEC.md) · spec [PR #2166](https://github.com/fixpoint-labs/flow-state-dev/pull/2166) (merged) |

0 done · 1 in flight · 0 not started. Status comes from Linear and child implementation PRs at
each refresh, never from this file. An epic spec merging means its direction was approved. It does
not mean the epic is done.

```mermaid
flowchart LR
  REG["provider:model registry · soft-before"] -.->|"clean evaluationModel ids"| EV["FIX-1553 · evaluator + cascadingRouter"]
```

There is one epic, so the graph shows only its one outside input. The registry alignment is wanted
first but does not block. It belongs to another project and is drawn as an edge into this set,
not as a member of it.

## What this project is not

- **Not the Evaluation System project.** That is a
  test-eval harness for blocks and flows. It shares the word "evaluation" and nothing else.
- **Not framework simplification.** Nothing here changes how the four existing kinds work, and
  nothing gets moved onto evaluate in bulk.
- **Not a model vendor.** Any evaluation-capable model works, and none is required. There is no
  published System One package and no parallel Decisions client.
- **Not the resource-search story.** RAG is not required in core, and search is not a first-level
  kind.
