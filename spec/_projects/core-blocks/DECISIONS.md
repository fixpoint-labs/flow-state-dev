# Decisions — Core Blocks

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Only calls that bind **more than one epic** go here. A call that binds one epic is that epic's.
The project covers new core kinds, and there is only one epic so far. So the calls below are here
because any **later** epic that proposes a kind or a composing utility would have to make them
again. They are owner locks from 2026-09-24, first recorded in the FIX-1553 epic description by
the FSD Architect. They were not decided in this document.

### PD-1 · A new core kind has to earn it with a model call no existing kind can make

**Binds** FIX-1553 and every later epic that proposes a core kind.

`evaluator` is the fifth kind. It is a peer of `generator` and wraps the AI SDK's
`experimental_evaluate`, which takes state and questions and returns typed answers. That is a call
no existing kind makes. **Dispatcher gets no core kind.** It is already backed by a handler in
core and stays a handler extender.
Rejected: a sixth kind for dispatch, and a `generator` plus Zod "System 2" shim standing in for
evaluate.

**Costs** a few block kinds, each defended by the call it wraps. Accepted, because each kind adds
to the API every author learns.

### PD-2 · Routing trees live in a utility, never inside a kind

**Binds** FIX-1553 and every later kind that someone might want to branch on.

`cascadingRouter` is a **utility**, and its name is locked (not `evaluatedRouter`). The cascade
tree is ordinary author code that calls `evaluator`. Rejected: putting the cascade inside the
`evaluator` block, which would make one kind carry both a model call and a control-flow policy.

**Costs** one more import for anyone who wants a cascade. Accepted.

### PD-3 · A routed judgement fails closed

**Binds** FIX-1553 and any later utility that routes on a model's answer.

If the confidence (TypeSafe) or the choice or score probabilities (LM adapter) are missing or too
low, the route is refused. It never soft-fails into a branch it did not earn, and it does not retry
on its own. Rejected: falling back to the most likely branch.

**Costs** a flow can stop where it used to guess. Accepted. A wrong branch taken quietly is worse,
because nothing surfaces it.

### PD-4 · Consumers take an evaluator when present and never require one

**Binds** FIX-1553 and every later epic that installs a Core Blocks kind into another package.

Skill activation, index-time facets and memory capture take an `evaluator` through an inject seam.
Orchestration never imports Jev or a System One package directly. Jev through the Gateway is the
preferred model. Any evaluation-capable model is allowed, and generate-only models are refused.
Rejected: hard-requiring Jev, and a parallel OpenRouter Decisions client.

**Costs** each consumer carries two paths, with and without the evaluator. Accepted, because it
keeps the kind optional for every app.

## Decided once

- **Which project owns it.** This is Core Blocks, not the Evaluation System project and not framework
  simplification. An epic about typed model judgements belongs here. An epic about grading flows
  under test does not.
- **Existing utilities are not migrated to evaluate in bulk.** A consumer moves when it has its own
  reason to move.
- **The kitchen-sink thinking-style router is dropped.** It uses the same pattern, and it is not a
  consumer this project builds.

## Open

None.
