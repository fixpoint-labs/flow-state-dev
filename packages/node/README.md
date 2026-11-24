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

// Loopback, so a flow without a principal resolver can run locally.
// A network host refuses that app. Mounts /api/flows and serves /healthz.
await serve(flowState, { host: "127.0.0.1" });
```

Reference: [the `node` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/node).
