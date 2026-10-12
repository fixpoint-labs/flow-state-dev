# FIX-1876 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

What this issue does to earlier designs. Their documents are not edited; this table is the record.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1815's two kinds of hand-off, ask and assign, and "the Layer 1 seam" they share; [`../../epics/FIX-1815/SPEC.md`](../../epics/FIX-1815/SPEC.md) (title, people table) and [`../../epics/FIX-1815/DECISIONS.md#d5`](../../epics/FIX-1815/DECISIONS.md#d5) | **Superseded** as vocabulary; the mechanism **retained** | The epic's [D3](../../epics/FIX-1870/DECISIONS.md#d3): ask is a question to a person, new work is dispatched, a caller waits | This spec's [D1](DECISIONS.md#d1) and the glossary rows in [DOCS.md](DOCS.md) | Names only. The retained FIX-1815 set keeps its words as history |
| FIX-1816's ask gate: the turn parks on a gate with reason `"ask"`, the row carries `ask`, filings are recorded under `fsd.ask.*`; [`../FIX-1816/`](../FIX-1816/SPEC.md) and `packages/core/src/types/ask-gate.ts` on `main` | **Retained** as behaviour; **renamed** | Same; the error codes it ships already say `wait_*` | The wait gate, [PLAN.md → Pinned names](PLAN.md#pinned-names) | The row field and the gate reason are read under both names; the `fsd.ask.*` keys, the gate-id prefix and the notice flag keep their spelling ([D2](DECISIONS.md#d2), WR-8 to WR-13) |
| FIX-1074's board assignee that "hands off" a claimed row to a dispatch run, its `"handed-off"` ending and `handedOff` output; `packages/orchestration/src/task-board/hand-off.ts` and `blocks/board-meta.ts` on `main`, Linear only for the issue | **Retained** as behaviour; **renamed** | D3: a board giving a row to another session is a dispatch; the board never did the work | The dispatch names and `"dispatched"` | Old item logs read as `"dispatched"` (WR-14); the old docs anchor kept (WR-18) |
| The glossary's *Hand-off*: "work leaves the current request for another session"; `apps/docs/docs/glossary.md` | **Superseded** | D3 | *Dispatch a task*, *Wait*, and *Hand-off* (mid-work only) in [DOCS.md](DOCS.md) | Docs only |
| FIX-1792's removal of `post-to-mailbox`, commit `617aeabb5` | **Retained**; stale mentions cleaned | The epic's [review record](../../epics/FIX-1870/DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them) assigns them here | Amended pending changesets (WR-7) | Release notes only |

Re-check each cited intention against the merged FIX-1875 and FIX-1872 code before implementing:
either may already have renamed part of the wait family.
