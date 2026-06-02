---
name: fsd:add-flow
description: Create a new flow definition with actions, scopes, resources, and capabilities. Produces the flow file, action blocks, and server registration.
argument-hint: "<flow kind and purpose, e.g. 'research assistant flow with chat and summarize actions'>"
---

You are a development agent creating a new flow in the flow-state-dev framework. Flows are the top-level orchestration unit — they bind actions, scopes, state, resources, and capabilities into a registerable runtime.

## Core Principle

**Flows are thin orchestration glue.** The interesting logic lives in blocks and patterns. A flow's job is to wire actions to block pipelines, declare state schemas, and configure scopes. Keep the flow file focused on structure, not business logic.

## Workflow

### Step 1: Understand the Flow

Parse $ARGUMENTS to determine:
1. What is the flow's `kind` (URL-safe identifier)?
2. What actions does it need? (Each action is an entry point with its own inputSchema and block pipeline)
3. What state does it manage? (session state, user state, project state)
4. What resources does it need? (persisted typed data containers)
5. Does it use capabilities? (bundled resources + helpers from patterns or shared infra)
6. Does it need client data? (derived views exposed to the frontend)

### Step 2: Read Reference Flows

Before writing, read at least one existing flow:

| Flow | What to learn from it |
|------|----------------------|
| `examples/hello-chat/src/flows/hello-chat/flow.ts` | Minimal single-action flow, session state, userMessage, history |
| `apps/kitchen-sink/flows/chat-agent/` | Multi-action flow, resources, clientData, capabilities, middleware |

Also read:
- `docs/architecture/flows-and-actions.md` — Flow definition contract
- `docs/architecture/state-and-scopes.md` — Scope hierarchy and state operations
- `docs/architecture/resources-and-client-data.md` — Resources and clientData patterns
- `docs/contributing/best-practices.md` — BP-011 through BP-014

### Step 3: Design the Flow Structure

```
src/flows/<flow-kind>/
  flow.ts           # defineFlow() + export default instance
  blocks/           # Action pipeline blocks (one per file)
    <action-name>.ts
    ...
  schemas.ts        # Shared Zod schemas (input, state, resource)
  capabilities.ts   # Optional: flow-specific capabilities
```

**Key decisions:**

1. **Actions**: Each action is an entry point with `inputSchema`, `block`, and optional `userMessage`. Chat actions typically have `userMessage`; system/background actions don't.

2. **Scope state**: Use `session.stateSchema` for conversational state (message count, mode, preferences). Use `user.stateSchema` for cross-session user state. Use `project.stateSchema` for shared team state.

3. **Resources vs state**: Resources are named, typed data containers with their own schemas. Use resources for structured entities (plans, artifacts, documents). Use scope state for scalar/simple values (counters, modes, flags).

4. **Client data**: The sole gateway for exposing data to the frontend. Each `clientData` entry computes a view from state + resources.

### Step 4: Write the Flow

#### Schemas File

```typescript
/**
 * Schemas for the <flow-kind> flow.
 */
import { z } from "zod";

// Action input schemas
export const chatInputSchema = z.object({
  message: z.string().min(1),
});

// Session state schema
export const sessionStateSchema = z.object({
  messageCount: z.number().default(0),
  mode: z.enum(["chat", "plan"]).default("chat"),
});
```

#### Action Block Pipelines

Each action's block pipeline lives in `blocks/`:

```typescript
/**
 * Chat action pipeline — processes user messages through LLM and updates state.
 */
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { chatInputSchema } from "../schemas";

const chatGenerator = generator({
  name: "chat-generator",
  model: "openai/gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: chatInputSchema,
  history: (_input, ctx) => ctx.session.items.history(),
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
});

// Generator `prompt` accepts arrays for composition (PromptSlot):
// prompt: ["Base instructions.", config.systemPrompt, "Output format instructions."],

const incrementCount = handler({
  name: "increment-count",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    const count = ctx.session.state.messageCount ?? 0;
    await ctx.session.patchState({ messageCount: count + 1 });
    return input;
  },
});

export const chatPipeline = sequencer({ name: "chat-pipeline", inputSchema: chatInputSchema })
  .step(chatGenerator)
  .step(incrementCount);
```

#### Flow Definition

```typescript
/**
 * <Flow Kind> Flow
 *
 * <What this flow does in 2-3 sentences.>
 */
import { defineFlow } from "@flow-state-dev/core";
import { chatInputSchema, sessionStateSchema } from "./schemas";
import { chatPipeline } from "./blocks/chat";

const <flowKind>Flow = defineFlow({
  kind: "<flow-kind>",
  requireUser: true,

  actions: {
    chat: {
      inputSchema: chatInputSchema,
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },

  session: {
    stateSchema: sessionStateSchema,
  },
});

export default <flowKind>Flow({ id: "default" });
```

### Step 5: Advanced Configuration

#### Resources

Declare typed data containers on scopes:

```typescript
import { defineFlow, defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const planResource = defineResource({
  stateSchema: z.object({
    steps: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(["pending", "active", "done"]).default("pending"),
    })).default([]),
  }),
  writable: true,
  // Expose resource data to clients via ResourceClientConfig:
  client: {
    content: { read: true },
    data: (state) => ({ stepCount: state.steps.length }),
  },
});

defineFlow({
  kind: "planner",
  requireUser: true,
  actions: { /* ... */ },
  session: {
    stateSchema: sessionStateSchema,
    resources: {
      plan: planResource,
    },
  },
});
```

#### Client Data

Derived views for the frontend — computed from scope state and resources:

```typescript
session: {
  stateSchema: sessionStateSchema,
  resources: { plan: planResource },
  clientData: {
    activePlan: (ctx) => ctx.resources.plan?.state.steps ?? [],
    mode: (ctx) => ctx.state.mode,
    stats: (ctx) => ({
      messageCount: ctx.state.messageCount,
      planStepCount: ctx.resources.plan?.state.steps.length ?? 0,
    }),
  },
},
```

#### Capabilities

Use capabilities to bundle resources, helpers, and presets that blocks can opt into:

```typescript
import { defineCapability, defineResource } from "@flow-state-dev/core";

const memoryCapability = defineCapability({
  name: "memory",
  sessionResources: {
    memory: defineResource({
      stateSchema: z.object({ facts: z.array(z.string()).default([]) }),
      writable: true,
    }),
  },
  fns: (ctx) => ({
    recall: () => ctx.session.resources.memory.state.facts,
    store: async (fact: string) => {
      const facts = ctx.session.resources.memory.state.facts;
      await ctx.session.resources.memory.patchState({ facts: [...facts, fact] });
    },
  }),
  presets: {
    context: { context: [memoryContextFormatter] },
    tools: { tools: [recallTool, storeTool] },
    default: ["context", "tools"],
  },
});

// Generators opt into the capability
const agent = generator({
  name: "agent",
  uses: [memoryCapability],
  model: "openai/gpt-5-mini",
  prompt: "You are an assistant with memory.",
});
```

#### Lifecycle Hooks

Request-level hooks fire at request boundaries:

```typescript
request: {
  onStarted: logRequestStart,       // Fire when request begins
  onCompleted: logRequestComplete,   // Terminal success only
  onErrored: handleRequestError,     // Terminal failure only
  onStepErrored: logStepError,       // Non-terminal step/work failure (observational)
  onFinished: cleanupRequest,        // Always (success or failure)
  heartbeatIntervalMs: 10000,        // Active request registry heartbeat (default 10s, 0 to disable). Relevant for serverless.
},
```

Action-level hooks fire per-action:

```typescript
actions: {
  chat: {
    inputSchema: chatInputSchema,
    block: chatPipeline,
    userMessage: (input) => input.message,
    onCompleted: notifySuccess,      // This action succeeded
    onErrored: notifyFailure,        // This action failed
  },
},
```

#### Middleware

Intercept all block execution for logging, timing, or transformation:

```typescript
middleware: [
  {
    name: "timing",
    filter: (block) => block.kind === "generator",  // Optional: target specific block kinds
    execute: async (ctx, next) => {
      const start = Date.now();
      const output = await next();
      console.log(`${ctx.block.name} took ${Date.now() - start}ms`);
      return output;
    },
  },
],
```

#### Tools Configuration

Flow-level tool defaults and observability:

```typescript
tools: {
  defaults: {
    timeoutMs: 30000,
    concurrency: "parallel",
  },
  onToolStarted: logToolStart,
  onToolCompleted: logToolComplete,
  onToolErrored: handleToolError,
},
```

#### Token Budget

Per-action token controls:

```typescript
actions: {
  research: {
    inputSchema: researchInputSchema,
    block: researchPipeline,
    tokenBudget: {
      maxTotalTokens: 100000,
      warnAt: 80000,
      onExceeded: "stop",
    },
  },
},
```

### Step 6: Register the Flow

Flows are discovered by convention at `src/flows/**/flow.ts`. Each file exports a default `FlowInstance`:

```typescript
// src/flows/<flow-kind>/flow.ts
export default myFlow({ id: "default" });
```

For server registration, flows are passed to `createServer()` or `registerFlows()`:

```typescript
import { createServer } from "@flow-state-dev/server";
import myFlow from "./flows/my-flow/flow";

const server = createServer({
  flows: [myFlow],
  stores: createSqliteStores({ path: "./data/store.db" }),
});
```

### Step 7: Verify

```bash
pnpm typecheck
pnpm test
```

If the flow is in an example app, start the dev server and test via the client or CLI:

```bash
pnpm --filter <app> dev
# In another terminal:
fsdev run <flow-kind> chat --input '{"message": "hello"}'
```

## Critical Rules

- **`requireUser: true` is mandatory in Phase 1.** The framework throws if set to `false`.
- **Actions are flow-level only.** Don't nest them inside scope configs.
- **Hooks use past tense.** `onStarted`, `onCompleted`, `onErrored`, `onFinished` — never present tense.
- **Client data is the sole frontend gateway.** Raw state/resources never reach the client directly.
- **Block-declared resources auto-merge.** Blocks that declare `sessionResources` etc. get merged into the flow's scope configs automatically. Flow-level declarations win on conflict.
- **Partial state schemas on blocks.** Blocks declare only the state fields they use. The flow-level `stateSchema` is the full picture.
- **BP-011**: Don't call `block.run()` inside handlers. Compose with sequencers.
- **BP-014**: Handlers must never `return input`. Use `.tap()` for state-only mutations.
- **Abort support.** RequestStatus includes `"aborted"`. Blocks can check `ctx.signal` (AbortSignal) for client-initiated cancellation. Long-running handlers should respect the signal to enable graceful abort.

## Guidelines

- **Start minimal.** Begin with one action, one scope, no resources. Add complexity only when needed.
- **Actions map to user intents.** "chat", "summarize", "plan" — not "processStep1". Each action is a meaningful entry point.
- **Scope state for simple values.** Counters, modes, flags go in `stateSchema`. Structured entities go in resources.
- **Generators handle LLM calls.** Handlers handle logic. Sequencers compose them. Don't mix concerns.
- **Use `userMessage` for conversational actions.** It emits a user-role MessageItem in the stream. Omit for background/system actions.
- **Prefer capabilities over manual resource wiring.** If multiple blocks need the same resources + helpers, package as a capability.
