# Plan — Core Blocks

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

This file covers order, not how anything gets built. It says which order the epics run in, what
each hands the next, and what is deliberately not next. Each epic's own plan owns its checks.

## The arc — as of 2026-09-24

There is one lane and no bar yet. FIX-1553 was filed on Sep 24, sits in Backlog outside the
current cycle, and has its spec being written. The arc becomes a figure when a second epic gives it
an order to show. Until then a picture of one unstarted lane would say nothing this sentence
doesn't.

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
