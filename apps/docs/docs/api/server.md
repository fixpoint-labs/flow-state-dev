---
sidebar_position: 2
---

# Server API

`@flow-state-dev/server` — Action runtime, stores, SSE streaming, orchestration.

## Runtime

### `createFlowState(options)`

The main entry point. Assemble a runtime from declarative config. Returns a `FlowState` handle. Most users want this rather than the lower-level registry and router below.

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";

const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

Selected options:

| Option | Type | Notes |
|--------|------|-------|
| `flows` | `Record<string, FlowInstance>` | Required. Stable key to flow instance. |
| `models` | `FlowStateModelsConfig` | `{ default?, intents?, ... }`. Auto-wires AI Gateway via `AI_GATEWAY_API_KEY`. |
| `modelResolver` | `ModelResolver` | Escape hatch: a pre-built resolver (test mocks, custom resolvers). Used instead of `models`. |
| `voice` | `{ speech?, transcription? }` | Pass AI SDK providers like `openai.speech`. |
| `stores` | `StoresConfig` | Required. Named profiles of capability slots. |
| `defaultProfile` | `string` | Active profile when `FSD_ENV` is unset. |
| `settings` | `TSettings` | Read in blocks via `ctx.settings`. |
| `onError` | `(error, ctx) => void` | `ctx` is `{ method, path }`. |
| `onBackgroundWork` | `(p) => void` | Serverless keep-alive, e.g. `(p) => after(() => p)`. |
| `defaultSseHeartbeatMs` | `number` | Wire-level SSE heartbeat cadence. |

Construction is synchronous and validates config (empty `stores`, unknown `defaultProfile`) by throwing `FlowStateConfigError`. Stores initialize lazily on first `getRouter()` / `ready()`.

### `FlowState`

The handle returned by `createFlowState`.

```ts
interface FlowState<TSettings extends object = FlowStateSettings> {
  /** Resolve the lazy router. First call triggers async store init. */
  getRouter(): Promise<FlowApiRouter>;
  /** Eager warmup. Idempotent. */
  ready(): Promise<void>;
  /** Dispose pooled resources across every declared adapter. */
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
import { createFlowRegistry } from "@flow-state-dev/server";

const registry = createFlowRegistry();
registry.register(myFlow);
```

### `createFlowApiRouter(options)`

Create HTTP route handlers for the flow API from a registry.

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  stores,                                // a resolved StoreRegistry
  modelResolver: createModelResolver(),  // optional
  speechResolver: createAiSdkSpeechResolver(fn),       // optional, for TTS
  transcriptionResolver: createAiSdkTranscriptionResolver(fn), // optional, for STT
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

Filesystem-backed persistence (default).

```ts
import { createFilesystemStores } from "@flow-state-dev/server";

const stores = createFilesystemStores({ basePath: ".flow-state" });
```

### `createInMemoryStores()`

In-memory persistence for testing.

```ts
import { createInMemoryStores } from "@flow-state-dev/server";

const stores = createInMemoryStores();
```

## Model Resolution

### `createModelResolver(options?)`

Create a model resolver. Auto-detects providers from environment variables with zero config, or accepts explicit keys, presets, and retry policy.

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

// Zero-config: auto-detects from env vars
const resolver = createModelResolver();

// With options:
const resolver = createModelResolver({
  keys: { openai: "sk-..." },
  presets: { fast: { models: ["openai/gpt-5.4-mini"] } },
  retryPolicy: { maxAttemptsPerModel: 3 },
});
```

Model strings use slash format: `"openai/gpt-5.4"`, `"anthropic/claude-sonnet-4-6"`, `"vercel/openai/gpt-5.4"`.

### `parseModelString(modelString)`

Parse a slash-format model string into its components (provider, model, gateway).

## Voice

### `createAiSdkSpeechResolver(resolver)`

Create a speech resolver (TTS) using AI SDK providers.

```ts
import { createAiSdkSpeechResolver } from "@flow-state-dev/core/models";

const speechResolver = createAiSdkSpeechResolver(
  (modelId) => openai.speech(modelId)
);
```

### `wrapAiSdkSpeechModel(model, modelId?)`

Wrap a single AI SDK speech model into a framework `SpeechModel`.

### `createAiSdkTranscriptionResolver(resolver)`

Create a transcription resolver (STT) using AI SDK providers.

```ts
import { createAiSdkTranscriptionResolver } from "@flow-state-dev/core/models";

const transcriptionResolver = createAiSdkTranscriptionResolver(
  (modelId) => openai.transcription(modelId)
);
```

### `wrapAiSdkTranscriptionModel(model, modelId?)`

Wrap a single AI SDK transcription model into a framework `TranscriptionModel`.

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
