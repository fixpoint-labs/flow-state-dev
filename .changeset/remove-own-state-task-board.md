---
"@flow-state-dev/orchestration": minor
---

Removed the own-state "delegation board": the default `taskTools` capability that kept a board on the host generator's own state (FIX-2057). Nothing shipped used it. The task tools now always run over a board you name. Removed exports: `taskTools`, `defaultOwnStateResolver`, `DELEGATION_BOARD_FIELD`, `delegationBoardSchema`. `createTaskToolsCapability(resolver, roster?, options?)` and `buildTaskToolsList(resolver, roster?, nameSuffix?)` now require the resolver. Where you wrote `uses: [taskTools]`, pass `createTaskToolsCapability(resolver)` with a resolver for your board, or use the board's own `board.capability`.
