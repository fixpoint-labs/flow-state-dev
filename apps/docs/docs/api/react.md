---
sidebar_position: 4
---

# React API

`@flow-state-dev/react` — React hooks, renderers, and context providers.

Peer dependency: `react ^18.0.0 || ^19.0.0`

## FlowProvider

```tsx
import { FlowProvider } from "@flow-state-dev/react";

<FlowProvider
  flowKind="my-app"
  sessionId="optional-initial-session"
  userId="devuser"
  baseUrl="/api/flows"
  renderers={{
    message: MessageComponent,
    reasoning: ReasoningComponent,
    component: {
      "chart": ChartComponent,
    },
  }}
>
  {children}
</FlowProvider>
```

Nested providers merge `renderers` (child keys override parent keys).

## Hooks

### `useFlow(options?)`

Session lifecycle management.

```ts
const flow = useFlow({ autoCreateSession: true });

flow.sessions;           // SessionDetail[]
flow.activeSessionId;    // string | null
flow.createSession();    // Promise<string>
flow.selectSession(id);  // void
```

### `useSession(sessionId, options?)`

Primary hook for session data and actions.

```ts
const session = useSession(sessionId, {
  items: true,                              // default
  items: false,                             // skip items
  items: { visibility: "ui" },             // filter by visibility
  items: { includeTransient: false },       // exclude transient items
});

session.detail;          // SessionDetail | null
session.snapshot;        // SessionStateSnapshotResponse | null
session.latestRequest;   // SessionRequestSummary | null — most recent request (any status)
session.items;           // OutputItem[]  — includes sub-agent items
session.messages;        // MessageItem[]
session.blockOutputs;    // BlockTraceItem[]
session.functionCalls;   // FunctionCallItem[]
session.isLoading;       // boolean
session.isStreaming;     // boolean
session.error;           // Error | null

// Identity-based filtering:
session.getItemsByAgent("researcher");      // items stamped with agentName
session.getItemsByVisibility({ history: false }); // items by visibility

// Container-scoped items:
session.getOwnedItems(containerBlockInstanceId);

await session.sendAction("chat", { message: "Hello!" });
await session.abortRequest();        // signal in-flight request to stop
await session.resumeLatestRequest(); // re-dispatch latest if interrupted/failed
session.refresh();
```

`resumeLatestRequest` is a no-op unless `latestRequest.status` is `interrupted` or `failed`. The server creates a new request that re-runs the original action with the same input, and the hook auto-attaches to its stream.

### `useClientData(session, options)`

Read client data values from session state snapshot.

```ts
// String array mode — subscribe by name
const data = useClientData(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});

// Schema mode — subscribe with type inference
const data = useClientData(session, {
  session: {
    activePlan: activePlanSchema,
  },
});
```

### `useAction(options)`

Low-level action execution.

```ts
const { execute, loading, error } = useAction({
  flowKind: "my-app",
  action: "chat",
  userId: "devuser",
});

await execute({ message: "Hello!" });
```

### `useRequestStream(options)`

Direct request-stream access.

```ts
const { items, status, isStreaming } = useRequestStream({
  requestId,
  filter: { itemTypes: ["message", "component"] },
});
```

### `useVoice(session, options)`

Voice input/output composing with `useSession`.

```ts
import { useVoice } from "@flow-state-dev/react";

const voice = useVoice(session, {
  action: "run",
  buildInput: (transcript) => ({ message: transcript }),
});

voice.isListening;       // boolean — mic is recording
voice.isSpeaking;        // boolean — audio playback active
voice.isProcessing;      // boolean — server transcribing
voice.interimTranscript; // string — browser speech recognition (interim)

voice.startListening();  // start recording
voice.stopListening();   // stop recording, transcribe, send action
voice.stopSpeaking();    // stop audio playback
```

See the [Voice guide](/docs/advanced/voice) for full usage details.

## Renderers

### `ItemRenderer`

Render a single item using the registered renderer.

```tsx
import { ItemRenderer } from "@flow-state-dev/react";

<ItemRenderer item={item} />
```

### `ItemsRenderer`

Render a list of items. By default, conversational items with `history: false` visibility (sub-agent output) are filtered out — they're available in `session.items` but hidden from the default conversation view so orchestrator chatter doesn't crowd the UI. Pass `showSubAgents` to surface them inline, or render a per-agent view via `session.getItemsByAgent(name)`.

```tsx
import { ItemsRenderer } from "@flow-state-dev/react";

// Default — filters sub-agent items
<ItemsRenderer items={session.items} />

// Opt in — show sub-agent items inline
<ItemsRenderer items={session.items} showSubAgents />
```

### Custom Renderers

```tsx
import type { MessageItem } from "@flow-state-dev/core/items";

function ChatMessage({ item }: { item: MessageItem }) {
  return <p>{item.role}: {item.content[0]?.text}</p>;
}

// Register in FlowProvider
<FlowProvider renderers={{ message: ChatMessage }}>

// Suppress a type
<FlowProvider renderers={{ status: false }}>
```

### `RendererRegistry`

Type for the renderers map:

```ts
type RendererRegistry = {
  message?: ComponentType<{ item: MessageItem }> | false;
  reasoning?: ComponentType<{ item: ReasoningItem }> | false;
  component?: Record<string, ComponentType<{ item: ComponentItem }>>;
  container?: Record<string, ComponentType<{ item: ContainerItem }>>;
  // ... other item types
};
```
