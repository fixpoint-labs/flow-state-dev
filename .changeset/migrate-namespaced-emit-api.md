---
"@flow-state-dev/core": patch
"@flow-state-dev/patterns": patch
"@flow-state-dev/ui": patch
"@flow-state-dev/tasks": patch
---

Migrate all internal call sites off the deprecated flat emitters (`ctx.emitMessage`, `ctx.emitComponent`, `ctx.emitStatus`) to the namespaced `ctx.emit.message` / `ctx.emit.component` / `ctx.emit.status` API. Framework-owned emissions (sequencer background-work status, task-collection change events, generative UI card tools, pattern blocks) no longer trigger the one-time deprecation warning in user apps. The deprecated aliases themselves are unchanged and still work until the next major.
