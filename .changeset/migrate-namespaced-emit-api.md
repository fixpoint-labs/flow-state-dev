---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/patterns": patch
"@flow-state-dev/ui": patch
"@flow-state-dev/tasks": patch
---

Remove the deprecated flat emitters `ctx.emitMessage`, `ctx.emitComponent`, and `ctx.emitStatus`. Use the namespaced `ctx.emit.message` / `ctx.emit.component` / `ctx.emit.status` API instead — the call signatures are identical, so migrating is a mechanical rename (`ctx.emitMessage(...)` becomes `ctx.emit.message(...)`).

All internal call sites (sequencer background-work status, task-collection change events, generative UI card tools, pattern blocks) were already migrated. The flat aliases and their one-time deprecation warning have now been dropped from `BlockContext` and the engine's execution-context wiring.
