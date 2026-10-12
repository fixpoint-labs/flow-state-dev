# FIX-1917 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. *Proved by* names the kind of check; the plan maps each to one. "CI"
means a check with a scripted Cursor, through the block's own client seam. "Goal" means the goal
check, on real Cursor in a real browser.

Every rule in [FIX-1915's rules](../FIX-1915/BUSINESS-RULES.md) about the shared session flow
holds for Cursor unchanged: the queue, the server choosing the conversation and the directory, the
directory per session, the three panel states. They are proved there once. The rules below are
where Cursor is different, or where the case needs a Cursor run to prove it.

## Starting and continuing an agent

Cursor calls the conversation an *agent*; each turn is one *run* inside it.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The first turn of a new session runs | Cursor opens an agent, and its id is recorded when the SDK opens it, before the prompt is sent | CI · goal **c** |
| BR-2 | A later turn runs | It asks Cursor to resume the recorded agent, and the same id is confirmed | CI · goal **c** |
| BR-3 | Cursor refuses to resume the agent | The turn fails with Cursor's error, and the session says Cursor did not continue agent *X*. The recorded id stays; the next turn asks for *X* again (FIX-1915 D2). A refused resume throws before `onSession`, so the id is never overwritten. If Cursor ever confirms a different id, FIX-1915's "started a new one" state applies unchanged | CI |
| BR-3a | Cursor resumes the agent, and the run then fails | The turn shows its error, not a refusal: Cursor confirmed *X* in that turn, when it opened the agent | CI |
| BR-4 | The page is reloaded, or the server restarts on a durable store | The same session holds the same agent id, and the next turn continues it | Goal **r** |

## While it works

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | A run is in progress | Its steps show before the turn completes, every one written by the Cursor emitter. Cursor's summaries show as status notes, as today | CI · goal **l** |
| BR-6 | The person stops a turn | The run is cancelled, the turn shows as stopped, never as refused, the id stays, and the next turn continues the agent | CI · goal **s** |
| BR-7 | The host's Cursor key is rejected, or its login lapses after the mode opened | That turn fails with Cursor's own error, shown as that turn's error. The recorded id stays | CI, with a scripted error |

## Cursor's to-do list in the plan record

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | Cursor's to-do update succeeds | The record equals the list on its result: one row per item, in order, with the item's wording and Cursor's status word ([D1](DECISIONS.md#d1)) | CI · goal **p** |
| BR-9 | The update Cursor sent was partial | The record still equals the whole list on the result. The sent update is never written | CI |
| BR-10 | An update is sent and has not settled | The record is unchanged. The update shows as a running step | CI |
| BR-11 | An update fails | The record is unchanged. The failed update shows as a step with Cursor's error | CI |
| BR-12 | An item keeps its place and its wording, and its status changes | Its row moves to the new status and keeps the old one as its previous status ([D2](DECISIONS.md#d2)) | CI |
| BR-13 | The item at a place has new wording | The row takes the new wording and its previous status is cleared: it is a different item | CI |
| BR-14 | The list gets shorter | The rows past its new end are removed | CI |
| BR-15 | Two items have the same wording | Two rows, one per place | CI |
| BR-16 | The session's latest turn made no to-do update | The panel says "no plan recorded for this turn", even when an earlier turn recorded one (FIX-1915 BR-15). It never says "this harness reports no plan" in Cursor mode | CI · goal **p** |
| BR-17 | A status word Cursor has not used before | It records as itself | CI |
| BR-18 | The block runs more than once in one request | Each run's rows are kept apart under that run (FIX-1915's keying) | CI |
| BR-19 | A host leaves recording off, the default | The block declares no session state and writes nothing, exactly as today. A task board hands it off unchanged | CI |
| BR-20 | Cursor runs in plan mode | Its plan document is not recorded. Kitchen Sink never uses plan mode | Review |

## Can this host run it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | Harness modes are off for this host: deployed, or no `KITCHEN_SINK_HARNESS_WORKSPACE` (FIX-1914 BR-6, BR-7) | No Cursor flow is registered. Opening `/cursor` creates no session, and its flow's API is not found (FIX-1914 BR-14, BR-15) | FIX-1914's goal check, extended here |
| BR-22 | Harness modes are on, but the pinned Cursor SDK is missing or another version is installed, or the host has no Cursor key and no stored Cursor login | The mode reports itself unavailable with that reason through FIX-1914's mode check, and opens no session (epic ER-1). Decided once per server start | CI |

## Failure taxonomy

Nothing in this mode is fatal to the app. A run that fails, is stopped or is refused ends its
turn with Cursor's own error and leaves the agent id in place, so the next turn retries it. A
to-do update Cursor rejects is a step with an error and no record change. A row the writer cannot
store is reported the way the block reports any write failure, as a status note, and the run
carries on. Nothing retries on its own: a retry is the person's next turn.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), on real Cursor in a browser, with both
controls failing as named. From the epic: ER-2 and ER-6 hold for Cursor, and ER-5 is met by
Cursor writing its own list into core's record. The plan runs the goal check last.
