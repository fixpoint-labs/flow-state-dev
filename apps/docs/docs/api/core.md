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
  targetStateSchemas: {
    research: z.object({ progress: z.number() }),
  },
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: 1 });
    // ctx.targets.research is StateRef<{ progress: number }> | undefined
    await ctx.targets.research?.patchState({ progress: 50 });
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
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ response: z.string() }),
  targetStateSchemas: {
    research: z.object({ progress: z.number() }),
  },
  user: (input, ctx) => {
    const progress = ctx.targets.research?.state.progress ?? 0;
    return `progress:${progress} — ${input.message}`;
  },
  tools: [myTool],
  search: true,
  context: [myContextFn],
  history: true,
  repair: { mode: "auto", maxAttempts: 3 },
});
```

**Identity config:**

- `agentType?: "primary" | "sub" | "trace"` — Declares the generator's identity. Governs visibility of auto-emitted conversational items (messages, reasoning, tool outputs). `"primary"` = user-facing (client + history). `"sub"` = task-executor (client, not history). `"trace"` = observability-only (neither). When **unset**, the generator performs no auto-emission — only its typed `block_output` flows via graph edges. No position-inferred default; every generator declares.
- `agentName?: string` — Stable name stamped on every emitted item. Defaults to the block's `name` when `agentType` is set. Generators that share an `agentName` represent the same logical agent; distinct names stay isolated. Used by the client for per-agent rendering and by `items.selectForContext({ agentName })` for scoped context assembly.

**Search config:**

- `search?: boolean | GeneratorSearchConfig` — Enable provider-native web search. `true` uses defaults; pass a config object for fine-grained control (`maxUses`, `allowedDomains`, `blockedDomains`, `userLocation`, `searchDepth`).

**Provider tools:**

- `providerTools?: ProviderTool[]` — Raw provider-defined tool objects passed directly to the AI SDK, bypassing the block lifecycle.

### `providerTool(name, tool)`

Create a provider tool wrapper for use in `generator({ providerTools })`.

```ts
import { providerTool } from "@flow-state-dev/core";
import { anthropic } from "@ai-sdk/anthropic";

const codeExec = providerTool("code_execution", anthropic.tools.codeExecution());
```

Returns `{ __providerTool: true, name: string, tool: unknown }`.

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

**Methods:** `then`, `thenIf`, `map`, `parallel`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `loopBack`, `work`, `workIf`, `background`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`, `thenAll`, `thenAny`, `race`, `exitIf`

### `router(config)`

Create a runtime block-selection block.

```ts
import { router } from "@flow-state-dev/core";

const myRouter = router({
  name: "mode-router",
  inputSchema: z.object({ mode: z.string() }),
  targetStateSchemas: {
    coordinator: z.object({ step: z.number() }),
  },
  routes: [chatBlock, agentBlock],
  execute: async (input, ctx) => {
    const step = ctx.targets.coordinator?.state.step ?? 0;
    return step > 0 ? agentBlock : chatBlock;
  },
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
  session: { stateSchema, resources, clientData },
  user: { stateSchema, resources, clientData },
  request: { onStarted, onCompleted, onErrored, onFinished, onStepErrored },
});

export default myFlow({ id: "default" });
```

## Resources

### `defineResource(config)`

Create a portable resource definition. Can be used in flow scope configs and in block-level resource declarations (`sessionResources`, `userResources`, `orgResources`):

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


Resource content options:

- `content?: string` — inline definition-time body
- `contentFile?: string` — load initial body from a file path (mutually exclusive with `content`)
- `render?: (content, state) => string | Promise<string>` — optional renderer for `readContent()`
- `llmReadable?: boolean` — allows read access when `readResourceContentTool()` is installed
- `llmWritable?: boolean` — allows write access when `writeResourceContentTool()` is installed

Runtime resource content methods:

- `await ctx.session.resources.plan.readContent()` → rendered content or `null`
- `await ctx.session.resources.plan.readContentRaw()` → raw stored content or `null`
- `await ctx.session.resources.plan.writeContent("...")` → overwrite stored content

For explicit LLM access, add tools manually to generators:

```ts
import {
  generator,
  readResourceContentTool,
  writeResourceContentTool,
} from "@flow-state-dev/core";

const agent = generator({
  name: "agent",
  model: "preset/fast",
  prompt: "You can inspect and edit approved resource files.",
  tools: [readResourceContentTool(), writeResourceContentTool()],
});
```

### `defineResourceCollection(config)`

Create a resource collection — a typed set of resources created and destroyed at runtime:

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});
```

Config options:

- `pattern: string` — glob pattern: `files/*` (single-level), `files/**` (deep), `[topic]/observations` (parameterized)
- `stateSchema: ZodTypeAny` — schema for each instance's state
- `maxInstances?: number` — cap on simultaneous instances (must be >= 1)
- `eviction?: "none" | "lru" | "oldest"` — what to do when cap is reached (default: `"none"` = throw)
- `onInstanceCreated?: (key, state, ctx) => void` — lifecycle hook
- `onInstanceUpdated?: (key, state, prevState, ctx) => void` — lifecycle hook
- `onInstanceDeleted?: (key, ctx) => void` — lifecycle hook

Runtime `ResourceCollectionRef` methods:

- `create(key, initial?)` — create a new instance (throws if exists or at cap with no eviction)
- `get(key)` — get existing instance (throws if not found)
- `getOptional(key)` — get existing instance or `undefined`
- `getOrCreate(key, initial?)` — returns existing if present, creates if not
- `list(prefix?)` — list all instances, optionally filtered by prefix
- `delete(key)` — delete an instance (no-op if not found)
- `count()` — current instance count

Use in blocks the same way as `defineResource`:

```ts
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesNamespace },
  execute: async (input, ctx) => {
    const ref = await ctx.session.resources.files.create("readme.md");
    return ref.state;
  },
});
```

## Context Functions

### `contextFn(schemas, fn)`

Create a typed context function for generators. Provides typed access to scope state via schema inference:

```ts
import { contextFn } from "@flow-state-dev/core";
import { section, list } from "@flow-state-dev/core/prompt";

const researchContext = contextFn(
  { session: sessionStateSchema },
  ({ session }) => {
    if (session.coveredTopics.length === 0) return "";
    return section("Research Progress", list(session.coveredTopics));
  }
);

// Use in any generator
const agent = generator({
  context: [researchContext],
  // ...
});
```

Three overloads: `(session)`, `(session, user)`, `(session, user, org)`.

## Prompt Formatters

`@flow-state-dev/core/prompt` — Composable text formatters for building clean LLM context.

| Formatter | Signature | Description |
|-----------|-----------|-------------|
| `section(title, ...content)` | `(string, ...string[]) => string` | Titled section with `##` header |
| `list(items, options?)` | `(string[], { ordered?, prefix? }) => string` | Bullet or numbered list |
| `keyValues(data)` | `(Record<string, unknown>) => string` | Key-value pairs |
| `entries(record, formatter)` | `(Record, fn) => string` | Mapped record entries |
| `codeBlock(code, language?)` | `(string, string?) => string` | Fenced code block |
| `join(...parts)` | `(...(string \| falsy)[]) => string` | Join with newlines, filtering falsy |
| `when(condition, content)` | `(boolean, string) => string \| ""` | Conditional inclusion |

## Client Data

### `clientData` on scope configs

Expose derived state to the frontend. Define compute functions on `session`, `user`, or `org` scope configs:

```ts
defineFlow({
  session: {
    stateSchema,
    clientData: {
      topicList: (ctx) => ctx.state.coveredTopics,
      progress: (ctx) => ({
        total: ctx.state.totalSteps,
        completed: ctx.state.completedSteps,
      }),
    },
  },
});
```

Compute functions receive `{ state, resources }` from their scope. All entries are client-visible. Values must be JSON-serializable.

## Voice Types

### `SpeechModel`

Provider-agnostic interface for text-to-speech synthesis.

```ts
import type { SpeechModel } from "@flow-state-dev/core";

const model: SpeechModel = {
  modelId: "gpt-4o-mini-tts",
  generate: async (options) => ({ audio: uint8Array, mediaType: "audio/mp3" }),
};
```

### `TranscriptionModel`

Provider-agnostic interface for speech-to-text transcription.

```ts
import type { TranscriptionModel } from "@flow-state-dev/core";

const model: TranscriptionModel = {
  modelId: "gpt-4o-mini-transcribe",
  transcribe: async (options) => ({ text: "Hello" }),
};
```

### `VoiceConfig`

Flow-level voice configuration. Set on `defineFlow({ voice })`.

```ts
type VoiceConfig = {
  tts?: {
    model: string | SpeechModel;
    voice?: string;
    speed?: number;
  };
};
```

### `OutputAudioContent`

Content part for synthesized audio.

```ts
type OutputAudioContent = {
  type: "output_audio";
  audio: string;        // base64
  mediaType: string;    // "audio/mp3", "audio/wav", etc.
  transcript?: string;
  duration?: number;
};
```

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
- `@flow-state-dev/core/prompt` — Composable prompt formatters (`section`, `list`, `keyValues`, `entries`, `codeBlock`, `join`, `when`)
