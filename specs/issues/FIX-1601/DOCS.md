# FIX-1601 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

**No reader-facing documentation changes.** This issue proves what the four children shipped
and publishes nothing a user of the framework or of kitchen-sink reads.

- **What it adds** is a goal check under `goals/` and a QA report in the closure PR. The goal
  check's `goal.md` is the contract for the next person who runs it; it is written from
  [SPEC.md's goal](SPEC.md#the-goal-and-how-well-know-its-met) in the `goals/README.md` format
  and is not site content.
- **What it checks** is the documentation the children published: the kitchen-sink README, the
  channels guide, the workforce README and the workers-on-disk page, each followed as written
  ([PLAN.md → Part 4](PLAN.md#part-4--gap-sweep)). A page that is wrong is a finding, fixed on
  its own route by the page's owner, never edited in the closure PR.
- **The epic's docs polish** runs at wrap ([epic PLAN → Wrap](../../epics/FIX-1592/PLAN.md#wrap)),
  after this issue closes. It is not this issue's.
