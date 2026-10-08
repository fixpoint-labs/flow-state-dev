# FIX-1817 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1794 BR-25: a parked task gives one `parked` notice, and once "answered and completed later" a second, `completed`; source [`../FIX-1794/BUSINESS-RULES.md`, "How it ended"](../FIX-1794/BUSINESS-RULES.md#how-it-ended) | **Retained**, notices unchanged. The answer path it assumed is added | It names an answer nothing delivers; the epic records the gap (FIX-1815 SPEC, people table) | BR-6, BR-15; S1, S2 | Same notices, same dedup |
| FIX-1244: `unparkAndDrain`, the fenced unpark plus a drain in the caller's request, the answer as `input.feedback`; no retained spec, source [`packages/orchestration/src/task-board/index.ts`](../../../packages/orchestration/src/task-board/index.ts) (`unparkAndDrain`) | **Retained**. `answerTask` reuses its fenced `unpark` | It already re-queues a parked row with an answer; what a board in a conversation lacks is a tool and an action that reach it through the partition, and a start that doesn't hold the caller's request | [D1](DECISIONS.md#d1); S2 | `unparkAndDrain` callers unchanged |
| FIX-1690 BR-9: a re-entry after a person's turn is discounted from `maxAttempts`; source [`../FIX-1690/BUSINESS-RULES.md`, "A turn into a coding run"](../FIX-1690/BUSINESS-RULES.md#a-turn-into-a-coding-run) | **Extended** to an answered question's re-entry; the turn re-entry rule retained | The POC's R1: a re-entry spends an attempt today | BR-8; S3 | Only `answerTask`'s re-entry is newly discounted |
| FIX-1690 BR-15: Shift Manager disables Send on a finished task, "a finished task takes no message"; source [`../FIX-1690/BUSINESS-RULES.md`, "The three composers"](../FIX-1690/BUSINESS-RULES.md#the-three-composers) | **Not changed here.** FIX-1764 amends it | D2 decides what such a message does; the composer is FIX-1764's (epic ER-13) | [D2](DECISIONS.md#d2) | Shift Manager behaves as today until FIX-1764 ships |
| FIX-1794's task session, keyed by task, worker and filing conversation; source [`../FIX-1794/PLAN.md`, S3 and S9](../FIX-1794/PLAN.md#surfaces) | **Amended**: a follow-up task hands off under its root task's key | ER-3 needs a follow-up task to run in the same session | BR-20, BR-24; S6 | Rows without `followUpOf` key exactly as before |

FIX-1802's split and FIX-1816's ask are dependencies, not predecessors. Before implementation,
compare these intents with the code as FIX-1794 P2 and FIX-1802 P1 shipped it: approved intent
alone doesn't establish shipped behaviour.
