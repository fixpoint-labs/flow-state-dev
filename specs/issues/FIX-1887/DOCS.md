# FIX-1887 · Documentation

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

No documentation impact: this issue adds a goal check under `goals/` and changes no behaviour a
reader can see. The pages the epic publishes are its children's, assigned in
[the epic's DOCS.md](../../epics/FIX-1870/DOCS.md#ownership): "Giving another worker work" in
`apps/docs/docs/orchestration/task-board.md` and "Waiting for the answer" in
`apps/docs/docs/server/background-work.md` (FIX-1875), `workforce/coordinators.md` and
`workforce/chief-of-staff.md` (FIX-1872), the glossary's *Dispatch a task* and *Hand-off* rows
(FIX-1876), and the orchestration and workforce READMEs. This issue follows them as written
([PLAN → Part 4](PLAN.md#part-4--gap-sweep-in-the-report)). A promise there that no check
reaches, or a sample that differs from the call that works, is a finding against the child that
published it, fixed on that child's route, not here.
