# FIX-1642 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No reader-facing documentation changes.** This issue proves what the epic published and
publishes nothing a user of the framework reads.

- **What it adds** is a goal check under `goals/`, a CI step and a QA report in the closure PR.
  The goal check's `goal.md` is the contract for the next person who runs it, written from
  [SPEC.md's goal](SPEC.md#the-goal-and-how-well-know-its-met) in the `goals/README.md`
  format. It is not site content.
- **What it checks** is the keeping-flows-alive page and every page it links, followed as
  written, plus a noun grep over `apps/docs` ([PLAN.md → Part 4](PLAN.md#part-4--gap-sweep)). A
  page that fails is a finding, fixed on its own route, never edited in the closure PR.
- **The CI step's failure message** is contributor-facing: it names the token, the type it was
  resolved against, and the page line. That wording is the implementer's.
- **The epic's docs polish** runs at wrap, after this issue closes. It is not this issue's.
