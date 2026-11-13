# @flow-state-dev/node

Serve a Flow State app from a long-lived Node process in one call: HTTP, SSE, health checks and clean shutdown.

```bash
pnpm add @flow-state-dev/node
```

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { flows } from "./flows.js";

const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } }, // or a durable store
});

// Binds process.env.PORT (then 3000), mounts the API under /api/flows, serves /healthz.
await serve(flowState);
```

Reference: [the `node` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/node).
