# @flow-state-dev/vercel

Deploy a Flow State app to Vercel with Next.js: SSE shaping, function config and a Vercel Postgres store.

```bash
pnpm add @flow-state-dev/vercel
```

```ts
// app/api/flows/[...path]/route.ts
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);

// Next.js reads these statically: literal declarations, not re-exports.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

Reference: [the `vercel` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/vercel).
