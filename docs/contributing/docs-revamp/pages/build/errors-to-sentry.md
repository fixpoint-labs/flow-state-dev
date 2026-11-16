---
title: Send errors to Sentry
type: recipe
description: "Sentry is an error tracking service: it collects exceptions, groups them, and alerts you when something starts failing."
---

# Send errors to Sentry

Sentry is an error tracking service: it collects exceptions, groups them, and alerts you when something starts failing. This guide wires flow-state.dev block failures into Sentry using the `errorCapture` hook on `createFlowState`. The same pattern adapts to Datadog, Bugsnag, or any other service. For the full contract behind the hook, see [Errors](../reference/errors.md).

## Install the SDK

```bash
pnpm add @sentry/node
```

## Write the adapter

The adapter is a plain function. It receives an `ErrorCaptureEvent` and maps it onto Sentry's scope model: the user, low-cardinality `tags` you can search and group by, and free-form `extra` for everything else.

```ts title="src/lib/capture-to-sentry.ts"
import * as Sentry from "@sentry/node";
import type { ErrorCaptureEvent } from "@flow-state-dev/engine";

export function captureToSentry(event: ErrorCaptureEvent): void {
  // Skip the request summary event: this adapter reports each block failure.
  // See the errors reference for why.
  if (event.final) return;
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

Which field goes where:

- `requestId` finds the run. Every event from one request shares it, the block events and the `final`, and it is the id the DevTool and `fsdev run` show. Search Sentry for it, then open that request in the DevTool.
- `userId` is the caller, sent as Sentry `user: { id }`. It is whatever your app's auth resolved, not necessarily an email or a name.
- `sessionId` (missing when the request has no session) and `blockInstanceId` (`${requestId}:${blockPath}`, the same for every attempt of one block) go in `extra`.
- Low-cardinality values (flow, action, block, `code`) go in `tags`. Sentry's own docs govern how tags and `extra` behave.

## Wire it in

Initialize Sentry once and pass the adapter as `errorCapture`, in the same `fsdev.config.ts` that creates the server. `./src/flows/support/flow` is your own flow module: any `defineFlow` result works, such as the `support` flow in [When something fails](../concepts/when-something-fails.md).

```ts title="fsdev.config.ts"
import * as Sentry from "@sentry/node";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";
import { captureToSentry } from "./src/lib/capture-to-sentry";

Sentry.init({ dsn: process.env.SENTRY_DSN });

export default createFlowState({
  flows: [support],
  stores: sqliteStores({ filename: "support.db" }),
  errorCapture: captureToSentry,
});
```

Every runtime block failure reaches Sentry with the failing block's name, the flow and action, and the request and user IDs. The request does not wait for your callback and ignores its return value. If Sentry is unreachable or `captureToSentry` throws, the error is caught and logged at `warn`, the request is unaffected, and the DevTool and the stream show the failure. One catch: on a host that freezes the function after the response, such as Vercel, a callback that is mid-send at that point is lost, so flush Sentry in your own deploy.

## Test it locally

Run a flow with a block that throws, then confirm the event lands in your Sentry project's Issues view. The failure also shows up in the run's transcript in the DevTool, the browser inspector `fsdev dev` opens. The check needs the config: with no `fsdev.config.ts`, `fsdev dev` does not call your hook.

## Filter the noise

Failures the flow recovers from reach the hook too: ones a rescue handled and ones a retry later fixed. Each retried attempt fires its own event. The [errors reference](../reference/errors.md) says what the `transient`, `error.retryable` and `attempt` fields mean.

To drop events from high-frequency poll-loop blocks, add `if (event.transient) return;` at the top of `captureToSentry`.

To get one Sentry event per request that ended failed, change the first check to `if (!event.final) return;`. A request a rescue or retry saved sends no such event. The [errors reference](../reference/errors.md) describes the `final` event.

## Deploy

Set `SENTRY_DSN` in your platform's environment (for Vercel, the project's Environment Variables). Nothing else changes between local and production: `Sentry.init` reads the DSN when the server starts. Alert rules, dashboards, and retention are Sentry's domain; follow their docs once errors are flowing in.
