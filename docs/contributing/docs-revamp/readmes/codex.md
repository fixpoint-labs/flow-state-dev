# @flow-state-dev/codex

Run OpenAI's Codex agent as a block through the Codex SDK.

```bash
pnpm add @flow-state-dev/codex @openai/codex-sdk@0.164.0
```

```ts
import { codexAgent } from "@flow-state-dev/codex";

const agent = codexAgent({
  cwd: (ctx) => workspacePathFor(ctx),
  resume: (ctx) => storedThreadId(ctx),
  onSession: (id, ctx) => storeThreadId(id, ctx),
  thread: { sandboxMode: "workspace-write", approvalPolicy: "never" },
  client: { apiKey: process.env.CODEX_API_KEY },
});
```

Reference: [the `codex` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/codex).
