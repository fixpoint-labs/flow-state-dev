---
---

docs(resources): correct the external-collection change-awareness example so `host.dispatch` is shown inside a custom inbound transport adapter's `createBindings(host)`, where `host` is actually in scope. The prior example called a bare `host.dispatch(...)` in a "post-write hook / DB trigger / queue consumer" context, but `host` is only handed to adapters and isn't on the public `createFlowState` handle, so the snippet didn't compile when copied. Also sets `responseEmitter: null` to match the stated fire-and-forget semantics. No package changes.
