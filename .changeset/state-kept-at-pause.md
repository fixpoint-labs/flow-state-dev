---
"@flow-state-dev/core": patch
---

A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Because that write runs again on the re-run, an increment (`incState`, `pushState`) made before the pause now applies twice; set a value instead (FIX-2444).
