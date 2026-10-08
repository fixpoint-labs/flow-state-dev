# FIX-1816 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic FIX-1815 L5: `awaitDispatch` on the block context and a `resultOf(requestId)` engine read; [D5](../../epics/FIX-1815/DECISIONS.md#d5) | **Amended**, pending the epic's record (its ER-11) | The epic's note asked whether existing reads plus `runOnce` meet leg a. On the board they do: the row binds the wait and FIX-1794's notice carries the answer. A context verb also breaks the dispatch protocol's declared-block rule (`packages/core/src/types/dispatch.ts`) | [D1](DECISIONS.md#d1): `askTask` beside the eight task tools; no core export, no new read | Nothing shipped under the old name |
| Epic L8: a durable in-memory test runtime; [D5](../../epics/FIX-1815/DECISIONS.md#d5) | **Amended**, as the epic's note directed | The SQLite cold-restart shape (`packages/store-sqlite/test/multigate-cold-restart.test.ts`) expresses a restart mid-wait | PLAN S8: one testing helper, plus SQLite cold-restart tests | None |
| FIX-1537, `dispatchAndWait`: park until FIX-1312's reverse reply, carrying a request id, lands; its guidance rules out a board settle as the reply channel. Linear only, no retained spec | **Superseded** | The product owner chose one child-finished signal, FIX-1794's notice, for both hand-offs on 2026-10-08 ([epic D2](../../epics/FIX-1815/DECISIONS.md#d2)). A reply its author must write is not needed when the row's ending carries the answer | This issue. FIX-1537 closes as its duplicate, still under FIX-1312 ([epic ER-18](../../epics/FIX-1815/BUSINESS-RULES.md#how-the-set-is-run)) | FIX-1312's request-id stamp is unaffected |
| FIX-1230 and FIX-1231, the relay's wait-for-response mode. Linear only, Canceled | **Superseded** | Cancelled before any design was retained | This issue | None |
| FIX-1794 S6 and S7, the task notice and `onTaskSettled`; [PLAN](../FIX-1794/PLAN.md) | **Retained**, then moved and extended | The epic's Q2: FIX-1794 P2 builds the module layer-clean and this issue lifts it. After the lift an asked row's ending resumes its turn instead of waking one | PLAN S9 | FIX-1794's V5 passes before and after the lift; an assigned row's ending is unchanged |
| FIX-1802 BR-17, the settle-owed marker; [rules](../FIX-1802/BUSINESS-RULES.md) | **Retained**, its pattern reused | Written with the ending, cleared only by what it owes, replayed on any touch | PLAN S5, the resume-owed marker | FIX-1802's marker is unchanged |
| FIX-1791's delivery ledger token; `packages/workforce/src/delivery-ledger.ts` | **Retained** | [D3](DECISIONS.md#d3): a post stays a post | — | Unchanged |
| FIX-1244's fenced unpark of a parked row; `packages/orchestration/src/task-board/park-exit.ts` | **Retained** | An asker that is itself a task parks its row with it | PLAN S6 | Unchanged |

Re-check each cited intention against current code before implementing: retained specs are
intent, not proof of shipped behaviour. FIX-1794 S6 and S7 and FIX-1802 BR-17 are not on `main`
as this is written.
