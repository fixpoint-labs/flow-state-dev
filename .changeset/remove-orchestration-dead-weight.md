---
"@flow-state-dev/orchestration": minor
---

Removed `dispatchAndExecuteBlock` and `taskLoopBack`, `classifierDispatcher` and `eventDispatcher`, and the default `taskTools` capability (FIX-2057). An import of a removed export fails to compile and names it.

- `dispatchAndExecuteBlock` and `taskLoopBack` are gone; `taskBoard()` is the claim loop. Removed exports: `dispatchAndExecuteBlock`, `DispatchAndExecuteOptions`, `DispatchAndExecuteResult`, `taskLoopBack`, `defaultTaskLoopUntil`, `DEFAULT_TASK_LOOP_MAX_ITERATIONS`, `TaskLoopBackOptions`, `TaskLoopBackHandle`. If you drove `dispatchAndExecuteBlock` in a sequencer `loopBack`, use `taskBoard({ workers, collection }).drain` instead.
- `classifierDispatcher` and `eventDispatcher` are gone; `fifoDispatcher`, `topologicalDispatcher` and `priorityDispatcher` remain. Removed exports: `classifierDispatcher`, `ClassifyFn`, `ClassifierDispatcherOptions`, `eventDispatcher`, `EventDispatcherOptions`. To pick a task by your own rule, write a `TaskDispatcher` whose `claim` calls `collection.claim(workerId, { eligibility })`.
- The own-state "delegation board" is gone: the default `taskTools` capability that kept a board on the host generator's own state. The task tools now always run over the board your resolver returns. Removed exports: `taskTools`, `defaultOwnStateResolver`, `DELEGATION_BOARD_FIELD`, `delegationBoardSchema`. `createTaskToolsCapability(resolver, roster?, options?)` and `buildTaskToolsList(resolver, roster?, nameSuffix?)` now require the resolver. Where you wrote `uses: [taskTools]`, pass `createTaskToolsCapability(resolver)` with a resolver for your board.
