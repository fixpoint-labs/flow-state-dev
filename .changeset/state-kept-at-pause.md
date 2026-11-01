---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Sequencer-state writes the step made before the pause (including `incState` and `pushState`) apply once: the re-run skips them up to the pause, since the saved state already holds them (FIX-2444).
