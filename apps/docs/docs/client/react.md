---
sidebar_position: 2
---

# React Integration

How to use flow-state.dev's React bindings to build interactive UIs.

## FlowProvider

Wrap your app (or a section of it) with `FlowProvider` to set defaults and register renderers:

```tsx
import { FlowProvider } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider
      flowKind="my-app"
      userId="devuser"
      renderers={{
        message: MessageComponent,
        reasoning: ReasoningComponent,
        component: {
          "chart": ChartComponent,
          "data-table": DataTableComponent,
        },
      }}
    >
      <MyUI />
    </FlowProvider>
  );
}
```

### Renderer Registry

Renderers map item types to React components:
- **Class-based types** (`message`, `reasoning`, etc.) — One component each
- **Parameterized types** (`component`, `container`) — Sub-key lookup by `item.component`

Nested providers merge renderers (child keys override parent keys).

## Hooks

### `useFlow` — Session Lifecycle

```tsx
const flow = useFlow({ autoCreateSession: true });

// Available:
flow.sessions;          // Session list
flow.activeSessionId;   // Current session ID
flow.createSession();   // Create new session
flow.selectSession(id); // Switch session
```

### `useSession` — Primary Hook

```tsx
const session = useSession(flow.activeSessionId, {
  items: { visibility: "ui" },
});

// Available:
session.detail;          // SessionDetail object
session.latestRequest;   // Most recent request (any status), or null
session.items;           // All items, including sub-agent items
session.messages;        // Message items only
session.blockOutputs;    // Block output items only
session.isStreaming;     // Active request in progress
session.isLoading;       // Initial load in progress
session.error;           // Error state

// Identity-based filtering:
session.getItemsByAgent("researcher");     // items stamped with agentName
session.getItemsByVisibility({ history: false }); // items by visibility

// Container-scoped items:
session.getOwnedItems(containerBlockInstanceId);

// Actions:
await session.sendAction("chat", { message: "Hello!" });
await session.abortRequest();      // Stop the in-flight request
await session.resumeLatestRequest(); // Re-run the latest request if it was interrupted/failed
session.refresh();                 // Force refetch
```

### Resuming an interrupted request

When a request dies before it can finish — server crash, HMR reload mid-flow, network drop — its record stays as `interrupted`. `latestRequest` exposes that, and `resumeLatestRequest` re-dispatches the same action with the original input, returning a new request id and attaching the stream.

```tsx
{session.latestRequest?.status === "interrupted" && !session.isStreaming && (
  <button onClick={() => session.resumeLatestRequest()}>
    Resume
  </button>
)}
```

`resumeLatestRequest` is a no-op when the latest request is `completed`, `aborted`, or `in_progress` — only `interrupted` and `failed` are retryable.

### `useClientData` — Client Data

```tsx
const clientData = useClientData(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});

// Typed mode with schema validation:
const clientData = useClientData(session, {
  session: {
    activePlan: activePlanSchema,
  },
});
```

#### Live updates

Values update mid-stream as `state_change` items arrive over SSE — components re-render within the same paint as the corresponding `ctx.<scope>.patchState(...)` call, not only after the request terminates. This applies to keys declared in the flow's `client.<scope>.expose` config (the "expose half" of `clientData`). Derived projections (declared in `client.<scope>.derived`) refresh once at terminal request status, since the framework can't recompute their projection functions client-side.

Two limitations to know about:

- Mid-stream updates only apply to expose keys whose initial value is already present in the snapshot. If a flow exposes `foo` but `state.foo` is `undefined` at session start, the first `patchState({ foo: ... })` won't surface until terminal refresh. Declare a default in the scope's `stateSchema` if that case matters.
- `atomicState` mutations don't carry a structured delta on the wire, so values affected by an atomic write also stay stale until terminal refresh.

See [`state_change` items](../streaming/items.md) for the wire format and [State and scopes](../fundamentals/state-and-scopes.md) for the scope model.

### `useAction` — Low-Level

For direct action execution without session management:

```tsx
const { execute, loading, error } = useAction({
  flowKind: "my-app",
  action: "chat",
  userId: "devuser",
});
```

### `useRequestStream` — Direct Stream Access

```tsx
const { items, status, isStreaming } = useRequestStream({
  requestId,
  filter: { itemTypes: ["message", "component"] },
});
```

## Rendering Items

### ItemRenderer and ItemsRenderer

```tsx
import { ItemRenderer, ItemsRenderer } from "@flow-state-dev/react";

// Render all items. Sub-agent items are filtered out of the default
// conversation view — pass `showSubAgents` to surface them inline.
<ItemsRenderer items={session.items} />

// Show sub-agent items in the main stream (e.g., for a debug view).
<ItemsRenderer items={session.items} showSubAgents />

// Render a single item
<ItemRenderer item={item} />
```

### Custom Renderers

All custom renderers receive `{ item }` as their prop:

```tsx
import type { MessageItem } from "@flow-state-dev/core/items";

function ChatMessage({ item }: { item: MessageItem }) {
  return (
    <div className={item.role === "user" ? "user-msg" : "assistant-msg"}>
      {item.content.map((part, i) => (
        <span key={i}>{part.text}</span>
      ))}
    </div>
  );
}
```

### Suppressing Built-in Renderers

Pass `false` to suppress a type:

```tsx
const renderers = {
  status: false,      // Don't render status items
  reasoning: false,   // Don't render reasoning items
};
```

## Resource collection hooks

Three hooks for working with collection resources — list views, single-item lookups, and an underlying primitive. All three depend on the collection's `client.state.read` permission for per-item state access.

### useResourceCollection

The underlying primitive. Returns `list`, `get`, `query`, `actions`, `refetch`, plus `prefetched` and `count` from the snapshot. Use it directly when you need control over fetching beyond what the convenience hooks below offer.

```tsx
const { list, get, actions, refetch, count } = useResourceCollection(session, "artifacts");

await list({ limit: 20, topicPrefix: "artifacts/projects/" });
const item = await get("artifacts/spec.md");
await actions.create({ topic: "new.md", content: "# New" });
```

Pages are cached per hook instance, keyed by the normalized query. Resource changes observed in the session stream invalidate the cache for the affected collection so the next call refetches automatically.

### useResourceCollectionList

The common case: paginated list view with `loadMore`.

```tsx
const { items, pagination, isLoading, error, loadMore, refetch } =
  useResourceCollectionList(session, "artifacts", { limit: 50 });

return (
  <>
    {items.map((item) => (
      <ArtifactRow key={item.topic} item={item} />
    ))}
    {pagination?.hasMore && <button onClick={loadMore}>Load more</button>}
  </>
);
```

Each `item` is a `CollectionItemHandle<TClient>` — `{ topic, clientData, fetchContent() }`. `fetchContent()` calls the existing content endpoint for that topic on demand.

If the collection declares `prefetchWindow > 0`, the snapshot's prefetched window paints first while the network fetch runs underneath.

### useResourceCollectionItem

For a single item by topic. Returns `null` if the topic isn't present.

```tsx
const { item, isLoading, error, refetch } = useResourceCollectionItem(session, "artifacts", "spec.md");
if (item === null) return <div>Not found</div>;
const content = await item.fetchContent();
```

If the collection declares `client: { live: true }`, mutations to this topic update `item.clientData` mid-stream with no refetch — a memo flipping from `writing` to `published` repaints in place. `useResource` behaves the same way for single resources, and `useResourceCollectionList` applies the overlay across every item (status updates, removals on delete, and mid-stream creates) so an all-items navigator stays live. See [Resources: Client Access — Live updates](/docs/resources/client-access#live-updates) for the server-side setup.

### Typing `clientData`

These hooks (and `useResource`) take a `TClient` type parameter that types `clientData` instead of leaving it `unknown`. Derive it from the definition with `ClientDataOf<typeof collection>` so it can't drift from the projection:

```tsx
import type { ClientDataOf } from "@flow-state-dev/core";
import { artifacts } from "./resources";

const { item } = useResourceCollectionItem<ClientDataOf<typeof artifacts>>(session, "artifacts", "spec.md");
// item?.clientData is the projected type — no cast
```

The parameter defaults to `unknown`, so untyped call sites are unchanged. See [Client Access — Typing `clientData`](/docs/resources/client-access#typing-clientdata) for how the type is derived from `expose` / `exclude` / `data`.

## useResourceManifest

The manifest tells you what every public resource on the session exposes — kind, scope, pattern, declared permissions. The hook fetches once per `flowKind` and shares the result across all components via a module-level cache.

```tsx
const { manifest, isLoading, error } = useResourceManifest(session);
const canCreateArtifact = manifest?.resources
  .find((r) => r.ref === "artifacts")
  ?.client.content?.create === true;
```

See [Resource Manifest](/docs/resources/manifest) for the full reference.

## Suspensions and approvals

When a durable flow calls `ctx.suspend()`, execution pauses at that step and a `suspension` item arrives on the session's SSE stream. The flow waits for an external actor to resolve it before continuing.

`useSuspensions` derives pending and resolved suspensions from `session.items`. It pairs each `suspension` item with its later `suspension_resume` item by `suspensionId` and exposes `approve` and `reject` callbacks.

`approve` and `reject` stream the resume: the resumed continuation streams straight back into `session.items`, so the post-resume output renders live without a page refresh. This matters most on serverless, where the continuation runs in a different invocation than any open stream — streaming the resume keeps it on the same request the client is watching. The callbacks resolve to `void` once the resume is dispatched; the result shows up as new items.

### useSuspensions

```tsx
import { useSuspensions } from "@flow-state-dev/react";

function ApprovalPanel({ session }) {
  const { pending, approve, reject, error } = useSuspensions(session);

  return (
    <>
      {pending.map(({ item }) => (
        <div key={item.suspensionId}>
          <p>{item.message}</p>
          <button onClick={() => approve(item.suspensionId)}>Approve</button>
          <button onClick={() => reject(item.suspensionId)}>Reject</button>
        </div>
      ))}
      {error && <p style={{ color: "red" }}>{error.message}</p>}
    </>
  );
}
```

`pending` is a live slice of `suspensions` — it updates automatically when a `suspension_resume` item arrives on the stream. `approve` and `reject` accept an optional `data` payload that `ctx.suspend()` returns on the resumed step.

Filter to a specific reason or request:

```tsx
const { pending } = useSuspensions(session, {
  reasons: ["human_approval"],
  requestId: "req_abc",
});
```

### Rendering approvals inline

By default `ItemRenderer` renders a built-in approval card (`ApprovalRenderer`) for `type === "suspension"` items. Set `flowKind` on `<FlowProvider>` so the card can call the resume endpoint:

```tsx
<FlowProvider flowKind="my-flow" baseUrl="/api/flows">
  <ItemsRenderer items={session.items} />
</FlowProvider>
```

When a suspension item reaches `ItemRenderer`, the card shows `item.message`, Approve and Reject buttons, and optional `item.data` in a collapsible details section.

With just `flowKind` set, the inline card resolves with a non-streaming resume — it works, but the continuation's output only shows after the session refetches. To make the inline card stream like `useSuspensions` does, wrap the item list in `<SuspensionResolverProvider>` and hand it the session's `resumeSuspension`:

```tsx
import { SuspensionResolverProvider } from "@flow-state-dev/react";

<FlowProvider flowKind="my-flow" baseUrl="/api/flows">
  <SuspensionResolverProvider resolve={session.resumeSuspension}>
    <ItemsRenderer items={session.items} />
  </SuspensionResolverProvider>
</FlowProvider>
```

Now approving or rejecting from the inline card streams the continuation back into `session.items` — the chat view updates in place. `session.resumeSuspension` is the same streaming resume `useSuspensions` calls under the hood, so the two paths behave identically.

### Custom approval UI

Register a component under the `suspension` slot to replace the default card:

```tsx
<FlowProvider renderers={{ suspension: MyApprovalCard }}>
```

The component receives `{ item }` where `item` is the `SuspensionItem`. Use `useSuspensions` from a parent to manage resolution and pass `onApprove`/`onReject` handlers down.

For a fully custom layout — modals, sidebars, toasts — suppress inline rendering and manage the list yourself:

```tsx
<FlowProvider renderers={{ suspension: false }}>
  {/* ItemsRenderer shows no inline cards */}
  <ItemsRenderer items={session.items} />

  {/* Your own layout reads from useSuspensions */}
  <ApprovalSidebar pending={pending} onApprove={approve} onReject={reject} />
</FlowProvider>
```

See [Durable execution](/docs/advanced/durable-execution) for the server-side setup (`ctx.suspend()`, `SuspendOptions`, the resume endpoint).

See the [API reference](/docs/api/react#usesuspensions) for the full `useSuspensions` signature.

## Typical Pattern

```tsx
function ChatUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <div>
      {/* Render items */}
      {session.items.map((item) => (
        <ItemRenderer key={item.id} item={item} />
      ))}

      {/* Input form */}
      <form onSubmit={(e) => {
        e.preventDefault();
        const msg = new FormData(e.currentTarget).get("message") as string;
        session.sendAction("chat", { message: msg });
        e.currentTarget.reset();
      }}>
        <input name="message" />
        <button disabled={session.isStreaming}>Send</button>
      </form>
    </div>
  );
}
```
