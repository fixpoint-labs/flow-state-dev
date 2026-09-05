---
sidebar_position: 2
title: Engine API
sidebar_label: Engine
---

# Engine API

`@flow-state-dev/engine` — Action runtime, stores, SSE streaming, orchestration.

## Runtime

### `createFlowState(options)`

The main entry point. Assemble a runtime from declarative config. Returns a `FlowState` handle. Most users want this rather than the lower-level registry and router below.

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

`flows` and `stores` are required; the rest have defaults. Every option, with its type and default, is catalogued in [Runtime options](/docs/configuration/runtime) — including the model, store, worker, durability, and sweeper groups.

Construction is synchronous and validates config (empty `stores`, unknown `defaultProfile`) by throwing `FlowStateConfigError`. Stores initialize lazily on first `getRouter()` / `ready()`.

### `FlowState`

The handle returned by `createFlowState`.

```ts
interface FlowState<TSettings extends object = FlowStateSettings> {
  /** Resolve the lazy router. First call triggers async store init. */
  getRouter(): Promise<FlowApiRouter>;
  /** Eager warmup. Idempotent. */
  ready(): Promise<void>;
  /** Drain in-process background work, close the worker, release pooled resources. */
  dispose(): Promise<void>;
  /** The active profile name. */
  readonly activeProfile: string;
  /** The settings bag, typed via TSettings. */
  readonly settings: TSettings;
  /** Diagnostics. */
  readonly meta: {
    flowKeys: string[];
    profileKeys: string[];
    declaredSlots: Record<string, CapabilitySlot[]>;
  };
}
```

#### Shutdown

`dispose()` runs in order:

1. Waits for background work still running in this process. A job handed to a queue is not waited for here — but if this process also *consumes* that queue, step 5 waits for whatever it has already claimed.
2. Bounds that wait with `dispatchDrainTimeoutMs`, default 30000 ms. It's a ceiling, not a target: work that finishes sooner is not delayed. `0` means don't wait at all.
3. Cancels whatever is still running when the budget runs out, and gives it a brief window, inside that same budget rather than added to it, to unwind.
4. Reports the request ids and session ids it gave up on, on stderr. That report prints even when the runtime's logger is silenced, since work may have been left unfinished.
5. Closes the worker and releases pooled resources across every declared store adapter. Closing the worker waits for any queue job this process has already claimed, and that wait is **not** bounded by `dispatchDrainTimeoutMs` — it takes as long as the job does. Size your platform's kill timeout for the longest job.

Shutdown mostly does not write a terminal status on background work's behalf. It cancels the work rather than marking those records finished or failed. One case doesn't follow that yet: work still waiting behind a concurrency limit when shutdown reaches it is recorded `aborted` without ever having started. For what the cancelled work leaves in the task board and the request log, and how each recovers, see [What a stopped process leaves behind](../server/background-work.md#what-a-stopped-process-leaves-behind).

`fsdev run` and `fsdev chat` shut down through the same path. See [Waiting for in-process work](../cli/overview.md#waiting-for-in-process-work).

### `StoreAdapter`

A tagged value a store-adapter factory returns. Declares which capability slots it backs and realizes them on demand.

```ts
interface StoreAdapter {
  /** Slots this adapter is willing to back. */
  readonly capabilities: ReadonlyArray<CapabilitySlot>;
  /** Realize the adapter for the given slots. Opens pools / runs schema init. */
  resolve(slots: ReadonlyArray<CapabilitySlot>): Promise<Partial<StoreRegistry>>;
  /** Release pooled resources. Called by FlowState.dispose(). */
  dispose?(): Promise<void> | void;
}
```

`CapabilitySlot` is `"primary" | "blobs" | "queue" | "scheduler"`. Only `primary` is implemented in Phase 1; the others are declared but forward-compatible.

Store-adapter factories: `inMemoryStores()`, `filesystemStores({ rootDir })` (this package), `postgresStores(options)` (`@flow-state-dev/store-postgres`), `sqliteStores(options)` (`@flow-state-dev/store-sqlite`), `vercelPostgresStores()` (`@flow-state-dev/vercel/store`).

## Registry & Router (lower-level)

`createFlowState` wraps these. Reach for them only for custom transports or advanced wiring.

### `createFlowRegistry()`

Create a registry for flow instances.

```ts
import { createFlowRegistry } from "@flow-state-dev/engine";

const registry = createFlowRegistry();
registry.register(myFlow);
```

### `createFlowApiRouter(options)`

Create HTTP route handlers for the flow API from a registry.

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";

const router = createFlowApiRouter({
  registry,
  stores,                                // a resolved StoreRegistry
  modelResolver: createModelResolver(),  // optional
  voiceProvider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }), // optional, for TTS/STT
});

export const { GET, POST, PATCH, DELETE } = router;
```

### `parseFlowRoute(path)`

Parse a flow API path into its components (kind, action, sessionId, etc.).

## Execution

### `createExecutionContext(options)`

Create a block execution context manually (for advanced use).

### `runAction(options)`

Execute a flow action programmatically.

### `executeBlock(block, input, ctx)`

Execute a block directly with a given context.

## Stores

### `createFilesystemStores(options?)`

Filesystem-backed persistence for local development. Durable across restarts, but its per-request event log doesn't scale under production load — use SQLite (single server) or Postgres (multi-instance) in production.

```ts
import { createFilesystemStores } from "@flow-state-dev/engine";

const stores = createFilesystemStores({ rootDir: ".fsdev/data" });
```

### `createInMemoryStores()`

In-memory persistence for testing.

```ts
import { createInMemoryStores } from "@flow-state-dev/engine";

const stores = createInMemoryStores();
```

## Model Resolution

### `createModelResolver(options?)`

Create a model resolver. Auto-detects providers from environment variables with zero config, or accepts explicit keys, intents, and retry policy.

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

// Zero-config: auto-detects from env vars
const resolver = createModelResolver();

// With options:
const resolver = createModelResolver({
  keys: { openai: "sk-..." },
  defaultModel: "openai/gpt-5.4-mini",
  intents: { utility: ["openai/gpt-5.4-mini", "anthropic/claude-haiku-4-5"] },
  retryPolicy: { maxAttemptsPerModel: 3 },
});
```

Model strings use slash format: `"openai/gpt-5.4"`, `"anthropic/claude-sonnet-4-6"`, `"vercel/openai/gpt-5.4"`.

### `parseModelString(modelString)`

Parse a slash-format model string into its components (provider, model, gateway).

## Voice

Voice surfaces are owned by a `VoiceProvider` passed as `voiceProvider` to `createFlowApiRouter` (or `voice: { provider }` on `createFlowState`). A provider declares its `abilities` and implements `speak` / `speakStream` / `transcribe` / `listVoices`. Concrete providers ship in their own packages (e.g. `@flow-state-dev/voice-openai`). See [Voice](/docs/advanced/voice) for the full guide.

### `createCompositeVoiceProvider(config)`

Combine providers per ability (e.g. synthesize with one, transcribe with another). Exported from `@flow-state-dev/core`.

### `createSentenceBuffer()`

Create a sentence-boundary detection buffer for TTS text chunking.

### `createTTSPipeline(options)`

Create the synthesis pipeline that converts text deltas into `OutputAudioContent`.

### `createTTSEmitterHook(options)`

Create an event observer that wires the TTS pipeline to a `ResponseEmitter`.

## Streaming

### `createResponseEmitter(options)`

Create a stream emitter for manual event emission.

### `encodeStreamEvent(event)`

Encode an event for SSE transmission.

### `serializeSSEFrame(event)`

Serialize an event into SSE wire format.

### `replayRequestEvents(options)`

Replay stored events from a completed request (for resume).

## Errors

### `FlowError`

Base error class with `code`, `retryable`, `blockName`, `scope`, and `cause`.

Subclasses:
- `ValidationError` — Schema validation failure (not retryable)
- `NetworkError` — Network issues (retryable)
- `TimeoutError` — Operation timeout (retryable)
- `RateLimitError` — Rate limit hit (retryable)
- `ModelError` — Model provider error (retryable)
- `ToolExecutionError` — Tool block failure (varies)

### `normalizeError(error)`

Convert any thrown value to a `FlowError`.
