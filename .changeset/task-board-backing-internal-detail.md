---
"@flow-state-dev/orchestration": minor
---

Task board backing is now a once-chosen internal detail. `taskBoard({ collection })` is optional and defaults to request-backed storage (previously sequencer), so a sibling or outer step can add a task before the board drains. This is a silent behavior change: an existing board that omitted `backing` (e.g. `collection: { collectionId: "x" }`) now uses request storage instead of sequencer state — pass `{ backing: "sequencer", collectionId }` to keep the old per-invocation storage. The board's capability accessor is now the whole surface — reached at `ctx.cap.<name>` (the board name verbatim, previously `ctx.cap.taskBoard_<name>`) and exposing `addTask`/`addTasks`/`getTask`/`listTasks`/`countTasks` directly alongside `tasks()`. New `defineTaskCollection({ id, scope, stateSchema })` declares a durable, resource-backed board whose tasks survive across turns — pass it as `collection`.
