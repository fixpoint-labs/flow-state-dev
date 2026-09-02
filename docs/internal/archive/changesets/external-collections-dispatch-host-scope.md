---
---

docs(resources): correct the external-collection change-awareness example. `host.dispatch` is now shown inside a custom inbound transport adapter's `createBindings(host)`, where `host` is actually in scope — the prior bare `host.dispatch(...)` in a "post-write hook / DB trigger / queue consumer" context didn't compile because `host` is only handed to adapters, not exposed on the public `createFlowState` handle. The example now guards the internal route and frames `userId` as the backend's trusted assertion (not caller-controllable body input), mounts the route under the `/api/flows` prefix custom adapters are matched against, and sets `responseEmitter: null` for its fire-and-forget dispatch. No package changes.
