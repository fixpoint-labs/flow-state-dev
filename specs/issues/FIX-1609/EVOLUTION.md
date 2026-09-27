# FIX-1609 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage this issue changes or deliberately keeps. The two background-work rules below have
no retained spec: their source is the document section as it stands on `main` at 5d9e532.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The background-work list is "interaction-scoped, not live": no polling, no stream-driven refresh, because no session-level channel exists. Source: [`docs/architecture/server-and-client.md`](../../../docs/architecture/server-and-client.md), "Background work (`childSessions`)" | **Amended** for live views only | The session stream is that channel. A live view re-reads the list on its notice, through the same guarded read | [D2](DECISIONS.md#d2) · BR-7 · S6 | A view without `live` reads exactly as today (BR-18) |
| Never label an `"active"` row "running" or "working". Source: [`apps/docs/docs/client/react.md`](../../../apps/docs/docs/client/react.md), "What a row's status tells you", and the `ChildSessionStatus` doc comment in `packages/client/src/types/index.ts` | **Amended**: holds for a list read once; a live view may say "working" | In a live view the row clears when the work ends, so "working" reads as "hasn't answered yet". A paused or stopped run reads the same, knowingly | [D3](DECISIONS.md#d3) · BR-9 | The status values and their meaning don't change |
| A line another member posts appears when the page reads the channel again. Source: [`../FIX-1585/DOCS.md`](../FIX-1585/DOCS.md), the channels guide update, and kitchen-sink's README **Channels** bullet | **Superseded** for a live view | The epic's owner chose a live view in the framework ([epic D4](../../epics/FIX-1592/DECISIONS.md#d4)) | [DOCS.md](DOCS.md) · S7 | A page that doesn't ask to be live keeps today's behaviour |
| A request delivered into a session doesn't become its latest request. Source: the delivery path in `packages/engine/src/execution/runAction.ts`, the `latestRequestId` stamp | **Retained** | Moving it would resume a seat's request as the view's own, and still leave the open view deaf | [Decided, not asked](DECISIONS.md#decided-not-asked) · BR-19 | Unchanged |
| The per-user stream is not built, and answers 501. Source: `packages/engine/src/routes/http-handlers.ts`, the `user_stream` route | **Retained** | A channel is a session; a user stream would carry every session the user can see | [Considered and dropped](DECISIONS.md#considered-and-dropped) | Unchanged |
| The kitchen-sink goal checks read after a reload. Source: `goals/kitchen-sink-talk/*/goal.md`, **Signal** | **Retained** | This issue adds a check that never reloads beside them; FIX-1611 re-points the others (epic ER-27) | [SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met) · VG | They must stay green ([acceptance](BUSINESS-RULES.md#acceptance-criteria-this-issue-owns)) |

Compare each source with `main` before implementing: FIX-1610 lands in neighbouring files.
