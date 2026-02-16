# @flow-state-dev/client

Isomorphic transport and API client for Flow State Dev.

This package owns network-facing framework APIs:
- action execution
- session and state snapshot APIs
- SSE request/user stream consumption

It has no React or DOM rendering dependency.

## What This Package Is For

Use `@flow-state-dev/client` when you need to call canonical `/api/flows` endpoints from app code, dev tools, or wrappers.

This package provides both:
- generic runtime clients (`sendAction`, session APIs, stream APIs)
- typed flow-bound helpers (`actions.<actionName>(input)`) for compile-time flow usage

## Public API

- `createActionClient(options)`
- `createFlowClient(options)`
- `createTypedFlowClient(options)` (explicit alias of `createFlowClient`)
- `createSessionClient(options)`
- `createSSEClient(options)`
- `createUserSSEClient(options)`
- `ClientHttpError`

Primary request/response and helper types are exported from `src/types/index.ts` via package root.

## Action Client vs Typed Flow Client

`createActionClient`:
- Generic runtime client.
- You provide `action` as a string at call time (`sendAction("run", input)`).
- Best for dynamic tooling, flow discovery UIs, or cases where action names are not known at compile time.

`createFlowClient` / `createTypedFlowClient`:
- Typed flow-bound client.
- You provide a flow definition once, then call `actions.<actionName>(input)` with typed inputs.
- Best for app code that has the flow definition available at compile time.

Naming note:
- `createTypedFlowClient` is provided as the explicit-name alias.
- `createFlowClient` remains supported for backwards compatibility and concise usage.

## Usage

```ts
import { createActionClient } from "@flow-state-dev/client";

const client = createActionClient({
  flowKind: "demo",
  userId: "devuser"
});

const result = await client.sendAction("run", { value: "hello" }, {
  sessionId: "sess_1"
});
```

Typed flow-bound client:

```ts
import { createTypedFlowClient } from "@flow-state-dev/client";

const flowClient = createTypedFlowClient({
  flow,
  userId: "devuser"
});

await flowClient.actions.run({ value: "hello" });
```

## Scripts

- `pnpm --filter @flow-state-dev/client build`
- `pnpm --filter @flow-state-dev/client typecheck`
- `pnpm --filter @flow-state-dev/client test`

## Notes

- `userId` is required by Phase 1 action/session contracts.
- Request stream resume supports both `Last-Event-ID` and `starting_after`.
- `starting_after` takes precedence when both are supplied.
