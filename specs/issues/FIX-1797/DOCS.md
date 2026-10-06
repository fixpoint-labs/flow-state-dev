# FIX-1797 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No reader-facing documentation changes.** This issue proves what the epic's children shipped
and publishes nothing a user of the framework or of Shift Manager reads.

- **What it adds** is a goal check under `goals/` and a QA report in the closure PR. The goal
  check's `goal.md` is the contract for the next person who runs it, written from
  [SPEC.md's goal](SPEC.md#the-goal-and-how-well-know-its-met) in the `goals/README.md` format;
  it is not site content.
- **What J1 follows as written.** The writer sees exactly these pages, as published on the run's
  commit, and nothing else: `apps/docs/docs/workforce/overview.md` (the epic's shared opening),
  `workers-on-disk.md`, `durable-hire.md`, `built-in-worker.md` (custom worker flows),
  `coordinators.md`, `chief-of-staff.md`, `projects.md`, `upgrading.md`, the page FIX-1794
  publishes for giving a task to a worker, `apps/docs/docs/persistence/overview.md`,
  `apps/docs/docs/glossary.md`, and `packages/workforce/README.md`. Where a child publishes
  under another path, its merged `DOCS.md` names it. The epic's
  [ownership table](../../epics/FIX-1786/DOCS.md#ownership) assigns each page to its child. A
  page that breaks a step is a finding, fixed on its own route, never edited in the closure PR.
- **c7 follows** the upgrade steps FIX-1790 and FIX-1788 publish, quoted in the report.
- **The epic's docs polish** runs at wrap ([epic PLAN → Wrap](../../epics/FIX-1786/PLAN.md#wrap)),
  after this issue closes. It is not this issue's.
