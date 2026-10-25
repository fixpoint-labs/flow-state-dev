---
title: Client options
sidebar_label: Client options
description: createClient, FlowProvider, and the options hooks inherit from context.
---

# Client options

A client needs a user id and a way to reach the server: a base URL, or a fetcher. React reads those from `FlowProvider` so each hook doesn't repeat them.

Narrative: [Client](/docs/client/overview), [React](/docs/client/react).

## `createClient`

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({
  userId: "devuser",
  baseUrl: "",
});

await fsd.flow("hello-chat").send("chat", { message: "Hi" });
```

The client isn't bound to a flow. Name the flow on each call with `fsd.flow(address)`.

### Choosing `baseUrl`

Every request path the client builds starts with its `apiPath` (`/api/flows` unless you set one), and the client puts `baseUrl` in front of it as given (only a trailing slash is dropped). So `baseUrl` is where your app's FlowState routes are mounted, minus that mount: the origin, plus the deployment's base path if it has one (a Next.js `basePath`, a gateway prefix). A base path here means a prefix in front of the mount. A Node host's `basePath` is not a base path in this sense: it replaces the mount, so it goes in [`apiPath`](#choosing-apipath).

- **Origin.** Required anywhere without a page to resolve a relative path against: Node, a worker, a test, a Next.js server component or route handler. Without it `fetch` rejects every request with an invalid-URL error. Also required when the API is on another origin than the page.
- **Base path.** Include it whenever the routes live below one, in every runtime. If the API answers at `https://api.example.com/portal/api/flows/…`, pass `https://api.example.com/portal`. Passing only the origin drops `/portal` and every request 404s.
- **Browser, same origin, no base path:** pass `baseUrl: ""` to `createClient`, or leave it off `FlowProvider`. The browser resolves `/api/flows/…` against the page.
- **Never append the mount yourself.** The client adds `apiPath`, so `baseUrl: "/api/flows"` requests `/api/flows/api/flows/…`.

| Where the client runs | Routes answer at | `baseUrl` |
|---|---|---|
| Browser, same origin | `/api/flows/…` | `""` (omit on `FlowProvider`) |
| Browser, same origin, Next.js `basePath: "/portal"` | `/portal/api/flows/…` | `"/portal"` |
| Node | `http://localhost:3000/api/flows/…` | `"http://localhost:3000"` |
| Any runtime, API on another origin | `https://api.example.com/api/flows/…` | `"https://api.example.com"` |
| Any runtime, another origin behind a gateway prefix | `https://api.example.com/portal/api/flows/…` | `"https://api.example.com/portal"` |

A common mistake: in a default Next.js app with no `basePath`, `baseUrl: "/api"` requests `/api/api/flows/…` and 404s. That is only wrong because the app has no base path. If your deployment really is mounted at `/api`, so its routes answer at `/api/api/flows/…`, then `"/api"` is correct.

```ts
// A Node script talking to a local dev server
const fsd = createClient({
  userId: "devuser",
  baseUrl: "http://localhost:3000",
});
```

The same rule applies to `FlowProvider`. Every call and stream the client makes, sessions, resources and request recovery included, uses the one `baseUrl`.

### Choosing `apiPath`

`apiPath` is where the server mounts the flow API. It defaults to `/api/flows`, so most apps never set it. Set it when the server mounts the API somewhere else, such as a Node host started with `basePath`. Give it the same value the server uses.

```ts
// Server: serve(flowstate, { basePath: "/flows" }) answers at http://localhost:3000/flows/…
const fsd = createClient({
  userId: "devuser",
  baseUrl: "http://localhost:3000",
  apiPath: "/flows",
});
await fsd.flow("hello-chat").send("chat", { message: "Hi" });
```

A request goes to `baseUrl`, then `apiPath`, then the route, so the action above is sent to `http://localhost:3000/flows/hello-chat/actions/…`. `baseUrl` is the origin plus any prefix in front of the mount; don't repeat the mount in it.

Every call and stream the client makes uses it, `transcribe` included. In React, set it once on `FlowProvider`.

### Fields

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `userId` | `string` | required | The user every call acts as. With sign-in on, the server identifies the caller from the request's credentials instead. |
| `baseUrl` | `string` | required unless `fetcher` is set | Where the FlowState routes are mounted, minus the mount: the origin plus any base path. `""` is the page's own origin; pass an absolute URL such as `http://localhost:3000` in Node. The client appends `apiPath` itself. See [Choosing `baseUrl`](#choosing-baseurl). |
| `apiPath` | `string` | `"/api/flows"` | Where the server mounts the flow API. Set it to the server's mount when that differs, such as a Node host's `basePath`. See [Choosing `apiPath`](#choosing-apipath). |
| `fetcher` | `ClientFetch` | global `fetch` | The `fetch` every call and stream goes through. See [Adding credentials](#adding-credentials) and [Calling an engine in the same process](#calling-an-engine-in-the-same-process). |

Called without `baseUrl` or `fetcher`, `createClient` throws. With a `fetcher` and no `baseUrl`, the client requests relative paths (`/api/flows/…`): in a browser a credential wrapper reaches the page's own origin, and `createInProcessFetch` reads the path and ignores the origin.

### Adding credentials

Wrap `fetch` to add a header, and pass the wrapper as `fetcher`. Every call and stream the client makes goes through it.

```ts
const fsd = createClient({
  userId,
  baseUrl: "https://api.example.com", // leave out for the page's own origin
  fetcher: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  },
});
```

The server decides who the caller is from those credentials; see [Authentication](/docs/server/authentication).

### Calling an engine in the same process

A script, a test or a worker that runs next to the engine can skip the web server. Pass the engine's `createInProcessFetch` as the fetcher:

```ts
import { createFlowState, createInProcessFetch } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";

const flowState = createFlowState({ flows: { support } });
const fsd = createClient({ userId: "user_1", fetcher: createInProcessFetch(flowState) });

const sent = await fsd.flow("support").send("reply", { text: "Hi" });
```

Leave out `baseUrl`. The calls reach the same routes, with the same checks and answers, as they would over HTTP, streams included. If the engine is mounted somewhere other than `/api/flows`, pass the same path as `createInProcessFetch`'s `basePath` and the client's `apiPath`. See [Host adapters](/docs/server/host-adapters#calling-flows-in-the-same-process).

## `send` options

Passed per call to `fsd.flow(address).send(action, input, options)`.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `sessionId` | `string` | a new session | Existing session to run in. |
| `requestId` | `string` | minted | Your own id for the request. |
| `metadata` | object | none | Request metadata. Stored on the request record and visible in traces. Session `title` and `tags` are set through `fsd.sessions.updateMetadata`, not here. |
| `stream` | `true` | off | Resolve to the server's SSE `Response` instead of a request handle. See [the API reference](/docs/api/client#sendaction-input-options). |

## `FlowProvider`

```tsx
import { FlowProvider } from "@flow-state-dev/react";

<FlowProvider flowKind="hello-chat" userId="devuser">
  <Chat />
</FlowProvider>
```

| Field | Type | What it does |
|-------|------|--------------|
| `flowKind` | `string` | Default flow for hooks. |
| `userId` | `string` | Default caller id. |
| `sessionId` | `string` | Default session. `useFlow({ autoCreateSession: true })` can mint one instead. |
| `baseUrl` | `string` | Forwarded to the client. Omit it on the same origin with no base path; under a base path, pass it (`"/portal"`); for another origin, pass that origin plus any prefix. See [Choosing `baseUrl`](#choosing-baseurl). A nested provider inherits its parent's `baseUrl`, so pass `baseUrl=""` to reset it to same-origin. |
| `fetcher` | `ClientFetch` | The `fetch` every hook and component under the provider calls and streams through: a wrapper that adds credentials, or `createInProcessFetch`. Default: the global `fetch`. A nested provider inherits its parent's. Pass a stable reference. |
| `apiPath` | `string` | Where the server mounts the flow API. Default `"/api/flows"`. Every hook and component under the provider uses it. Hooks don't accept `apiPath` as an override; `useVoice` is the exception and takes its own. A nested provider inherits its parent's. See [Choosing `apiPath`](#choosing-apipath). |
| `renderers` | `RendererRegistry` | Custom item renderers. Nested providers merge; child keys override. |
| `children` | `ReactNode` | The tree that may call hooks. |

The hooks under a provider share one client built from its `userId`, `baseUrl`, `apiPath` and `fetcher`. Hooks (`useFlow`, `useSession`, `useAction`, `useVoice`, …) accept `flowKind`, `userId` and `baseUrl` as overrides. `fetcher` and `apiPath` come only from the provider, except that `useVoice` takes its own `apiPath`. Hook-specific options (item visibility, auto-create, subscribe keys) are documented on [React](/docs/client/react).

## What the client can see

The server decides the snapshot. Scope `client.expose` / `client.derived` and each resource's `client` block are the gates. The browser cannot opt into private state by passing a flag. See [Client access](/docs/resources/client-access) and [Flow options](./flow#session-user-and-org).

## See also

- [Runtime](./runtime): the server the client calls
- [Authentication](/docs/server/authentication)
- [React API](/docs/api/react)
