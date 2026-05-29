---
sidebar_position: 5
---

# Project Structure

How to organize your flow-state.dev project.

## Recommended Layout

```text
src/
  flows/
    my-chat/
      flow.ts              # Flow definition (defineFlow + block composition)
      blocks/
        chat-gen.ts        # Generator block
        validate.ts        # Handler block
      tools/
        search.ts          # Tool definitions for generators
    my-agent/
      flow.ts
      blocks/
        ...
  app/
    api/
      flows/
        [...path]/
          route.ts         # Server API route (registry + router)
    page.tsx               # React UI
```

## Key Principles

### Flow files are the entry point

Each flow has a single `flow.ts` that exports the flow instance. This file defines the flow kind, actions, session config, and block composition:

```ts title="src/flows/my-chat/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { chatGen } from "./blocks/chat-gen";

const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
}).step(chatGen);

const myChat = defineFlow({
  kind: "my-chat",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: pipeline,
    },
  },
});

export default myChat({ id: "default" });
```

### Blocks live next to their flow

Blocks are typically defined in a `blocks/` directory next to the flow file. Schemas are defined in the same file as the block that uses them:

```ts title="src/flows/my-chat/blocks/chat-gen.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const chatGen = generator({
  name: "chat",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

### One runtime config, one server route

Describe the runtime once in `lib/flowstate.ts`, then mount it from a single catch-all API route that handles routing for all flows:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import chatFlow from "@/flows/my-chat/flow";
import agentFlow from "@/flows/my-agent/flow";

export const flowstate = createFlowState({
  flows: { chatFlow, agentFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

### Shared blocks across flows

If blocks are reused across flows, extract them to a shared location:

```text
src/
  shared/
    blocks/
      rate-limiter.ts
      analytics.ts
  flows/
    my-chat/flow.ts       # imports from shared/blocks/
    my-agent/flow.ts      # imports from shared/blocks/
```
