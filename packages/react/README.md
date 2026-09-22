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
- `flowKind?: string` — Default flow instance for child hooks (a kind, or a collection member's own id)
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
- `statusMessage` — Request-scoped status slot mirror. Latest `ctx.emit.status()` value from the in-flight request (empty string when unset; resets on request termination). Pair with a streaming indicator to show "what's happening right now" with a "Working..." fallback.
- `sendAction(action, input)` — Trigger an action
- `abortRequest()` — Stop the in-flight request (signals the server to mark it `aborted`)
- `resumeLatestRequest()` — Re-dispatch `latestRequest` and attach to the new stream. No-op when there's no latest request, or when its status is anything other than `interrupted` or `failed` (the only states the server will retry). The retry goes through the instance recorded as the request's owner (`latestRequest.flowId`), falling back to the provider's `flowKind` only for a record with no owner recorded. Useful for rendering a "Resume" button when a previous request was interrupted by a server crash, HMR reload, or network drop:

  ```tsx
  {session.latestRequest?.status === "interrupted" && !session.isStreaming && (
    <button onClick={() => session.resumeLatestRequest()}>Resume</button>
  )}
  ```
- `continueRequest(requestId)` — Continue a crash-interrupted request under its OWN id and stream the re-entry's items back into `session.items`. Unlike `resumeLatestRequest` (which re-dispatches the most recent request via `/retry` under a new id), this targets a specific `requestId` — the caller resolves which interrupted request to continue rather than assuming "latest". POSTs inline with `Accept: text/event-stream`; on a 202 fallback it reconnects via GET rather than re-POSTing.
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

### `SessionView.childSessions`

`ReadonlyArray<ChildSessionSummary>` of the dispatch runs started from this session — work that outlives the turn and runs in a session of its own. One entry per run, carrying `{ id, parentSessionId, createdAt, updatedAt, flowId?, topic?, coordinate?, status? }`, which is the whole row. `flowId` is the instance that owns the run — the address to read it through when it was dispatched into another instance. Absent on a row that records no owner. Empty for a session that started none. Separate from `items`: a run is not part of the conversation, and no result is folded into the transcript. An app that wants a finished result to appear in the chat writes that itself.

Carries one page of the most recent entries, newest first. This list is all-time history, not just what is running now, so it grows with everything the conversation has ever started. A conversation that runs more background work than one page keeps showing the newest; the oldest finished work falls off the end and is not reachable from the hook.

The page size is the server's, so the hook works against any deployment without being told what that is. Ask for a specific one with `childSessions: { limit }`:

```tsx
const session = useSession(sessionId, {
  flowKind: "research",
  childSessions: { limit: 500 }
});
```

The server caps that value and rejects a larger one with a 400, which the hook surfaces as `childSessionsStale` rather than rows. The cap defaults to 100 and is raised with `maxChildSessionListLimit` on the server — so asking for more than the deployment permits is a misconfiguration you hear about, not a silent truncation.

Current as of the reader's last interaction. It is re-read on mount, at the start of each action, and on `refresh()` — nothing keeps it current while the user waits, so work started elsewhere appears on the next action or refresh.

`status` is absent until the work has run something. `"active"` means only *not finished*: it does not separate working from queued from waiting on a person, and it reports the last state recorded rather than checking a worker is alive — so work whose worker stopped unexpectedly reads as unfinished until the system picks it back up. Treat unrecognised values as displayable; the set grows.

`SessionView.childSessionsStale` is `true` in two cases with different remedies: the most recent re-read failed, which the next successful read clears; or the requested `limit` is above the server's cap, which only a smaller `limit` clears. The rows already read are kept either way — the hook never empties the list.

To open one, read it as the session it is, passing the flow **the run belongs to**, which is not always the conversation's — a run dispatched into another instance belongs to that instance. The row's `flowId` is that address whenever it carries one; fall back to the conversation's own kind when it does not. A different name reads as a different flow: an active run's stream 404s and the view stays on its first snapshot.

```tsx
function BackgroundJobDetail({ jobId, flowKind }: { jobId: string; flowKind: string }) {
  // `autoResume` is required here: without it this loads one snapshot and
  // never fills in as the job keeps working.
  const job = useSession(jobId, { flowKind, autoResume: true });
  return <ItemsRenderer items={job.items} />;
}
```

Steps appear as they complete. There is no in-flight text from background work.

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

### FlowNavigator

`FlowNavigator` is a sidebar that browses the flows registered on your server, the instances under them, and each instance's sessions. Reach for it when your app has more than one conversation to switch between and you would otherwise build that list yourself.

You give it sections. A section is a label and a set of flow kind names, so an app that declares a channel kind of its own adds that name to the same list.

Leave `kinds` out and the section covers every kind the server registers. That is what you want when the kinds are not yours to write down, such as a tool pointed at whatever deployment is running. `kinds: []` is different: an empty filter matches no kinds, so the section renders empty.

```tsx
import { FlowNavigator } from "@flow-state-dev/react";

<FlowNavigator
  sections={[
    { label: "Channels", kinds: ["channel"] },
    { label: "Seats",    kinds: ["agent"] },
  ]}
  selectedSessionId={sessionId}
  onSelectSession={(picked) => setSessionId(picked)}
/>
```

How deep the tree goes comes from each flow's declared `cardinality`. A flow declared `singleton` is a single instance and sits as one row. A flow declared `collection` has many addressable copies, and its row expands into them. Depth comes from the flow, not from a prop.

`onSelectSession(sessionId, flow)` fires when a session row is picked. The second argument describes the instance that session was listed under: `{ kind, address, cardinality }`, where `address` is the kind name for a singleton and the instance id for one copy of a collection. Selection is yours to keep; pass it back as `selectedSessionId` to mark the current row.

Sessions load when you open a single flow instance, which is a singleton's row or one copy under a collection. Expanding a collection row to see its copies costs no request.

Pass `includeDispatchRuns` and the listing also covers the sessions dispatchers ran work in, each drawn one level under the session that started it. One level is all there is: a run started by another run sits beside its own parent, and a run whose parent is not in the listing sits at the left margin. The `rowTrailing` slot receives `dispatchRun` on those rows, carrying the id of the session that started it, so you can label the row or link to it. Left out, the rail lists the sessions a person started.

The navigator reads through a `client` and a `sessionClient`. Pass your own through those props when your API needs auth headers or a custom `fetch`, and pass a stable reference, one held in a context or a `useMemo` rather than an object built during render. Left out, the navigator builds its own pair against the nearest `FlowProvider`'s `baseUrl` and `userId`.

The package brings no CSS framework and no icon set. Style the rows by setting the `--fsd-nav-*` CSS custom properties on any ancestor, and fill in your own affordances through `slots`: `sectionHeader` beside a section label, `rowTrailing` beside any row's name, `leafToolbar` inside an open instance, and `emptySection` for a section whose kinds the server does not have.

`leafToolbar` is handed that instance's session list, a `refresh` for it, and the flow-list entry the row was drawn from. The entry carries what the flow declares — its actions, for example — so the toolbar can render them without fetching the flow list itself.

Before you put this in front of end users: the flow listing it reads carries no organization, and the framework does not guard that route. Anyone who can reach your app can read the list unless you put your own check in front of it, so treat it as public information about your deployment's shape. There is no `orgId` prop.

### Roster

`Roster` lists the seats hired in an organization. Reach for it when your app has a workforce and you want a standing panel showing who is on it.

```tsx
import { Roster } from "@flow-state-dev/react";

<Roster sessionId={sessionId} collectionRef="roster" problems={bootProblems} />
```

The seats come from the standing roster collection, which your session's flow declares. `collectionRef` is the key it is declared under, and it defaults to `roster`. That key is a single path segment, so it carries no slash.

The seats it shows are the ones hired in the session's own organization. There is no `orgId` prop.

`problems` is the list of seats a boot reload could not restore. Reloading a roster hands back the seats it made and a named entry for each row it could not, and that second list only exists on the server, so pass it down. `Roster` shows the count and the entries.

A seat row carries `seatId`, `flow` (the kind it was hired into) and `instructions`. It does not carry the seat's settings.

### BoardColumns

`BoardColumns` draws one task board as columns, grouped by status.

```tsx
import { BoardColumns } from "@flow-state-dev/react";

<BoardColumns sessionId={sessionId} boardRef="eng.feature.triage" />
```

`boardRef` is the key the session's flow declares that board's ledger under, which for a channel board is the minted `<channelId>.<boardName>`. Like the roster's ref it is one path segment.

The columns are the task statuses, in the order work moves through them: `pending`, `in_progress`, `blocked`, `parked`, `completed`, `errored`, `cancelled`. The package exports that list as `BOARD_STATUS_COLUMNS`. A row whose status the component does not recognise gets a column of its own at the end rather than vanishing.

A board with no rows renders an empty state rather than a spinner.

A card is labelled with the task's `title`, falling back to its `goal`, then to its `id`. It carries the `assignee` beside that label when the row has one. Its status is the column it sits in.

### Transport and theming for both panels

Both read through a resource client. Pass your own through `resourceClient` when your API needs auth headers or a custom `fetch`, and pass a stable reference rather than an object built during render. Left out, each builds its own against the nearest `FlowProvider`'s `baseUrl`, with no auth headers.

Each reads one page. `limit` sets its size. Neither pages beyond it.

A failed read shows what failed and offers a retry. Nothing re-reads on a timer.

Style them by setting the `--fsd-panel-*` CSS custom properties on any ancestor. Fill in your own affordances through `slots`: `rowTrailing` and `empty` on `Roster`; `card`, `columnHeader` and `empty` on `BoardColumns`.

`BoardColumns` renders the `<li>` around every card and puts the task's id on it, so a `card` slot returns the body that goes inside one rather than a list item of its own.

### Presentational components moved to `@flow-state-dev/ui`

`ModelBadge`, `AuditAnnotation`, and `AuditAnnotationProgress` are no longer exported from this package. `ModelBadge` and `AuditAnnotation` live in the [`@flow-state-dev/ui`](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/ui) registry (see [Flow-Aware Components](https://flow-state.dev/docs/ui/flow-aware-components)), where you own the source after installing it. Install `ModelBadge` with `fsdev ui add model-badge` and import it from `@/components/flow-state/model-badge`. Audit annotations render through the ui `audit-annotation` component, fed by the `responseAuditor` pattern's emitted component item, so no per-item wiring is needed. `AuditAnnotationProgress` had no consumers and was removed outright; there is no replacement.

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
