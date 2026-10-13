# FIX-1875 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1816 D1: an ask is a `waitForResponse` option on `addTask`, no new tool; [D1](../FIX-1816/DECISIONS.md#d1) | **Amended**: the mechanism (a row on the asker's board, the turn parked on it) is **retained**; the option moves to its own tool | Epic [FIX-1870 D1](../../epics/FIX-1870/DECISIONS.md#d1): a flag that turns a board tool into a delivery tool is the overlap the epic removes | [D2](DECISIONS.md#d2), `dispatchTask({ wait })`; BR-16 to BR-20 | `waitForResponse` and `timeoutMs` refused by name, not stripped (BR-21) |
| FIX-1816's limits on an ask: depth one, one wait per step, the 30 s to 60 min timeout that cancels its row, the stop that cancels it; [rules](../FIX-1816/BUSINESS-RULES.md#bounded) and [product owner amendments](../FIX-1816/DECISIONS.md#product-owner-amendments-2026-10-09) | **Retained**, unchanged | Epic ER-3 and ER-8: nothing a waited-on task does changes | BR-16, BR-18, BR-19 | The FIX-1816 and FIX-1820 reruns, rename map only |
| FIX-1794 and FIX-1802: on a conversation's board, a filing or an assign that leaves a row assigned and pending starts it, and any touch starts every such row; [FIX-1794 plan](../FIX-1794/PLAN.md), [FIX-1802 rules](../FIX-1802/BUSINESS-RULES.md) | **Amended** for the task tools and their actions only; **retained** for flow code that writes the board, for answers that re-queue a started row, and for rows filed before this change | Epic ER-2: the task tools record and only `dispatchTask` starts work. The start on assign is what lets `addTask` start work today (`packages/workforce/src/conversation-board/board.ts`) | [D1](DECISIONS.md#d1); BR-1 to BR-6 | Rows without the new mark start as before (BP-030). Callers that relied on the start move to `dispatchTask_tasks`; the changeset names it |
| FIX-1817: an answered task re-queues in its task session and starts again; [FIX-1817](../FIX-1817/DECISIONS.md) | **Retained** | The row was dispatched once; an answer is not new work | — | Unchanged; the FIX-1817 rerun proves it |
| FIX-1816 D3: "ask the delegate" stays a post; [D3](../FIX-1816/DECISIONS.md#d3) | **Untouched here** | Amended by epic D2 and built by FIX-1872 | — | The coordinator's `handOff` and ledger stay as they are in this issue |

Re-check each cited intention against current code before implementing: retained specs are
intent, not proof of shipped behaviour.
