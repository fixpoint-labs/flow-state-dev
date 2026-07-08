# @flow-state-dev/react

**React hooks and renderers for Flow State Dev. Wire AI workflows to your UI in minutes.**

```tsx
import { FlowProvider, useFlow, useSession, ItemRenderer } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider flowKind="my-app" userId="user_1">
      <Chat />
    </FlowProvider>
  );
}

function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <div>
      {session.items.map(item => (
        <ItemRenderer key={item.id} item={item} />
      ))}
      <button
        onClick={() => session.sendAction("chat", { message: "Hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Working..." : "Send"}
      </button>
    </div>
  );
}
```

That's a streaming chat UI. Items appear in real time as the LLM generates them. State syncs automatically. Reconnection is handled. No SSE wiring, no manual refetches.

## Install

```bash
pnpm add @flow-state-dev/react
```

Peer dependency: `react ^18.0.0 || ^19.0.0`

## How it works

`@flow-state-dev/react` wraps the [`@flow-state-dev/client`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/client) transport layer with React hooks. All network communication goes through the client — no transport logic lives in this package. This means:

- Hooks manage lifecycle and reactivity, not HTTP or SSE
- You can swap transport behavior by configuring the client
- The same flow definitions work across React, vanilla JS, and Node

## FlowProvider

Wrap your app (or a subtree) with `<FlowProvider>` to set defaults and register custom renderers:

```tsx
<FlowProvider
  flowKind="my-app"
  userId="user_1"
  renderers={{
    component: { "strategy-report": StrategyReportCard },
    message: CustomMessageBubble,
    status: false, // suppress status items in the UI
  }}
>
  <App />
</FlowProvider>
```

Props:
- `flowKind?: string` — Default flow kind for child hooks
- `sessionId?: string` — Default session ID
- `userId?: string` — Required for Phase 1
- `baseUrl?: string` — API base URL
- `renderers?: RendererRegistry` — Custom renderers keyed by item type or component key
- `children: ReactNode`

Nested providers merge `renderers` — child keys override parent keys.

## Hooks

### `useFlow(options?)`

Session lifecycle — list, create, and select sessions:

```ts
const flow = useFlow({ autoCreateSession: true });
// flow.activeSessionId, flow.sessions, flow.createSession(), flow.selectSession()
```

### `useSession(sessionId, options?)`

The primary hook. Gives you everything about a session — items, state, streaming status, and the ability to send actions:

```ts
const session = useSession(sessionId, {
  items: { visibility: "ui", includeTransient: false },
});
```

Returns:
- `detail` — Session metadata
- `snapshot` — Current state snapshot with clientData
- `latestRequest` — Most recent request on this session as a `SessionRequestSummary`, regardless of status. `null` until first fetch resolves. Refreshed on mount and on every terminal SSE event so consumers can render recovery affordances.
- `items`, `messages`, `blockOutputs`, `functionCalls` — Filtered item views
- `isLoading`, `isStreaming`, `error` — Status flags
- `statusMessage` — Request-scoped status slot mirror. Latest `emitStatus` value from the in-flight request (empty string when unset; resets on request termination). Pair with a streaming indicator to show "what's happening right now" with a "Working..." fallback.
- `sendAction(action, input)` — Trigger an action
- `abortRequest()` — Stop the in-flight request (signals the server to mark it `aborted`)
- `resumeLatestRequest()` — Re-dispatch `latestRequest` and attach to the new stream. No-op when there's no latest request, or when its status is anything other than `interrupted` or `failed` (the only states the server will retry). Useful for rendering a "Resume" button when a previous request was interrupted by a server crash, HMR reload, or network drop:

  ```tsx
  {session.latestRequest?.status === "interrupted" && !session.isStreaming && (
    <button onClick={() => session.resumeLatestRequest()}>Resume</button>
  )}
  ```
- `getOwnedItems(ownedBy)` — Items owned by a container scope (O(1) indexed lookup)
- `refresh()` — Manually refetch

### `useClientData(session, options)`

Read client data values from the session snapshot. Values update mid-stream as `state_change` items arrive on the SSE stream — components see `ctx.<scope>.patchState(...)` writes within the same paint, not only at request termination. This applies to `expose` keys; `derived` projections refresh once at terminal status.

```ts
const data = useClientData(session, {
  session: ["artifactsList", "modeStatus"],
  user: ["preferences"],
  org: ["sharedConfig"],
});

// Or with schemas for type inference:
const data = useClientData(session, {
  session: { artifactsList: artifactsListSchema },
});
```

### `useContainerItems(containerItem, source)`

Resolves owned items and component state for a container scope. Works with sequencers/routers that declare `container` config.

```ts
import { useContainerItems } from "@flow-state-dev/react";

function PlanRenderer({ item }: { item: ContainerItem }) {
  const { state, items } = useContainerItems<PlanState>(item, session);
  // state = latest plan snapshot from ComponentItem
  // items = all items emitted within this container's scope
}
```

`source` accepts either a `SessionView` (indexed O(1) lookups) or an `OutputItem[]` array.

### `useResourceCollection(session, ref)`

Underlying primitive for collection resources. Returns `list`, `get`, `query`, `actions`, `refetch`, `prefetched`, and `count`. Pages are cached per-instance and invalidated on observed `resource_change` notices for the affected ref. Invalidation is driven by the `SessionView.resourceChanges` side channel (see below), so it works regardless of whether the caller opted into transient items.

### `useResourceCollectionList(session, ref, { limit?, topicPrefix? })`

Convenience hook for paginated list views. Returns `items` (array of `CollectionItemHandle`), `pagination`, `isLoading`, `error`, `loadMore`, `refetch`. Surfaces the snapshot's `prefetched` window as the initial paint when set.

### `useResourceCollectionItem(session, ref, topic)`

Single-item lookup by topic. Returns `null` when not present. Refetches automatically when the watched `ref` receives a `resource_change` notice — e.g., a memo flipping from `writing` to `published` updates in place without remounting. When the collection declares `client: { live: true }`, the mutation arrives as an inline delta merged into the snapshot, so `item.clientData` updates mid-stream with no refetch (`useResource` does the same for single resources).

#### Typing `clientData`

`useResource`, `useResourceCollection`, `useResourceCollectionList`, and `useResourceCollectionItem` each take a `TClient` type parameter that types `clientData` instead of `unknown`. Derive it from the definition with `ClientDataOf<typeof collection>` (from `@flow-state-dev/core`) so it tracks the projection automatically:

```tsx
const { item } = useResourceCollectionItem<ClientDataOf<typeof artifacts>>(session, "artifacts", "spec.md");
// item?.clientData is the projected type — no cast
```

The parameter defaults to `unknown`, so untyped call sites are unchanged.

### `SessionView.resourceChanges`

`ReadonlyArray<ResourceChangeNotice>` of mid-stream resource_change notices in arrival order. Each notice carries `{ resourcePath, changeType, seq }`. Surfaced independently of the items filter, so subscribers can react to in-flight resource mutations without setting `includeTransient: true` on `useSession`. Reset on session change.

### `useResourceManifest(session)`

Fetches the static manifest of public resources for the session's flow. Cached module-level by `flowKind` so all components share one fetch.

### `useAction(options)`

Low-level hook for direct action execution without session management.

### `useRequestStream(options)`

Low-level hook for subscribing to a request's SSE stream with reactive item/status views. Message and reasoning text streams in token-by-token.

```tsx
const { items, messages, status, isStreaming } = useRequestStream({
  source: { requestId },          // or { response } for an inline POST stream
  filter: { itemTypes: ["message"] },
});
```

`flush` defaults to `"raf"` (coalesce snapshots per frame); pass `"immediate"` for low-volume or deterministic-test use.

### `useSuspensions(session, options?)`

Derives pending and resolved suspensions from `session.items`. Pairs each `suspension` item with its `suspension_resume` by `suspensionId` and exposes `approve`/`reject` callbacks. `approve`/`reject` stream the resumed continuation back into `session.items` (via `session.resumeSuspension`), so the resolution renders live — no page refresh, even on serverless.

```tsx
const { pending, approve, reject, error } = useSuspensions(session, {
  reasons: ["human_approval"],  // optional filter
});

// Render headless approval UI
pending.map(({ item }) => (
  <ApprovalSidebar
    key={item.suspensionId}
    message={item.message}
    onApprove={() => approve(item.suspensionId)}
    onReject={() => reject(item.suspensionId)}
  />
));
```

Returns `{ suspensions, pending, resolve, approve, reject, error }`. Each `SuspensionView` has `{ item, status, pending, resumeData, resolvedBy, allow, isResolving }`. `resolve(id, { action, data })` is the general resolver — `action` is `"approve" | "reject" | "submit" | "skip"`, `submit` carries a typed payload; `approve`/`reject` are thin wrappers over it.

### `useSuspensionForm(item, options?)`

Headless controller for the non-binary input shapes — a clarifying question, a flat form, or a single/multi selection. Where `useApproval` drives the binary gate, this drives the `submit`/`skip` path. It derives form fields from the suspension's `resumeSchema` (a flat object of scalars and enums, or a top-level scalar/enum), holds the in-progress value, validates it client-side, coerces numbers, and resolves through the same streaming transport.

```tsx
import { useSuspensionForm } from "@flow-state-dev/react";

function ClarifyCard({ item }) {
  const f = useSuspensionForm(item);
  if (f.resolved) return <Receipt outcome={f.outcome} />;
  return (
    <>
      {f.fields.map((field) => (
        <Field key={field.key} field={field} value={f.value[field.key]} onChange={(v) => f.setField(field.key, v)} error={f.errors[field.key]} />
      ))}
      <button disabled={!f.canSubmit} onClick={f.submit}>Submit</button>
      {f.canSkip && <button onClick={f.skip}>Skip</button>}
    </>
  );
}
```

Returns `{ kind, value, setValue, setField, fields, options, errors, canSubmit, canSkip, submit, skip, isResolving, resolved, resolution, outcome, error }`. When the schema is richer than a flat object of scalars/enums (nested objects, arrays of objects, unions), `fields` is empty — render a custom component named via the suspension's `render.component` hint instead.

### `<QuestionRenderer>`, `<SelectionRenderer>`, `<SchemaFormRenderer>`

The default cards for `human_input` suspensions, all thin views over `useSuspensionForm`: `QuestionRenderer` (free-text answer), `SelectionRenderer` (single choice from a `z.enum`, or multi from `z.array(z.enum)`), and `SchemaFormRenderer` (a flat object of scalars and enums, one control per property). `ItemRenderer` auto-picks one for a `human_input` suspension by `render.component` hint → reason → `resumeSchema` shape; `human_approval` suspensions get `ApprovalRenderer`. A registered `renderers.suspension` overrides this, and `renderers.suspension: false` suppresses inline cards.

### `useApproval(item, options?)`

Headless controller for a suspension approval. Owns the resume transport, in-flight/error state, the duplicate-resume guard, and the resolved outcome — no markup. Build your own approval UI on top of it:

```tsx
import { useApproval } from "@flow-state-dev/react";

function MyApproval({ item }) {
  const a = useApproval(item, { isResolved, resolution });
  if (a.resolved) return <Receipt outcome={a.outcome} />;
  return (
    <>
      <button disabled={!a.canApprove || a.isResolving} onClick={a.approve}>Approve</button>
      <button disabled={!a.canReject || a.isResolving} onClick={a.reject}>Reject</button>
    </>
  );
}
```

Returns `{ approve, reject, pendingAction, isResolving, error, resolved, resolvedStatus, outcome, canApprove, canReject }`. Resolution goes through `onApprove`/`onReject` if given, else the nearest `<SuspensionResolverProvider>` (streaming), else a self-contained recovery client.

### `<ApprovalRenderer>`

The **minimal built-in default** for `suspension` items — plain, unstyled buttons so a suspension renders something actionable with zero setup, collapsing to a one-line text receipt once resolved. It's bare on purpose; for a polished, themeable card use the **`Approval` component from `@flow-state-dev/ui`** (included in `chatAssistantRenderers` as `suspension: Approval`). Both are thin views over `useApproval`.

```tsx
import { ApprovalRenderer } from "@flow-state-dev/react";

// Used automatically by ItemRenderer; or render directly with explicit handlers:
<ApprovalRenderer
  item={suspensionItem}
  onApprove={(data) => approve(suspensionItem.suspensionId, data)}
  onReject={(data) => reject(suspensionItem.suspensionId, data)}
/>
```

`ItemRenderer`/`ItemsRenderer` thread the resolution outcome to this default so a reloaded log shows the real result. Suppress it with `renderers={{ suspension: false }}` on `<FlowProvider>`.

### `<SuspensionResolverProvider>`

Bridges the session's streaming resume to the inline default `<ApprovalRenderer>`. Wrap the subtree that renders `session.items`; the inline card then streams the continuation into the chat view on approve/reject, instead of a non-streaming resume that only shows output after a refetch.

```tsx
import { SuspensionResolverProvider } from "@flow-state-dev/react";

<SuspensionResolverProvider resolve={session.resumeSuspension}>
  <ItemsRenderer items={session.items} />
</SuspensionResolverProvider>
```

Explicit `onApprove`/`onReject` props still take precedence; with neither a provider nor handlers, the card falls back to a self-contained non-streaming resume (requires `flowKind` on `<FlowProvider>`).

## Voice playback

`useVoice` covers both whole-buffer playback (one buffer per `OutputAudioContent` from batch providers like OpenAI) and streaming playback (per-chunk audio via `content.audio.delta` from streaming providers). The audio player handles both modes transparently — flow authors don't change anything to opt in.

```tsx
const voice = useVoice(session, { action: "say" });
```

Internally, `useVoice` subscribes to streaming audio chunks via `session.subscribeAudioDelta(handler)` (the same subscription is available for consumers who want to drive a custom player) and decodes them with the Web Audio API on a shared `AudioContext`, scheduling sources back-to-back for gap-free playback. The same `(itemId, contentIndex)` dedup prevents the eventual `OutputAudioContent` snapshot from double-playing audio that already streamed.

The player exposes `enqueueChunk(chunk)` for direct callers and `dispose()` for releasing the underlying `AudioContext` (called automatically on unmount). MP3 (`audio/mpeg`) is the only supported codec in M1; PCM and WAV are deferred. See [streaming items](https://flow-state.dev/docs/streaming/items) for the wire format.

## Render helpers

`ItemRenderer` and `ItemsRenderer` handle the dispatch from item types to your registered renderers:

```tsx
// Single item
<ItemRenderer item={item} />

// List of items
<ItemsRenderer items={session.items} />
```

Custom renderers receive `{ item }` as their prop:

```tsx
import type { MessageItem } from "@flow-state-dev/core/items";

function ChatBubble({ item }: { item: MessageItem }) {
  return (
    <div className={item.role === "user" ? "user-bubble" : "assistant-bubble"}>
      {item.content[0]?.text}
    </div>
  );
}
```

Register renderers via `FlowProvider` or pass them directly to `ItemRenderer`.

### Presentational components moved to `@flow-state-dev/ui`

`ModelBadge` and the audit-annotation card are no longer exported from this package. They live in the [`@flow-state-dev/ui`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/ui) registry, where you own the source after installing it. Install `ModelBadge` with `fsdev ui add model-badge` and import it from `@/components/flow-state/model-badge`. Audit annotations render through the ui `audit-annotation` component, fed by the `responseAuditor` pattern's emitted component item, so no per-item wiring is needed.

## Connection resilience

When the SSE connection drops mid-flight (network blip, tab background, server restart), `useSession` flips `session.isStuck` to `true` and exposes `session.dismissRequest()` so the user can clear the request without reloading.

```tsx
function ConnectionBanner() {
  const session = useSession(activeSessionId);
  if (!session.isStuck) return null;
  return (
    <div role="alert">
      <span>Connection lost.</span>
      <button onClick={() => session.dismissRequest()}>Dismiss</button>
    </div>
  );
}
```

The watchdog tracks the last SSE event or wire heartbeat; if the gap exceeds `stuckThresholdMs` (default 30_000 ms; should be ≥ 2× the server's `defaultSseHeartbeatMs`) while a request is in flight, `isStuck` flips. `dismissRequest()` works without a live SSE stream — it issues an out-of-band POST abort, injects a synthetic abort item into the local items log, and refreshes the latest snapshot.

```tsx
const session = useSession(sessionId, { stuckThresholdMs: 30_000 });
```

A user-triggered `sendAction` while `isStuck` is true auto-dismisses the prior request before opening the new stream, so the chat keeps moving. See [Connection Resilience](https://flow-state.dev/docs/server/connection-resilience) for the full layered defense (server heartbeat + sweeper + client watchdog).

## Scripts

```bash
pnpm --filter @flow-state-dev/react build
pnpm --filter @flow-state-dev/react typecheck
pnpm --filter @flow-state-dev/react test
```

## Architecture reference

- [React Hooks](https://flow-state.dev/docs/client/react) — React hooks contract, FlowProvider, rendering
- [Streaming](https://flow-state.dev/docs/streaming/overview) — Item types, content model, transience
