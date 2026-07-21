---
"@flow-state-dev/core": minor
---

A capability can now contribute to a block's own state (`ctx.self`) by declaring `stateSchema` — the same field name a block uses for its own declaration — via `defineCapability({ stateSchema })` or a preset. Valid on any block kind. This lets a capability (a skills registry, say) give the block it's attached to a working `ctx.self` container without the block author declaring `stateSchema` directly. A field declared by two sources — two capabilities, or a capability and the block's own `stateSchema` — must be the same schema reference or the build throws (the same reference-equality collision rule the `resources`/`targetStateSchemas` merges already use); unlike the existing `sequencerStateSchema`/`sessionStateSchema` merge, this never silently lets one side win on a conflicting duplicate field.
