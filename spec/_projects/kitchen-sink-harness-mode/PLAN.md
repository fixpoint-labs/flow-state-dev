# Plan — Kitchen Sink: Harness Mode

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

The order the epics run in, what each hands the next, and what is deliberately not next. Status is
[the epics table](SPEC.md)'s; this page does not repeat it.

## The arc

One lane, no bar yet. The arc becomes a figure when a second epic gives it an order to show.

| Lane | Consumes | Releases |
|---|---|---|
| **harness mode** · FIX-1907 ([its plan](https://github.com/fixpoint-labs/flow-state-dev/tree/main/specs/epics/FIX-1907/PLAN.md)) | The four harness integrations as they stand; FIX-1701's shared task-scope reader where it has landed; FIX-1735's Claude Code item streaming (Done) | Kitchen Sink as a harness picker, with sessions and task sync per harness, and the gaps it finds in each integration |

## What is deliberately not next

- **Orchestration across harnesses.** Shift Manager owns it; it does not come here later.
- **A fifth harness.** Only the four named are in scope.
