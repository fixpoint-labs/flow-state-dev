# @flow-state-dev/mcp

Serve a flow as an MCP server over Streamable HTTP. Its actions become MCP tools.

```bash
pnpm add @flow-state-dev/mcp
```

```ts
import { defineFlow } from "@flow-state-dev/core";
import { createFlowApiRouter } from "@flow-state-dev/engine";
import { createMcpTransportAdapter } from "@flow-state-dev/mcp";
import { z } from "zod";

const billing = defineFlow({
  kind: "billing",
  mcp: { enabled: true },
  authentication: { resolvePrincipal },
  actions: {
    recordPayment: {
      inputSchema: z.object({ amount: z.number(), invoiceId: z.string() }),
      block: recordPayment,
      description: "Record a customer payment against an open invoice.",
    },
  },
});

const router = createFlowApiRouter({ registry, stores, adapters: [createMcpTransportAdapter()] });
```

Reference: [the `mcp` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/mcp).
