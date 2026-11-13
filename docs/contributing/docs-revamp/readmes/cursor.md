# @flow-state-dev/cursor

Run Cursor's coding agent as a block through the Cursor SDK's local runtime.

```bash
pnpm add @flow-state-dev/cursor @cursor/sdk@1.0.40
```

```ts
import { cursorAgent } from "@flow-state-dev/cursor";

const agent = cursorAgent({
  cwd: (ctx) => workspacePathFor(ctx),
  resume: (ctx) => storedAgentId(ctx),
  onSession: (id, ctx) => storeAgentId(id, ctx),
  model: "composer-2.5",
  agent: { apiKey: process.env.CURSOR_API_KEY },
});
```

Reference: [the `cursor` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/cursor).
