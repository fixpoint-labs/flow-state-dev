# @flow-state-dev/core

Blocks, flows and their type contracts: the builders every Flow State app is written in. Runs anywhere JavaScript runs.

```bash
pnpm add @flow-state-dev/core
```

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const chat = generator({
  name: "chat",
  model: "openai/gpt-6-luna",
  prompt: "You are a helpful assistant.",
  inputSchema,
  history: true,
  user: (input) => input.message,
});

export default defineFlow({
  kind: "hello-chat",
  actions: { chat: { inputSchema, block: chat } },
})();
```

Reference: [the `core` section of the Flow State API reference](https://flow-state.dev/docs/reference/api/core).
