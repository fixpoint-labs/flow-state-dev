---
title: Configuration
sidebar_position: 1
sidebar_label: Overview
description: Where every flow-state.dev setting lives, and which page lists its fields.
---

# Configuration

Settings live in three layers. Pick the layer that owns the thing you want to change, then look up the field.

| Layer | What it configures | You write it in |
|-------|--------------------|-----------------|
| **Flow** | Actions, scopes, resources, auth, inbound transports | `defineFlow({ ... })` |
| **Runtime** | Registered flows, models, stores, workers, heartbeats | `createFlowState({ ... })` — often exported from `fsdev.config.ts` |
| **Environment** | Provider keys, store profile, intent overrides | `.env.local` and the host's secret store |

The flow layer describes *what the app does*. The runtime layer describes *how this process runs it*. Environment variables are the knobs you change without editing code: keys, which store profile is live, which model an intent should try first.

Narrative pages (Getting Started, Fundamentals, Server Setup) teach the concepts. The pages in this section are a field catalog: name, type, default, what it does. Use them when you already know which object you're editing.

## I want to change…

| Goal | Page |
|------|------|
| Add an action, expose session state, or bind a webhook | [Flow definition](./flow) |
| Tune a generator, handler, sequencer, or router | [Blocks](./blocks) |
| Register flows, pick stores, enable durability, start a worker | [Runtime](./runtime) |
| Set API keys, pick a store profile, override an intent | [Environment](./environment) |
| Point the browser at a flow | [Client and React](./client) |
| Tune working / episodic / semantic memory | [Memory configuration](/docs/memory/configuration) |
| Point `fsdev` at the same runtime the server uses | [App configuration](/docs/cli/configuration) |
| Map `intent/chat` to a fallback chain | [Models](/docs/fundamentals/models) |
| Persist across restarts | [Persistence](/docs/persistence/overview) |

## A minimal stack

```ts title="src/flows/hello-chat/flow.ts"
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

export default defineFlow({
  kind: "hello-chat",
  actions: {
    chat: {
      inputSchema,
      block: generator({
        name: "chat",
        model: "intent/chat",
        prompt: "You are a helpful assistant.",
        inputSchema,
        history: true,
        user: (input) => input.message,
        itemVisibility: { client: true, history: true },
      }),
      userMessage: (input) => input.message,
    },
  },
})();
```

```ts title="fsdev.config.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "./src/flows/hello-chat/flow";

export default createFlowState({
  flows: { chat: chatFlow },
  models: { default: "openai/gpt-5.4-mini", intents: { chat: ["openai/gpt-5.4-mini"] } },
  stores: { default: { primary: inMemoryStores() } },
});
```

```bash title=".env.local"
OPENAI_API_KEY=sk-...
```

The same `createFlowState` handle mounts as your HTTP API and as the `fsdev` CLI. One object, two entry points. See [App configuration](/docs/cli/configuration).

## What this section does not list

Pattern factories (`supervisor`, `planAndExecute`, `taskBoard`, …) and tool factories (`fetch`, `search`, `bash`, …) each have their own option object. Those fields live on the pattern or tool page, not here. The [ecosystem overview](/docs/ecosystem/overview) is the index.

Testing harness options (`testBlock`, `testFlow`) live in [Testing](/docs/testing/overview).
