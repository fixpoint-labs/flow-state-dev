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
  baseUrl: "/api/flows",
});
```

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `flowKind` | `string` | required | Which flow to call. |
| `userId` | `string` | required | Caller identity sent on every request. The server still resolves the principal from your auth hook; this is the client's claim. |
| `baseUrl` | `string` | — | API prefix. In Next.js this is often `/api/flows`. |
| `fetcher` | `typeof fetch` | global `fetch` | Custom fetch (tests, extra headers). |

`createTypedClient({ flow, userId, ... })` adds the same connection fields and types `sendAction` from the flow instance.

## `sendAction` options

Passed per call, not at client construction.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `sessionId` | `string` | new ephemeral session | Existing session to continue. |
| `requestId` | `string` | minted | Correlate a client-generated id with the server request. |
| `orgId` | `string` | — | Bind the request to an org. Required when any block set `requireOrg`. |
| `metadata` | object | — | Session metadata (title, tags, …) accepted by the session API. |

## `FlowProvider`

```tsx
import { FlowProvider } from "@flow-state-dev/react";

<FlowProvider flowKind="hello-chat" userId="devuser" baseUrl="/api/flows">
  <Chat />
</FlowProvider>
```

| Field | Type | What it does |
|-------|------|--------------|
| `flowKind` | `string` | Default flow for hooks. |
| `userId` | `string` | Default caller id. |
| `sessionId` | `string` | Default session. `useFlow({ autoCreateSession: true })` can mint one instead. |
| `baseUrl` | `string` | API prefix forwarded to the client. |
| `renderers` | `RendererRegistry` | Custom item renderers. Nested providers merge; child keys override. |
| `children` | `ReactNode` | The tree that may call hooks. |

Hooks (`useFlow`, `useSession`, `useAction`, `useClientData`, `useVoice`, …) accept the same connection fields as overrides. Hook-specific options (item visibility, auto-create, subscribe keys) are documented on [React](/docs/client/react).

## What the client can see

The server decides the snapshot. Scope `client.expose` / `client.derived` and each resource's `client` block are the gates. The browser cannot opt into private state by passing a flag. See [Client access](/docs/resources/client-access) and [Flow options](./flow#session-user-and-org).

## See also

- [Runtime](./runtime) — the server those clients call
- [Authentication](/docs/server/authentication)
- [React API](/docs/api/react)
