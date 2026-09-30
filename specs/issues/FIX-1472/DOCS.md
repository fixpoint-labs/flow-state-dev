# FIX-1472 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

**No documentation impact.** This rearranges code inside the task board's recorder module. Every
observable behaviour stays as it is ([BUSINESS-RULES.md](BUSINESS-RULES.md)), and no export,
option, error class or persisted entry changes.

Checked against the pages that describe the area, which stay accurate unedited:

- `packages/orchestration/README.md` → "When the board cannot record a result": describes the
  report entry, both error classes, and raise-by-default with the drain opting into defer. All
  unchanged.
- `docs/architecture/items.md`: the `task-board-recorder-failure` component's visibility and
  renderer rule. Unchanged.

No changeset: no downstream consumer of `@flow-state-dev/orchestration` can observe the change
(BP-022).
