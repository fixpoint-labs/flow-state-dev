# @flow-state-dev/next

Mount a `FlowState` on a Next.js App Router catch-all route, on any Next host.

```bash
pnpm add @flow-state-dev/next
```

```ts
// app/api/flows/[...path]/route.ts
import { flowstate } from "@/flowstate";
import { createNextHandler } from "@flow-state-dev/next";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

Reference: [the `next` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/next).
