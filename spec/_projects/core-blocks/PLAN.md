# Plan — Core Blocks

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

This file covers order, not how anything gets built. It says which order the epics run in, what
each hands the next, and what is deliberately not next. Each epic's own plan owns its checks.

## The arc — as of 2026-09-24

There is one lane, and its bar started on Sep 24, when FIX-1553's direction was approved and its
epic spec merged ([PR #2166](https://github.com/fixpoint-labs/flow-state-dev/pull/2166)). The bar is open and the now
line sits at its start, because none of the six child issues has begun. The epic sits outside the
current cycle. The arc becomes a figure when a second epic gives it an order to show. Until then a
picture of one open bar would say nothing this sentence doesn't.

| Epic | Consumes | Releases |
|---|---|---|
| **evaluator + cascadingRouter** · FIX-1553 | The AI SDK `experimental_evaluate` call. The `provider:model` registry alignment, wanted first but not blocking. The DNM proof spine (#1903) as evidence to build on, not code to merge | `evaluator` as a core kind, `cascadingRouter` as a utility, and inject seams in skill activation, index-time facets and memory capture. Also the precedent any later kind is held to (PD-1 to PD-4) |

## What is deliberately not next

- **A dispatcher core kind.** It stays a handler extender (PD-1). Do not file an epic or a child
  for it.
- **Moving existing utilities onto evaluate in bulk.** Each consumer moves when it has its own
  reason to.
- **Promoting `labs/typesafe-jev` or publishing a System One package.**
- **The kitchen-sink thinking-style router.** It was dropped as a consumer.
- **A second model-registry demo.** The registry alignment belongs to its own project, and this one
  only consumes it.
