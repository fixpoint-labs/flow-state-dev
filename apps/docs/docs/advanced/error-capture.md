---
sidebar_position: 11
---

# Error capture

In production you need to know when flows fail without watching the DevTool. The `errorCapture` option on `createFlowState` is an opt-in hook that hands every runtime block failure to a callback you write. Inside that callback you forward the error to whatever observability service you run: Sentry, Datadog, Bugsnag, or your own log pipeline.

This is an error capture service integration seam. The framework defines the shape of the event and calls your callback; it does not depend on any provider SDK. You write the small adapter that maps the event onto your provider's API.

It pairs with [error handling](./error-handling.md). Error handling is about reacting to a failure inside the flow (rescue, retry, structured `FlowError`s). Error capture is about getting that failure out to an external system after the fact. They are independent: a failure that a `.rescue()` recovers still reaches `errorCapture`, so you can keep flows resilient and still see what went wrong.

## The callback

```ts
import { createFlowState } from "@flow-state-dev/engine";
import type { ErrorCaptureEvent } from "@flow-state-dev/engine";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: { default: { primary: inMemoryStores() } },
  errorCapture: (event: ErrorCaptureEvent) => {
    myErrorService.report(event.error, {
      requestId: event.requestId,
      flow: event.flowKind,
      block: event.blockName,
    });
  },
});
```

The callback is read-only. Its return value is ignored, and the runtime calls it for its side effect alone. It may be `async`. The runtime awaits it inside a guard, so if your callback throws or rejects, the error is logged at `warn` and swallowed. A broken or slow sink can never change the outcome of the request that triggered it. Keep the callback fast: hand the event to your provider's SDK (which buffers internally) and return.

`errorCapture` is distinct from `onError`. `onError` is an HTTP-level sink that receives `{ method, path }`. `errorCapture` is block-aware: it receives the failing block's identity and the flow, request, session, and user IDs.

## The event

`ErrorCaptureEvent` is provider-neutral. It carries the normalized error and the correlation IDs your service needs to group and triage; it does not carry Sentry-style tags, severity, or fingerprints. You derive those in your adapter from the fields below.

| Field | Type | Notes |
| --- | --- | --- |
| `error` | `FlowError` | Normalized error. The raw thrown value is on `error.cause`. Carries `code`, `retryable`, `details`. |
| `requestId` | `string` | The failing request. |
| `flowKind` | `string` | The flow's `kind`. |
| `actionName` | `string` | The action that was running. |
| `userId` | `string` | The caller. |
| `sessionId` | `string?` | Present for session-bound requests. |
| `orgId` | `string?` | Present when the request is org-scoped. |
| `blockName` | `string?` | The failing block (the leaf, not the enclosing sequencer). |
| `blockKind` | `"handler" \| "generator" \| "sequencer" \| "router"?` | |
| `blockInstanceId` | `string?` | Deterministic per block instance. Useful for correlating retries. |
| `blockPath` | `string?` | Structural path in the execution tree, e.g. `root/step[0]`. |
| `attempt` | `number?` | 0-indexed retry attempt, set only under a retry policy. |
| `scope` | `"block" \| "request" \| "work" \| "resource"?` | Where the error originated. |
| `transient` | `boolean?` | `true` for high-frequency transient blocks (poll loops). |

The runtime fires the callback once per failed block, identified by the leaf block where the failure actually happened. A failure deep in a nested sequencer reports the inner block, not the outer container. When a block runs under a retry policy, each failed attempt fires once, distinguished by `attempt`; a block that recovers on a later attempt still reports the attempts that failed. Filter these out in your adapter if you only want terminal failures (see below).

## Choosing which errors to capture

Because rescued and retried failures fire too, a noisy flow can produce more events than you want in your dashboard. Filter inside the callback:

```ts
errorCapture: (event) => {
  // Skip transient poll-loop failures and anything the runtime will retry.
  if (event.transient || event.error.retryable) return;
  myErrorService.report(event.error, { requestId: event.requestId });
},
```

A reasonable default is to treat `retryable: false` as an error and `retryable: true` as a warning, since a retryable failure may still recover. `event.error.code` (`"network_error"`, `"tool_execution_error"`, and so on) is a good grouping key.

## A minimal Sentry adapter

```ts
import * as Sentry from "@sentry/node";

errorCapture: (event) => {
  Sentry.captureException(event.error, {
    level: event.error.retryable ? "warning" : "error",
    user: { id: event.userId },
    tags: {
      flow: event.flowKind,
      block: event.blockName ?? "unknown",
      code: event.error.code ?? "unknown",
    },
    extra: { requestId: event.requestId, sessionId: event.sessionId },
  });
},
```

For a full walkthrough including local testing and deployment, see [Routing errors to Sentry](/guides/routing-errors-to-sentry).

## What it does not cover

`errorCapture` is for runtime block failures. It does not fire for request-level failures that happen before block execution, such as input validation or authentication. Those surface through `onError` and the HTTP response. Client-side errors are also out of scope; this is a server-side seam.
