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

Every request path the client builds already starts with `/api/flows`, so `baseUrl` is only what goes in front of it. What to pass depends on where the client runs:

- **In a browser, on the same origin as the API:** leave it off. The browser resolves `/api/flows/…` against the page's origin. If the app is served under a sub-path (a Next.js `basePath` of `/portal`, say), pass that path: `baseUrl: "/portal"`.
- **In Node or another server-side runtime** (a script, a worker, a test, a Next.js server component or route handler): pass an absolute origin such as `http://localhost:3000`, plus the base path if there is one (`http://localhost:3000/portal`). There is no page origin to resolve a relative path against, so without it `fetch` rejects every request with an invalid-URL error.
- **When the API lives on another origin:** pass that origin, such as `https://api.example.com`, from any runtime.
- **Never** include the `/api` or `/api/flows` route prefix. `baseUrl: "/api/flows"` produces `/api/flows/api/flows/…`.

```ts
// A Node script talking to a local dev server
const client = createClient({
  flowKind: "hello-chat",
  userId: "devuser",
  baseUrl: "http://localhost:3000",
});
```

The same rule applies to `createSessionClient`, `createRecoveryClient`, `createResourceClient`, and `FlowProvider`.

### Fields

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `flowKind` | `string` | required | The flow instance to call: its `kind` for an ordinary flow, the copy's own id for a flow that runs as several copies. See [Flows](/docs/fundamentals/flows#how-an-instance-is-addressed). |
| `userId` | `string` | required | Caller identity sent on every request. The server still resolves the principal from your auth hook; this is the client's claim. |
| `baseUrl` | `string` | page origin (browser only) | Prefix put in front of `/api/flows/…`: an origin, the app's base path, or both. Omit it in a browser on the same origin; pass an absolute origin such as `http://localhost:3000` in Node. Never the `/api` or `/api/flows` route prefix. See [Choosing `baseUrl`](#choosing-baseurl). |
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
| `baseUrl` | `string` | Forwarded to the client. Omit it in a browser on the same origin; pass the base path under a sub-path. Never the route prefix. See [Choosing `baseUrl`](#choosing-baseurl). |
| `renderers` | `RendererRegistry` | Custom item renderers. Nested providers merge; child keys override. |
| `children` | `ReactNode` | The tree that may call hooks. |

Hooks (`useFlow`, `useSession`, `useAction`, `useClientData`, `useVoice`, …) accept the same connection fields as overrides. Hook-specific options (item visibility, auto-create, subscribe keys) are documented on [React](/docs/client/react).

## What the client can see

The server decides the snapshot. Scope `client.expose` / `client.derived` and each resource's `client` block are the gates. The browser cannot opt into private state by passing a flag. See [Client access](/docs/resources/client-access) and [Flow options](./flow#session-user-and-org).

## See also

- [Runtime](./runtime) — the server those clients call
- [Authentication](/docs/server/authentication)
- [React API](/docs/api/react)
