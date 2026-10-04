---
title: Client options
sidebar_label: Client options
description: createClient, FlowProvider, and the options hooks inherit from context.
---

# Client options

The browser (or any HTTP caller) needs a flow kind, a user id, and a base URL. React reads those from `FlowProvider` so each hook does not repeat them.

Narrative: [Client](/docs/client/overview), [React](/docs/client/react).

## `createClient`

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({
  flowKind: "hello-chat",
  userId: "devuser",
});
```

### Choosing `baseUrl`

Every request path the client builds starts with its `apiPath` (`/api/flows` unless you set one), and the client puts `baseUrl` in front of it as given (only a trailing slash is dropped). So `baseUrl` is where your app's FlowState routes are mounted, minus that mount: the origin, plus the deployment's base path if it has one (a Next.js `basePath`, a gateway prefix). A base path here means a prefix in front of the mount. A Node host's `basePath` is not a base path in this sense: it replaces the mount, so it goes in [`apiPath`](#choosing-apipath).

- **Origin.** Required anywhere without a page to resolve a relative path against: Node, a worker, a test, a Next.js server component or route handler. Without it `fetch` rejects every request with an invalid-URL error. Also required when the API is on another origin than the page.
- **Base path.** Include it whenever the routes live below one, in every runtime. If the API answers at `https://api.example.com/portal/api/flows/…`, pass `https://api.example.com/portal`. Passing only the origin drops `/portal` and every request 404s.
- **Browser, same origin, no base path:** leave `baseUrl` off. The browser resolves `/api/flows/…` against the page.
- **Never append the mount yourself.** The client adds `apiPath`, so `baseUrl: "/api/flows"` requests `/api/flows/api/flows/…`.

| Where the client runs | Routes answer at | `baseUrl` |
|---|---|---|
| Browser, same origin | `/api/flows/…` | omit |
| Browser, same origin, Next.js `basePath: "/portal"` | `/portal/api/flows/…` | `"/portal"` |
| Node | `http://localhost:3000/api/flows/…` | `"http://localhost:3000"` |
| Any runtime, API on another origin | `https://api.example.com/api/flows/…` | `"https://api.example.com"` |
| Any runtime, another origin behind a gateway prefix | `https://api.example.com/portal/api/flows/…` | `"https://api.example.com/portal"` |

A common mistake: in a default Next.js app with no `basePath`, `baseUrl: "/api"` requests `/api/api/flows/…` and 404s. That is only wrong because the app has no base path. If your deployment really is mounted at `/api`, so its routes answer at `/api/api/flows/…`, then `"/api"` is correct.

```ts
// A Node script talking to a local dev server
const client = createClient({
  flowKind: "hello-chat",
  userId: "devuser",
  baseUrl: "http://localhost:3000",
});
```

The same rule applies to `createSessionClient`, `createRecoveryClient`, `createResourceClient`, and `FlowProvider`. `createSSEClient` and `createUserSSEClient` follow only the prefix half: `baseUrl` is still the origin plus any base path, but nothing is appended, so their `url` must already hold the full route, `/api/flows/…` included.

### Choosing `apiPath`

`apiPath` is where the server mounts the flow API. It defaults to `/api/flows`, so most apps never set it. Set it when the server mounts the API somewhere else, such as a Node host started with `basePath`. Give it the same value the server uses.

```ts
// Server: serve(flowstate, { basePath: "/flows" }) answers at http://localhost:3000/flows/…
const client = createClient({
  flowKind: "hello-chat",
  userId: "devuser",
  baseUrl: "http://localhost:3000",
  apiPath: "/flows",
});
```

A request goes to `baseUrl`, then `apiPath`, then the route, so the action above is sent to `http://localhost:3000/flows/hello-chat/actions/…`. `baseUrl` is the origin plus any prefix in front of the mount; don't repeat the mount in it.

Every client accepts `apiPath`: `createClient`, `createTypedClient`, `createSessionClient`, `createRecoveryClient`, `createResourceClient`, `createSessionSSEClient`, and `transcribe`. `createSSEClient` and `createUserSSEClient` take it too; write their `url` with the usual `/api/flows/…` prefix and the client swaps it for `apiPath`. In React, set it once on `FlowProvider`.

### Fields

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `flowKind` | `string` | required | The flow instance to call: its `kind` for an ordinary flow, the copy's own id for a flow that runs as several copies. See [Flows](/docs/fundamentals/flows#how-an-instance-is-addressed). |
| `userId` | `string` | required | Caller identity sent on every request. The server still resolves the principal from your auth hook; this is the client's claim. |
| `baseUrl` | `string` | page origin (browser only) | Where the FlowState routes are mounted, minus the mount: the origin plus any base path. Omit it in a browser on the same origin with no base path; pass an absolute URL such as `http://localhost:3000` in Node. The client appends `apiPath` itself. See [Choosing `baseUrl`](#choosing-baseurl). |
| `apiPath` | `string` | `"/api/flows"` | Where the server mounts the flow API. Set it to the server's mount when that differs, such as a Node host's `basePath`. See [Choosing `apiPath`](#choosing-apipath). |
| `fetcher` | `typeof fetch` | global `fetch` | Custom fetch (tests, extra headers). |

`createTypedClient({ flow, userId, ... })` adds the same connection fields and types `sendAction` from the flow instance.

## `sendAction` options

Passed per call, not at client construction.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `sessionId` | `string` | new ephemeral session | Existing session to continue. |
| `requestId` | `string` | minted | Correlate a client-generated id with the server request. |
| `metadata` | object | — | Request metadata. Stored on the request record and visible in traces. Session `title` and `tags` are set through the session API, not here. |

## `FlowProvider`

```tsx
import { FlowProvider } from "@flow-state-dev/react";

<FlowProvider flowKind="hello-chat" userId="devuser">
  <Chat />
</FlowProvider>
```

| Field | Type | What it does |
|-------|------|--------------|
| `flowKind` | `string` | Default flow instance for hooks. |
| `userId` | `string` | Default caller id. |
| `sessionId` | `string` | Default session. `useFlow({ autoCreateSession: true })` can mint one instead. |
| `baseUrl` | `string` | Forwarded to the client. Omit it on the same origin with no base path; under a base path, pass it (`"/portal"`); for another origin, pass that origin plus any prefix. See [Choosing `baseUrl`](#choosing-baseurl). A nested provider inherits its parent's `baseUrl`, so pass `baseUrl=""` to reset it to same-origin. |
| `apiPath` | `string` | Where the server mounts the flow API. Default `"/api/flows"`. Every hook and component under the provider uses it. Hooks don't accept `apiPath` as an override; `useVoice` is the exception and takes its own. A nested provider inherits its parent's. See [Choosing `apiPath`](#choosing-apipath). |
| `renderers` | `RendererRegistry` | Custom item renderers. Nested providers merge; child keys override. |
| `children` | `ReactNode` | The tree that may call hooks. |

Hooks (`useFlow`, `useSession`, `useAction`, `useVoice`, …) accept the same connection fields as overrides, except `apiPath`, which only `useVoice` accepts. Hook-specific options (item visibility, auto-create, subscribe keys) are documented on [React](/docs/client/react).

## What the client can see

The server decides the snapshot. Scope `client.expose` / `client.derived` and each resource's `client` block are the gates. The browser cannot opt into private state by passing a flag. See [Client access](/docs/resources/client-access) and [Flow options](./flow#session-user-and-org).

## See also

- [Runtime](./runtime) — the server those clients call
- [Authentication](/docs/server/authentication)
- [React API](/docs/api/react)
