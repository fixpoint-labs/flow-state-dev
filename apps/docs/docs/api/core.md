---
sidebar_position: 1
---

# Core API

`@flow-state-dev/core` — Isomorphic builders, type contracts, and item taxonomy.

## Block Builders

### `handler(config)`

Create a synchronous logic block.

```ts
import { handler } from "@flow-state-dev/core";

const myHandler = handler({
  name: "my-handler",
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: 1 });
    return { result: input.value.toUpperCase() };
  },
});
```

### `generator(config)`

Create an LLM-calling block with tool loop support.

```ts
import { generator } from "@flow-state-dev/core";

const myGenerator = generator({
  name: "my-gen",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ response: z.string() }),
  user: (input) => input.message,
  tools: [myTool],
  context: [projectionText("session.plan")],
  history: [projectionMessages("session.history")],
  repair: { mode: "auto", maxAttempts: 3 },
});
```

### `sequencer(config)`

Create a pipeline composition block.

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({
  name: "my-pipeline",
  inputSchema: z.object({ message: z.string() }),
  container: { component: "pipeline-view", label: "Processing" },
});
```

**Methods:** `then`, `thenIf`, `map`, `parallel`, `forEach`, `doUntil`, `doWhile`, `loopBack`, `work`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`

### `router(config)`

Create a runtime block-selection block.

```ts
import { router } from "@flow-state-dev/core";

const myRouter = router({
  name: "mode-router",
  inputSchema: z.object({ mode: z.string() }),
  routes: { chat: chatBlock, agent: agentBlock },
  execute: async (input) => input.mode,
});
```

## Flow

### `defineFlow(definition)`

Create a flow type.

```ts
import { defineFlow } from "@flow-state-dev/core";

const myFlow = defineFlow({
  kind: "my-app",
  requireUser: true,
  actions: { /* ... */ },
  session: { stateSchema, resources, projections },
  user: { stateSchema, resources, projections },
  request: { onStarted, onCompleted, onErrored, onFinished, onStepErrored },
});

export default myFlow({ id: "default" });
```

## Resources & Projections

### `defineResource(config)`

Create a portable resource definition. Can be used in flow scope configs and in block-level resource declarations (`sessionResources`, `userResources`, `projectResources`):

```ts
import { defineResource } from "@flow-state-dev/core";

const planResource = defineResource({
  stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
  writable: true,
});

// Use in flow scope config
session: { resources: { plan: planResource } }

// Or declare on blocks — collected and merged into the flow automatically
const myHandler = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => { /* ... */ },
});
```

### `defineProjection(config)`

Create a portable projection definition.

```ts
import { defineProjection } from "@flow-state-dev/core";

const topicsProjection = defineProjection({
  client: true,
  outputSchema: z.array(z.string()),
  compute: (ctx) => ctx.user?.state.subscribedTopics ?? [],
});
```

### Context References

For generator blocks:

| Helper | Returns | Use For |
|--------|---------|---------|
| `projection(uri)` | Raw projection value | General access |
| `projectionText(uri)` | String text | Text context for LLM |
| `projectionData(uri)` | Structured data | JSON data context |
| `projectionMessages(uri)` | Message array | Conversation history |
| `resource(uri)` | Resource value | Direct resource access |

## Type Helpers

```ts
import { StateOf, ContextOf, ResourceContext, BlockInput, BlockOutput } from "@flow-state-dev/core";

type PlanState = StateOf<typeof planResource>;
type SessionCtx = ContextOf<typeof sessionSchema, "session">;
type Input = BlockInput<typeof myBlock>;
type Output = BlockOutput<typeof myBlock>;
```

## Subpath Exports

- `@flow-state-dev/core/types` — Block, flow, resource, scope, streaming, and model type definitions
- `@flow-state-dev/core/items` — Item unions, content types, and stream event helpers
