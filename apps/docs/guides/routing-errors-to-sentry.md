---
sidebar_position: 11
title: Routing errors to Sentry
---

# Routing errors to Sentry

Sentry is an error tracking service: it collects exceptions, groups them, and alerts you when something starts failing. This guide wires flow-state.dev block failures into Sentry using the `errorCapture` hook on `createFlowState`. The same pattern adapts to Datadog, Bugsnag, or any other service. For the full contract behind the hook, see [Error capture](/docs/advanced/error-capture).

## Install the SDK

```bash
pnpm add @sentry/node
```

Initialize Sentry once, where your app boots:

```ts
import * as Sentry from "@sentry/node";

Sentry.init({ dsn: process.env.SENTRY_DSN });
```

## Write the adapter

The adapter is a plain function. It receives an `ErrorCaptureEvent` and maps it onto Sentry's scope model: the user, low-cardinality `tags` you can search and group by, and free-form `extra` for everything else.

```ts
import * as Sentry from "@sentry/node";
import type { ErrorCaptureEvent } from "@flow-state-dev/engine";

export function captureToSentry(event: ErrorCaptureEvent): void {
  Sentry.captureException(event.error, {
    // A retryable failure may still recover, so report it as a warning.
    level: event.error.retryable ? "warning" : "error",
    user: { id: event.userId },
    tags: {
      flow: event.flowKind,
      action: event.actionName,
      block: event.blockName ?? "unknown",
      code: event.error.code ?? "unknown",
    },
    extra: {
      requestId: event.requestId,
      sessionId: event.sessionId,
      blockInstanceId: event.blockInstanceId,
      attempt: event.attempt,
    },
  });
}
```

## Wire it in

```ts title="lib/flowstate.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { captureToSentry } from "./capture-to-sentry";

export const flowstate = createFlowState({
  flows: { myFlow },
  stores: { default: { primary: inMemoryStores() } },
  errorCapture: captureToSentry,
});
```

That is the whole integration. Every runtime block failure now reaches Sentry with the failing block's name, the flow and action, and the request and user IDs.

## Test it locally

Add a flow with a block that throws, run the action, and confirm the event lands in your Sentry project's Issues view. The DevTool still shows the failure in the transcript as before; `errorCapture` runs alongside that, not instead of it.

## Filter the noise

By default rescued and retried failures fire too, because they are real failures even when the flow recovers. If you only want failures that were not retried, filter in the adapter:

```ts
export function captureToSentry(event: ErrorCaptureEvent): void {
  if (event.transient || event.error.retryable) return;
  // ...captureException as above
}
```

## Deploy

Set `SENTRY_DSN` in your platform's environment (for Vercel, the project's Environment Variables). Nothing else changes between local and production: the adapter reads the DSN at init time. Alert rules, dashboards, and retention are Sentry's domain; follow their docs once errors are flowing in.
