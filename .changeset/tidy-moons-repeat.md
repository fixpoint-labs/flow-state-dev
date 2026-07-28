---
"@flow-state-dev/orchestration": patch
---

`addTask`'s tool description no longer names `runBoard`. `runBoard` is installed by the delegation surface, not by `taskTools` — so a consumer wiring `taskTools` directly (`createTaskToolsCapability`, `buildTaskToolsList`) had a description telling its model to call a tool that surface does not have. The description now states what `addTask` does (records a task on the board; does not run it) and leaves the "then call `runBoard`" instruction to the delegation surface's own guidance, where that tool exists. Both cap errors stay documented, hedged to match reality: the exported `taskTools` singleton is uncapped, while a library-installed board is not. Guidance on the delegation surface is unchanged.
