---
title: Block options
sidebar_label: Block options
description: Shared block fields plus generator, handler, sequencer, and router options.
---

# Block options

Every block takes a config object. Shared fields live on every kind. Generators, handlers, sequencers, and routers add their own.

Narrative: [Blocks](/docs/fundamentals/blocks), [Sequencers](/docs/sequencers/overview), [Generator context](/docs/advanced/generator-context).

## Shared fields

These appear on handlers, generators, routers, and (where noted) sequencers.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `name` | `string` | required | Block id. Used in traces, DevTool, and item provenance. |
| `description` | `string` | — | Human description. |
| `inputSchema` / `outputSchema` | Zod schema | — | Typed input and output. |
| `stateSchema` | Zod schema | — | This block's own request-scoped state (`ctx.self`). |
| `transient` | `boolean` | — | Omit this block's items from the persisted session log. |
| `connectInput` | `(input, ctx) => nextInput` | identity | Map the previous step's output into this block's input. |
| `activeStatusMessage` | `string` or `(input, ctx) => string` | — | Emits `ctx.emit.status()` when the block starts. |
| `container` | `{ component?, label?, metadata? }` | — | UI container metadata. |
| `retry` | `RetryPolicy` | — | `{ maxAttempts?, baseDelayMs?, maxDelayMs?, retryableErrors? }`. |
| `rescue` | `RescueHandlerSpec[]` | — | Per-block recovery. The first matching `when` runs and its output replaces the throw. Sequencers use `.rescue()` on the chain instead. |
| `requireOrg` | `boolean` | — | The flow rejects requests whose session has no `orgId`. |
| `cacheable` | `true` or `BlockCacheableConfig` | off | Memoize this block's result when it is installed as a **generator tool**. No effect as a sequencer step. |
| `onCompleted` / `onErrored` | hook | — | After success or failure. |
| `uses` | capability list | — | Install capabilities (resources, context, tools, maybe a model). |

### `cacheable`

Only applies when the block is a tool on a generator. Errors are never cached. Identical in-flight calls in one request share one execution.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `ttl` | `number` (ms) | 5 minutes | `0` disables caching. |
| `scope` | `"run"` \| `"request"` \| `"session"` | `"run"` | How widely a cached result may be reused. |
| `keyFn` | `(args) => string` | JSON canonicalize | Custom cache key. |
| `cacheIf` | predicate | all successes | Gate writes. |

## Generator

`generator({ ... })` calls a model, assembles the prompt, runs the tool loop, and streams items.

```ts
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
  maxTokens: 2048,
});
```

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `prompt` | string, fn, slot, or `PromptFile` | required | System prompt. A `PromptFile` can also supply `user`, `caching`, `maxTokens`, and related siblings; an explicit sibling on this config wins. |
| `model` | model id, intent, or resolver | required unless a capability supplies one | What to call. Block-level always wins over a capability. |
| `user` | string, fn, or slot | — | The user message for this turn. |
| `context` | slot | — | Extra system/context material. |
| `history` | `true`, query, or slot | off | Prior turns. `true` loads the session window. |
| `tools` | tool list or `(input, ctx) => tools` | — | Tools the model may call. |
| `uses` | capability list | — | May contribute model, tools, context, and resources. |
| `itemVisibility` | `{ client, history }` | **unset = no auto-emission** | Who sees auto-emitted messages. See [Visibility](#itemvisibility). |
| `agentName` | `string` | block `name` when visibility is set | Provenance stamp. Shared names collaborate; distinct names stay isolated. |
| `search` | `true` or search config | off | Provider-native web search, resolved from the model at run time. |
| `providerTools` | `ProviderTool[]` | — | AI SDK provider-defined tools, passed through as-is. |
| `loop` | `{ maxIterations?, runTools?, stopWhen? }` | — | Tool-loop policy. |
| `maxIterations` | `number` | — | Legacy loop cap. Prefer `loop.maxIterations`. |
| `maxTokens` | `number` | — | Output token cap. |
| `repair` | `GeneratorRepairConfig` | — | Structured-output repair. |
| `repairOutput` | fn | — | Custom repair of a failed structured parse. |
| `caching` | caching config or resolver | `{ enabled: true, breakpoints: "auto", ttl: "5m" }` | Prompt caching. `{ enabled: false }` turns it off. |
| `describeTools` | `boolean` | `true` | Inject tool name + description into the system context. |
| `providerOptions` | options or resolver | — | Passed through to the AI SDK provider. |
| `flowTools` | `ToolsConfig` | flow `tools` | Override flow-level tool defaults for this generator. |
| `retry` | `RetryPolicy` | — | Retry the model call. |

Scope schemas (`requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema`, `sequencerStateSchema`, `parentStateSchema`), `resources`, and `targetStateSchemas` work the same as on a handler.

### `itemVisibility`

Unset means the generator does **not** auto-emit conversational items. Only typed `block_trace` output flows to parents. Pattern factories set visibility on the generators they create.

| Value | Client UI | Next-turn history |
|-------|-----------|-------------------|
| `{ client: true, history: true }` | yes | yes — primary user-facing agent |
| `{ client: true, history: false }` | yes | no — observable sub-agent work |
| `{ client: false, history: true }` | no | yes — private injected context |
| `{ client: false, history: false }` | no | no — DevTool / trace only |

### `repair`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `mode` | `"auto"` \| `"rescue"` \| `"fail"` | — | How a structured-output failure is handled. |
| `maxAttempts` | `number` | — | Repair attempts. |
| `coerce` | `boolean` or `{ model? }` | enabled | LLM coercion pass. |

### `loop`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `maxIterations` | `number` | — | Stop the tool loop after this many rounds. |
| `runTools` | `boolean` | — | When `false`, the model may propose tools but they are not executed. |
| `stopWhen` | `(state, ctx) => boolean` | — | Early exit. |

## Handler

`handler({ execute })` is deterministic compute: validate, transform, mutate state, implement a tool.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `execute` | `(input, ctx) => output` | required | The body. |
| `uses` | capability list | — | Install capabilities. |
| `resources` | resource map | — | Resources this handler declares. |
| `requestStateSchema` / `sessionStateSchema` / `userStateSchema` / `orgStateSchema` / `sequencerStateSchema` | Zod schema | — | Scope slices this handler reads or writes. |
| `parentInputSchema` / `parentStateSchema` | Zod schema | — | What this handler expects from its parent. |
| `targetStateSchemas` | map | — | Named sibling/ancestor state handles (`ctx.targets`). |

Plus the [shared fields](#shared-fields).

## Sequencer

`sequencer({ name })` is the pipeline. Methods (`.step`, `.parallel`, `.rescue`, …) live on the returned builder; they are not config fields. See [Control flow](/docs/sequencers/control-flow).

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `name` | `string` | required | Sequencer id. |
| `description` | `string` | — | Human description. |
| `inputSchema` / `outputSchema` | Zod schema | — | Pipeline I/O. Declare `outputSchema` when callers need a typed result. |
| `stateSchema` | Zod schema | — | Sequencer state (`ctx.sequencer` and `ctx.self` in its own callbacks). |
| `uses` | capability list | — | Capabilities installed on the sequencer. |
| `durable` | `boolean` | `true` | Checkpoint at step boundaries. Set `false` for ephemeral or test pipelines. |
| `transient` | `boolean` | — | Omit items from the persisted log. |
| `activeStatusMessage` | string or fn | — | Status when the sequencer starts. |
| `container` | object | — | UI container metadata. |

`durable: true` on the sequencer writes checkpoints. Crash recovery and `ctx.suspend()` also need `durable: true` on `createFlowState` and `durable: true` on the action. See [Durable execution](/docs/advanced/durable-execution).

## Router

`router({ routes, execute })` picks one child block at runtime. `execute` returns the block to run; the framework then runs that block with the router's input.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `routes` | `BlockDefinition[]` | required | The candidates `execute` may return. |
| `execute` | `(input, ctx) => BlockDefinition` | required | Selector. `stateSchema` is read-only here. |
| `uses` / scope schemas / `resources` | same as handler | — | Same declaration surface as a handler. |

Plus the [shared fields](#shared-fields).

## See also

- [Flow options](./flow) — where blocks are mounted as actions
- [Capabilities](/docs/fundamentals/capabilities)
- [Generator prompts as Markdown](/docs/advanced/generator-prompts-markdown)
- [Block memoization](/docs/advanced/block-memoization-and-replay)
