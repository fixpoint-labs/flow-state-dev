# @flow-state-dev/client

Isomorphic transport/API client for Flow State Dev.

`@flow-state-dev/client` owns framework network access:
- action execution
- session CRUD + session request listing
- session state snapshots (scope state + scope-grouped projections + optional items)
- request/user SSE consumption

No React or DOM dependency.

## Public API

- `createClient(options)`
- `createTypedClient(options)`
- `createSessionClient(options)`
- `createSSEClient(options)`
- `createUserSSEClient(options)`
- `ClientHttpError`

## `createClient` vs `createTypedClient`

`createClient`:
- dynamic action names (`sendAction("run", input)`)
- best for tooling and generic UIs

`createTypedClient`:
- flow-bound action methods (`actions.run(input)`)
- best when a flow definition is available at compile time

## Usage

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({
  flowKind: "demo",
  userId: "devuser",
});

await client.sendAction("run", { value: "hello" }, { sessionId: "sess_1" });
```

Typed client:

```ts
import { createTypedClient } from "@flow-state-dev/client";

const typed = createTypedClient({ flow, userId: "devuser" });
await typed.actions.run({ value: "hello" });
```

Snapshot API with query controls:

```ts
const sessions = createSessionClient();

const snapshot = await sessions.getSessionState("sess_1", {
  includeItems: true,
  projections: ["session.artifactsList", "user.topics"],
});
```

### SSE Stream Client

```ts
import { createSSEClient } from "@flow-state-dev/client";

const stream = createSSEClient({
  url: `/api/flows/my-flow/requests/${requestId}/stream`,
  onItemAdded: (event) => { /* handle new item */ },
  onContentDelta: (event) => { /* handle text chunk */ },
  onRequestStatus: (event) => {
    if (event.status === "completed") { /* refetch state */ }
  },
});
```

## Notes

- `userId` is required for Phase 1 action/session calls.
- Request stream resume supports both `Last-Event-ID` and `starting_after`.
- When both resume inputs are supplied, `starting_after` takes precedence.

## Architecture Reference

- [Server and Client](../../docs/architecture/server-and-client.md) — routes, transport, React hooks contract
- [Streaming](../../docs/architecture/streaming.md) — item/content model, SSE protocol, resume

## Scripts

- `pnpm --filter @flow-state-dev/client build`
- `pnpm --filter @flow-state-dev/client typecheck`
- `pnpm --filter @flow-state-dev/client test`
