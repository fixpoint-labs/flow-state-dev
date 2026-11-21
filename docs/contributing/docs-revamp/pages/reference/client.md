---
title: Client configuration
type: reference
description: "Every option of createClient and FlowProvider, what each hook takes over the provider's settings, and the topics, notices and live reads of the browser client."
---

# Client configuration

A client is the code that calls a Flow State server from a page, a script or a test. Its job is to make every call on behalf of one user over one transport, so the server's flows look like typed function calls and the caller never builds a URL or reads a stream by hand. `createClient` makes one. In React, `FlowProvider` holds the same settings once for a component tree, and the hooks under it build their clients from them.

[What the browser sees](../concepts/what-the-browser-sees.md) explains what a page can reach through the client and what it never gets. This page lists the options, defaults, refusals and limits. The calls a client makes are in the [HTTP API reference](./http-api.md).

The examples use a support desk: a `support` flow with a `reply` action, called by the desk's agents.

## Quick answers

| Question | Answer |
|---|---|
| What must `createClient` be given? | A non-empty `userId`, and either a `baseUrl` or a `fetcher`. Missing either, it throws at construction a `ClientHttpError` of `status: 0`: `userId is required`, or `createClient requires baseUrl, or a fetcher`. |
| What goes in `baseUrl` on the page's own origin? | `""`, or leave it off under a `FlowProvider`. A Next.js `basePath` such as `"/portal"` goes here. The server's mount never does. See [`baseUrl` by situation](#baseurl-by-situation). |
| Where do credentials and a tenant go? | In the `fetcher`. There is no header, token, tenant or timeout option. |
| Which hooks can override `apiPath` or `fetcher`? | None, except `useVoice`, which takes its own `apiPath`. See [What each hook takes](#what-each-hook-takes-over-the-providers). |
| What does a hook use with no `userId` anywhere? | `"devuser"`, except `useAction`, which throws. |

## `createClient` options

`createClient(options: CreateClientOptions): Client`. There are no other options.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `userId` | `string` | required | The user every call acts as. Sent as caller input and never trusted: with sign-in, the server authenticates the request's credentials instead. Trimmed; an empty or whitespace value throws `userId is required`. |
| `baseUrl` | `string` | none | Where the server answers, such as `"http://localhost:3000"`; `""` for the page's own origin. Put in front of every route as given, minus one trailing `/`. Required without a `fetcher`. |
| `apiPath` | `string` | `"/api/flows"` | Where the server mounts the flow API, after `baseUrl`. Replaces the leading `/api/flows` of every route. A missing leading `/` is added, one trailing `/` is dropped, and `""` mounts the routes at the root (`/support/actions/reply`). |
| `fetcher` | `ClientFetch` | the global `fetch` | The fetch every call and stream goes through: `(input: RequestInfo \| URL, init?: RequestInit) => Promise<Response>`. |

```ts title="src/lib/desk-client.ts"
import { createClient } from "@flow-state-dev/client";

export function deskClient(userId: string) {
  return createClient({ userId, baseUrl: "http://localhost:3000" });
}

export async function reply(userId: string, text: string) {
  const sent = await deskClient(userId).flow("support").send("reply", { text });
  return sent.wait();
}
```

A client does not choose the flow: `fsd.flow(address)` names it on each call.

### The fetcher

- One client is one transport. Every call and every stream goes through the `fetcher`: request streams, session streams, `transcribe`, `upload`, and the request that mints the `subscribe` socket. Nothing reaches the global `fetch` once a `fetcher` is given.
- The default is the global `fetch`, looked up on each call, so a `fetch` installed or wrapped after the client was built is the one used. With no global `fetch` and no `fetcher`, construction throws `No fetch implementation is available. Pass a fetcher to createClient.`
- Another user, or another server, is another client.
- A non-2xx answer throws `ClientHttpError` with `status` (the HTTP status, or `0` when the client refused before sending) and `body` (parsed JSON, the text when it does not parse, or `{ error }` for a status-`0` refusal).

With a `fetcher` and no `baseUrl`, routes are requested as relative paths (`/api/flows/...`). A credential wrapper hands the path to the browser's `fetch`, which resolves it against the page.

A client has no tenant option, so it sends a tenant header through its `fetcher`. The header name and what the server refuses are in [Tenant isolation](./authentication.md#tenant-isolation).

```ts title="src/lib/acme-client.ts"
import { createClient, type ClientFetch } from "@flow-state-dev/client";

const withTenant: ClientFetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("x-tenant-id", "acme");
  return fetch(input, { ...init, headers });
};

export const acme = createClient({ userId: "agent_7", baseUrl: "", fetcher: withTenant });
```

### `baseUrl` by situation

| Where the client runs | Routes answer at | `baseUrl` |
|---|---|---|
| Browser, same origin | `/api/flows/...` | `""`, or none under a `FlowProvider` |
| Browser, same origin, Next.js `basePath: "/portal"` | `/portal/api/flows/...` | `"/portal"` |
| Node, a worker, a test, a server component | `http://localhost:3000/api/flows/...` | `"http://localhost:3000"`. Required: with no page to resolve a relative path against, `fetch` rejects the URL as invalid. |
| Another origin | `https://api.example.com/api/flows/...` | `"https://api.example.com"` |
| Another origin behind a prefix | `https://api.example.com/portal/api/flows/...` | `"https://api.example.com/portal"` |
| Server mounted elsewhere, such as the Node host's `serve(flowstate, { basePath: "/flows" })` | `http://localhost:3000/flows/...` | the origin, plus `apiPath: "/flows"` |

The mount never goes in `baseUrl`. `baseUrl: "/api/flows"` requests `/api/flows/api/flows/...`, and a default Next.js app with `baseUrl: "/api"` requests `/api/api/flows/...` and gets a 404. The Node host's `basePath` replaces `/api/flows`; it is not a prefix in front of it.

### In-process

A script, test or worker that shares a process with the engine passes `createInProcessFetch(flowState)` from `@flow-state-dev/engine` as `fetcher` and leaves `baseUrl` out. The calls reach the same routes with the same checks, streams included.

The flow it serves:

```ts title="src/flows/support/flow.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReplyFor } from "../../lib/replies";

const reply = handler({
  name: "reply",
  inputSchema: z.object({ text: z.string() }),
  execute: async (input) => ({ reply: await draftReplyFor(input.text) }),
});

export const support = defineFlow({ kind: "support", actions: { reply: { block: reply } } })();
```

```ts title="src/lib/in-process-client.ts"
import { createFlowState, createInProcessFetch } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import { support } from "../flows/support/flow";

const flowState = createFlowState({ flows: [support] });

export const fsd = createClient({ userId: "agent_7", fetcher: createInProcessFetch(flowState) });
```

If the engine serves under a path other than `/api/flows`, give `createInProcessFetch` the same path as `basePath` and the client the same `apiPath`.

## `FlowProvider` props

`FlowProvider` is exported from `@flow-state-dev/react`. It holds one set of settings for every hook and component under it.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `flowKind` | `string` | none | The flow hooks address by default. |
| `sessionId` | `string` | none | Stored in the context and readable with `useFlowContext().sessionId`. No hook or component in `@flow-state-dev/react` reads it; an app's own component can. |
| `userId` | `string` | see [What hooks inherit](#what-hooks-inherit) | The default caller id for hooks. |
| `baseUrl` | `string` | `""` | Forwarded to the clients the hooks build. Unset means the page's own origin, with or without a `fetcher`. |
| `apiPath` | `string` | `"/api/flows"` | As on `createClient`. Every hook and component under the provider uses it. |
| `fetcher` | `ClientFetch` | the global `fetch` | As on `createClient`. Every hook's calls and streams go through it. |
| `renderers` | `RendererRegistry` | none | Item renderers for `ItemRenderer` and `ItemsRenderer`. Merged with the parent's; see [UI components](./ui-components.md#renderers). |
| `children` | `ReactNode` | required | |

```tsx title="src/app/page.tsx"
"use client";

import { FlowProvider } from "@flow-state-dev/react";
import { DeskInbox } from "../components/desk-inbox";

export default function Page({ agentId }: { agentId: string }) {
  return (
    <FlowProvider flowKind="support" userId={agentId} baseUrl="">
      <DeskInbox />
    </FlowProvider>
  );
}
```

`DeskInbox` calls a hook, which takes `flowKind` and `userId` from the provider:

```tsx title="src/components/desk-inbox.tsx"
"use client";

import { useAction } from "@flow-state-dev/react";

export function DeskInbox() {
  const reply = useAction({ action: "reply" });
  return <button onClick={() => void reply.execute({ text: "On its way." })}>Send reply</button>;
}
```

- **Nesting.** A provider inside another inherits each of `flowKind`, `sessionId`, `userId`, `baseUrl`, `apiPath` and `fetcher` that it does not set. A prop counts as set unless it is `undefined`, so `baseUrl=""` on the inner provider is set, and points its panel at the page's own origin. `apiPath` and `fetcher` can be replaced, never unset. Renderers merge one slot at a time: `renderers={{ message: false }}` on the inner provider turns off the outer `message` renderer and keeps the others, and `component`, `container` and `data` merge by key, the inner provider's entry winning.
- **Optional.** A hook works without a provider. It uses `"devuser"` when it has no `userId`, and builds its own client.
- `useFlowContext()` returns the merged `{ flowKind, sessionId, userId, baseUrl, apiPath, fetcher, renderers, clients }`, and `{}` outside a provider. `clients` is the provider's client cache and is not for apps.
- **Server components.** The package declares no `"use client"` boundary. A server component cannot call a hook, so the file that imports hooks or `FlowProvider` starts with `"use client";`. In a server component or route handler, use `createClient` with an absolute `baseUrl` or an in-process `fetcher`.

## What hooks inherit

Every hook calls through one client, made as `createClient({ userId, baseUrl: baseUrl ?? "", apiPath, fetcher })` from the hook's own `userId`, `baseUrl` and `apiPath` where it takes them, and the provider's values otherwise.

- **One client per user and transport.** Under a provider, hooks with the same `userId`, `baseUrl`, `apiPath` and `fetcher` get the same client, so they share one `subscribe` socket. Each provider has its own cache, so two providers never share a client. Outside a provider each hook builds its own. A hook with a `userId` override gets (or builds) another client than its siblings.
- **Keep `fetcher` stable.** The client is memoized on `(userId, baseUrl, apiPath, fetcher)`. A `fetcher` that is a new function on each render makes a new client on each render, which closes its streams and socket. Define it outside the component or memoize it.
- **No `userId` anywhere.** `useSession`, `useFlow`, `useRequestStream` and the other hooks act as `"devuser"`. `useAction` throws `useAction requires userId (option or FlowProvider)`.
- **No `flowKind`.** `useAction` throws `useAction requires flowKind (option or FlowProvider)`. `useRequestStream` throws the same for a `{ requestId }` source, and `useFlow.createSession` throws `useFlow.createSession requires flowKind`.

### What each hook takes over the provider's

"Option" means the hook's own option beats the provider's. "Provider" means the hook has no such option.

| Hook | `flowKind` | `userId` | `baseUrl` | `apiPath` | `fetcher` | `client` |
|---|---|---|---|---|---|---|
| `useFlow`, `useSession`, `useAction` | option | option | option | provider | provider | none |
| `useRequestStream` | option | provider | option | provider | provider | option |
| `useVoice` | its session's | its session's | option | option | provider | none |
| `useResource`, `useSessionFeed`, `useSubscription`, `useView`, `FlowNavigator` | provider | provider | provider | provider | provider | option |
| `useSessionList` | option, never the provider's | provider | provider | provider | provider | option |
| `useResourceCollection`, `useResourceContent` | none | provider | provider | provider | provider | none |
| `useResourceManifest` | its session's | provider | provider | provider | provider | none |
| `useApproval`, `useSuspensionForm` | provider | provider | provider | provider | provider | none |
| `useHarnessLines` | its session's | its session's | provider | provider | provider | none |

`useSessionList` lists the sessions of the flow named by its own `flowKind`, or of one flow instance named by `flowId`. With neither set it lists with no flow filter; it does not read the provider's `flowKind`. `useResourceCollection` and `useResourceContent` take a session and a resource ref and use no `flowKind`.

`client` is for a host that builds its own client, with its own user, origin and `fetcher`, so the socket and the reads carry its credential. Pass a stable reference. The default is the provider's client. `useRequestStream` takes a `Pick<Client, "flow">`; `useSubscription` takes a `Pick<Client, "subscribe">`.

### Other hook options

| Hook and option | Default | Meaning |
|---|---|---|
| `useAction({ action, result })` | `result` unset or `false` | `execute(input, sessionId?)` resolves when the server accepts the send, to `ExecuteActionResponse`. With `result: true` it resolves to `request.result()` (`status`, plus `output`, `outputNotRecorded` or `error`) and `loading` stays true until the request settles. An unmount stops the wait and never the run. |
| `useSession(sessionId, { live })` | `false` | Without it the view follows only this page's own requests. `live: true` opens one stream for the session after its first snapshot; each finished item that any request in the session stores is added to `items` about a second later, in the order a fresh load of the session would show them. If the server has no session stream, or refuses it, the item list behaves as if `live` were off, and no error is raised. The stream holds a connection open while mounted. |
| `useSession` with `live: true` | | Also subscribes the session, user and org topics. On a `state` notice, or a `resource` notice for a resource the view's state snapshot holds, the view reads its state again. Its item history is not re-read. A connect, a tick and a `resync` read too. A change this view's own request made is skipped while that request is in flight or its stream is open; the skip applies to `state` and `resource` notices only. A host with push ([Subscribing](#subscribing)) shows the change within about a second; a host without push reads every 3 seconds, the `client.live` default for `pollIntervalMs`. |
| `Roster`, `BoardColumns`, `BoardList` `live` | `false` | Components of the workforce package, from `@flow-state-dev/workforce/react` ([Workforce](./workforce.md)). Read the roster or board again whenever another session hires, changes a worker, or changes a task. They take `client?`. A `client` that has no `subscribe` is typed to take `live: false` or no `live`; `live: true` with it does not compile. |
| `useClientData(session, { session?, user?, org? })` | | Each scope takes `string[]` or `Record<name, ZodSchemaLike \| true>`. With a Zod schema the value is typed as the schema's output; with `true` or an array it is `unknown`. The schema only types the value: nothing is parsed at run time. The server decides what is in the snapshot. |
| `useSubscription(topics, read, { pollIntervalMs?, enabled?, client? })` | `enabled: true`, no timer | See [Timing](#timing). `enabled: false`, or an empty topic list, subscribes nothing. |
| `useResource(def, { pollIntervalMs?, all?, topicPrefix?, client? })` | | `pollIntervalMs` is the timer pace where push can miss a change. At user or org scope `all` reads every entry of a collection, page after page; `topicPrefix` narrows it to keys starting with it. Both are ignored for a single resource, and `all` at session scope. |
| `useView(ref, input, { enabled?, pollIntervalMs?, client?, sessionId? })` | `pollIntervalMs: 3000` | `null` for no timer. |
| `useRequestStream({ source, reconnect, includeTrace, ... })` | `reconnect: false` | Options are in [Items and the stream](./items.md#what-the-js-client-does). |

## What the browser holds

Settings on `createClient` and `FlowProvider` are code, kept in memory for the life of the client or provider. Nothing about them is stored. The browser holds what it last received, in these parts:

| Part | Owner | Who can see it | Where it lives | How many |
|---|---|---|---|---|
| The client, its transport and its one socket | The code that built it, or the `FlowProvider` that caches it | Code holding the reference | Page memory; gone on reload | One per `(user, baseUrl, apiPath, fetcher)` per provider |
| The live item list (`useSession`'s `items`) | The hook instance | Components under the hook | Page memory; rebuilt from the server on mount | One per mounted `useSession` |
| The exposed-state snapshot (`session.snapshot`, which `useClientData` reads) | The server decides what is in it, through each scope's `client.expose` and each resource's client config. A computed value is a [view](./views.md), declared with `defineView` and read with `useView` | Components under the hook | Page memory, a copy read from the server | One per `useSession` view |
| Unsent draft text (`useDraft(namespace, id)`, `useDraftSend`) | The app, by the `namespace` it passes | Any script on the browser's origin; no other user or device | `localStorage` under `<namespace>:<id>`, as plain text. Falls back to memory when storage throws or there is no `window`. | One per `(namespace, id)`. Setting `""`, or a send that lands, removes it. |

No `createClient` option or `FlowProvider` prop changes any of this. A draft key names no user, so two users on one browser origin with the same `namespace` and `id` read each other's draft. Text typed before `id` is known stays in memory and is stored when the id arrives. If the draft changes while a send is in flight, the send clears it only when the stored text equals what was sent.

## Subscribing

`fsd.subscribe(topics, { onChange, pollIntervalMs? })` returns `{ close() }`. A notice says that something under a topic changed, never what. It carries no rows. The caller reads again through the route it already reads with, and that read is checked on the server like any other.

- **One connection.** All subscriptions on one client share one WebSocket. Each topic is counted; the last `close()` on a topic unsubscribes it, and the last handle's `close()` closes the socket.
- **Push or timer.** A host with push is one whose `GET /api/flows/capabilities` answers `push: { transport: "websocket" }`. `serve()` from `@flow-state-dev/node` serves the socket unless given `push: false`. A host that answers `push: null`, or no `push` field, is a host without push. On a host with push, the client makes one request through its `fetcher` to open the socket, so the credentials the fetcher adds are what sign the socket in. On a host without push, `onChange(null)` runs only on the `pollIntervalMs` timer and no socket opens. The code is the same both ways.
- **`onChange(notice | null)`.** `null` means a connect, a reconnect, a timer tick, or a change in whether the server's stores carry notices between processes (see [`pollIntervalMs`](#pollintervalms)). On `null`, read everything. It is called once on connect, after the server accepts the socket, and a throwing `onChange` does not stop the others.
- **A topic the caller may not read** is left out of the subscription, as a nonexistent session is. `onChange` never hears it. With `pollIntervalMs`, the client asks again at each tick.

```ts title="src/lib/watch-ticket.ts"
import { createClient, topic } from "@flow-state-dev/client";

export function watchTicket(sessionId: string, reload: () => void) {
  const fsd = createClient({ userId: "agent_7", baseUrl: "" });
  return fsd.subscribe([topic.session(sessionId), topic.user()], {
    onChange: reload,
    pollIntervalMs: 5000
  });
}
```

### `pollIntervalMs`

Read on a timer at this pace wherever push can miss a change. Omitted, there is no timer, and reads happen on a notice, a connect and a reconnect. The timer runs:

- on a host without push;
- while the socket is down, from the first failed reconnect;
- while the server's stores say they do not carry notices between server processes: with Postgres stores, until their listening connection hears its own ping and while it is lost, and always with no tail pool (see [The change bus](./stores.md#the-change-bus));
- while one of its topics was refused (with no `pollIntervalMs`, a refused topic is asked for again only on reconnect).

The default in-memory bus, which SQLite stores get too, says it carries every change, so the timer stays off while the socket is up. That holds for one server process. With several processes on it, a change made in another process never reaches the socket and shows at the view's next read.

### Topics

`topic` is exported from `@flow-state-dev/client` and `@flow-state-dev/core`. Each constructor takes an optional `{ resource }`, which narrows the topic to one resource under the scope. A topic without `resource` also hears changes narrowed to a resource under it.

| Topic | Covers |
|---|---|
| `topic.session(id, { resource? })` | One session. |
| `topic.user({ resource? })` | The signed-in user. |
| `topic.org({ resource? })` | The signed-in user's organization. |

`topic.user()` and `topic.org()` take no id. The server fills them from the caller it verified, so a client cannot ask for someone else's scope by naming it. The wire type is `{ scope: "session"; id: string; resource?: string } | { scope: "user" | "org"; resource?: string }`.

### Notices

A `WireNotice` is `{ topic, kind, origin?, ids?, partition? }`. `origin.requestId` names the request that made the change, when a run did; it is absent on a write from a browser route. `ids` are opaque ids of what changed. Each kind's row says when they are absent. `partition` is an opaque string some `board` notices carry, naming the slice of the board the changed task was filed in. Compare it for equality; do not parse it.

`kind` is one of the values below. `topic.resource` on the notice holds the resource path for `"resource"` (a collection entry may carry its key in `ids`) and the board id for `"board"`; otherwise it is absent.

| Kind | Written when | On |
|---|---|---|
| `items` | An item was stored under one of the session's requests. `ids` is absent. | session |
| `request` | A request was created, its status moved, or it was deleted. `ids` holds the request id. | session |
| `run` | The session record was written, or a run (a child session) under it. `ids` holds the run's session id. On the user topic: one of the user's sessions was created, titled or deleted, or one of its requests started or ended. `ids` is absent there. | session, user |
| `state` | A state patch, or the session born or deleted. Session, user and org state. | session, user, org |
| `resource` | A client-readable resource was written, created or deleted, in a run or from a browser route. A resource with no client config publishes nothing. | session, user, org |
| `board` | A task on a board changed. `ids` holds the task id. At user scope `ids` is absent. | session, user |
| `suspension` | One of the user's suspensions was written or deleted. `ids` is absent. | user |
| `resync` | The server may have missed notices. Every subscriber reads once, whatever kinds it otherwise hears. | any |

A session state delta and streamed items send no `run` to the user topic, though the session's own topic hears them. A write to a request's state fields publishes a `request` notice on its session and a `run` notice on the session's parent, and a session state delta publishes `run` on the session and its parent. Writes to block-instance state publish nothing, and a request's own state writes raise no `state` or `resource` notice. A notice reaches every subscription whose topic covers it: the same scope and session, and the same resource unless the subscription's topic names none.

## `client.live`

`fsd.live(topics, options)` keeps a screen current. It reads at once, and again on each notice it hears.

| Option | Default | Meaning |
|---|---|---|
| `read(notice \| null, signal)` | required | Reads the data. The `AbortSignal` aborts when the subscription ends. |
| `onValue`, `onError`, `onStale` | | Receive the value (only when it changed, compared by value), a failed read, and the stale flag. |
| `hear(notice)` | all | Filters which notices read. A connect, a reconnect, a tick (`null`) and a `resync` always read. |
| `paths` | all | Limits `resource` notices to those whose path falls under one of the roots. |
| `pollIntervalMs` | `3000` | The timer wherever push can miss a change. `null` for no timer; any other number sets the pace. |
| `readNow` | `true` | `false` leaves the first read to the subscription's connect. |
| `topicsFromResult` | `false` | `true` means each read returns a result that also names the topics to hear next. |

One read is in flight and at most one waits. A burst runs the read once more after the one in flight, not once per change. The waiting read gets the one notice that waited, or `null` when several different ones did. A failed read tries again on its own, after 1 s doubling to 30 s, and `onStale(true)` says the screen is stale until one lands. `close()` stops it.

### Timing

`useSubscription(topics, read, options)` follows the same rules over the provider's client, so the provider's `fetcher` signs the socket in. On a host with push, the read runs on each notice; on a host without push it runs every `pollIntervalMs`, and omitted means no timer. There is no read on mount: the subscription's connect is the first read. A `read` that throws tries again after 1 s doubling to 30 s. A subscription is kept across renders with an equal topic list, and the latest `read` is the one called; a changed topic list closes the old subscription and opens a new one.

`useSessionList` and `FlowNavigator` read through the user topic and list again on a `run` notice and when the page becomes visible. A disabled list subscribes to nothing.

## Limits

- `createClient` has no option for headers, tokens, timeouts, retries or a tenant.
- A client is bound to one user.
- A hook cannot override `apiPath` or `fetcher`, except that `useVoice` takes its own `apiPath`.
- `baseUrl` cannot carry the server's mount.
- A notice never says what changed.
- The `FlowProvider` `sessionId` prop is not read by any built-in hook.
- Draft text is plain text in `localStorage` and is not keyed by user.

Request stream options and reconnects are in [Items and the stream](./items.md#what-the-js-client-does). Renderers are in [UI components](./ui-components.md#renderers). Sign-in and tenant configuration on the server are in [Authentication](./authentication.md).
