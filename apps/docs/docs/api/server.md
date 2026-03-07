---
sidebar_position: 2
---

# Server API

`@flow-state-dev/server` — Action runtime, stores, SSE streaming, orchestration.

## Registry & Router

### `createFlowRegistry()`

Create a registry for flow instances.

```ts
import { createFlowRegistry } from "@flow-state-dev/server";

const registry = createFlowRegistry();
registry.register(myFlow);
```

### `createFlowApiRouter(options)`

Create HTTP route handlers for the flow API.

```ts
import { createFlowApiRouter } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  stores: createFilesystemStores(),      // optional, default
  modelResolver: createAiSdkModelResolver(fn),  // optional
  speechResolver: createAiSdkSpeechResolver(fn),       // optional, for TTS
  transcriptionResolver: createAiSdkTranscriptionResolver(fn), // optional, for STT
});

// Use with Next.js App Router:
export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
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

### `createAiSdkModelResolver(resolver)`

Create a model resolver using AI SDK providers.

```ts
import { createAiSdkModelResolver } from "@flow-state-dev/server";

const resolver = createAiSdkModelResolver((modelId) => {
  return openai(modelId);
});
```

### `createDefaultModelResolver()`

Default resolver using Vercel AI Gateway.

## Voice

### `createAiSdkSpeechResolver(resolver)`

Create a speech resolver (TTS) using AI SDK providers.

```ts
import { createAiSdkSpeechResolver } from "@flow-state-dev/server";

const speechResolver = createAiSdkSpeechResolver(
  (modelId) => openai.speech(modelId)
);
```

### `wrapAiSdkSpeechModel(model, modelId?)`

Wrap a single AI SDK speech model into a framework `SpeechModel`.

### `createAiSdkTranscriptionResolver(resolver)`

Create a transcription resolver (STT) using AI SDK providers.

```ts
import { createAiSdkTranscriptionResolver } from "@flow-state-dev/server";

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
