# FIX-1720 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No reader-facing documentation changes.** This issue proves what the epic's children shipped
and publishes nothing a user of the framework or of Shift Manager reads.

- **What it adds** is a goal check under `goals/` and a QA report in the closure PR. The goal
  check's `goal.md` is the contract for the next person who runs it, written from
  [SPEC.md's goal](SPEC.md#the-goal-and-how-well-know-its-met) in the `goals/README.md` format;
  it is not site content.
- **What it follows as written.** [D3](DECISIONS.md#d3)'s writer sees exactly these pages, as
  published on the run's commit, and nothing else: `apps/docs/docs/workforce/overview.md` (the
  epic's shared section), `apps/docs/docs/workforce/projects.md`,
  `apps/docs/docs/workforce/channels.md` (*A room per project*),
  `apps/docs/docs/workforce/chief-of-staff.md`, `apps/docs/docs/workforce/durable-hire.md`,
  `apps/docs/docs/workforce/workers-on-disk.md`, `packages/workforce/README.md` and
  `labs/shift-manager/README.md`. The epic's [DOCS.md](../../epics/FIX-1650/DOCS.md) assigns
  each to its child. A page that breaks a step is a finding, fixed on its own route, never
  edited in the closure PR.
- **The epic's docs polish** runs at wrap ([epic PLAN → Wrap](../../epics/FIX-1650/PLAN.md#wrap)),
  after this issue closes. It is not this issue's.
