---
sidebar_position: 3
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
}).then(chatGen);

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
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

### One server route serves all flows

A single catch-all API route registers all flows and handles routing:

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import chatFlow from "@/flows/my-chat/flow";
import agentFlow from "@/flows/my-agent/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);
registry.register(agentFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
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
