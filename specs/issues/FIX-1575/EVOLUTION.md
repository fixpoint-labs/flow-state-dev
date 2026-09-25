# FIX-1575 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1549 S7: reword Engine's Workforce prose, but "task-board and ordinary uses of 'seat' stay"; source [`../FIX-1549/PLAN.md#surfaces`](../FIX-1549/PLAN.md#surfaces), row S7 | **Amended** for task-board uses in Core and Engine; the ordinary-English carve-out is **retained** | The locked guidance on FIX-1575 names *seat* a Layer 2 word and *assignee* the board's claim key. Orchestration's own `hand-off.ts` already documents the seat as "the row's assignee" | [D1](DECISIONS.md#d1), BR-1, BR-5: task-board *seat* in Core and Engine prose becomes *assignee*; "an operator's seat" stays | No code or behaviour changes. #2236's guard is unaffected: it bans coupling, not words |
| FIX-1549 follow-up "Task-board words in Layer 1": Engine's `runAction` gate reads `gatedBy.boardId`, and Core's dispatch and task types "speak of seats and boards"; source [`../FIX-1549/PLAN.md#follow-ups`](../FIX-1549/PLAN.md#follow-ups) | **Amended**: the *seats* half is carried out; the *boards* half is **superseded** | The locked guidance says Layer 1 owns task, board and parked, and forbids generalizing by removing them | [D1](DECISIONS.md#d1): `boardId`, `gatedBy` and task entries stay; only the seat wording moves | None |
| FIX-1549 "Decided, not asked": the vocabulary guard checks coupling, not words; source [`../FIX-1549/DECISIONS.md#decided-not-asked`](../FIX-1549/DECISIONS.md#decided-not-asked) | **Retained** | Still the right call: a word ban would fail on ordinary English | No new guard. The retained inventory under `poc/` is evidence, not CI | None |

FIX-1549 is a dependency as well as a predecessor: its PR-B (#2236) is the baseline this audit
counts against. Its shipped fence, owner-pinned cell and instance pin are not reopened.
