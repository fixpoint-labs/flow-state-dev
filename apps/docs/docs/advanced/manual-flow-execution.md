---
sidebar_position: 5
---

# Calling a flow without a transport

Most flows run because something came in over HTTP: a user hit an endpoint, your
Next.js route handed the request to `createFlowApiRouter`, and the runtime took
it from there. A *transport* is just that inbound edge — the thing that turns an
outside request into a flow run.

But not every flow run starts with a request. A nightly cron wants to kick off a
digest. A worker draining a queue wants to process each job through a flow. A
custom integration reacts to an external event and runs a flow in-process. This
code lives outside any transport, and it still needs a sanctioned way in.

That way is `runAction`, the same action-level entry point the HTTP layer calls
under the hood. You hand it the flow, the action, an input, a resolved `userId`,
and the stores; it runs the action to completion and returns the result. Two
options on it make it ergonomic for non-HTTP callers: an `onItem` callback to
observe items as they happen, and a `requestId` you can read back off the
result.

One rule governs the whole thing — execution is a flow-level concern. There is
no block-level equivalent. If you want to exercise a single block, that is the
job of [`@flow-state-dev/testing`](../testing/overview.md), not `runAction`.

## When to reach for it

- **Background jobs** — a scheduled task that runs a flow on a timer.
- **Cron handlers** — the nightly digest, the weekly rollup.
- **Queue consumers** — a worker that runs a flow per drained message.
- **Custom integrations** — code reacting to an external event that wants a flow
  run in-process, with no HTTP round-trip to your own server.

## When not to

Anything a user triggers should go through HTTP. `runAction` does not
authenticate and it does not shape a response — it is a bare execution seam, not
an endpoint.

It also carries the same trust boundary as the HTTP layer: you supply a
*resolved* `userId` — a user identity you have already verified belongs to the
caller. `runAction` takes that identity at face value. Verifying it is your job.
See [authentication](../server/authentication.md) for the full trust model.

## Example

```ts
import { runAction, createFilesystemStores } from "@flow-state-dev/server";
import { digestFlow } from "./flows/digest";

const stores = createFilesystemStores({
  rootDir: ".flow-state",
  developmentOnly: true
});

const result = await runAction({
  flow: digestFlow,
  actionName: "run",
  input: { since: "2026-05-01" },
  userId: "user_42", // already resolved + verified by your job
  sessionId: "nightly-digest",
  source: "manual", // recorded on the request; defaults to "http"
  stores,
  runtimeConfig: {}, // modelResolver, settings, logger, … (optional)
  onItem: (item) => console.log(item.type, item.id)
});

console.log("ran", result.requestId);
if (result.error) throw result.error;
```

You already hold `stores` — they are the same registry you built to construct
your server. `runtimeConfig` carries instance-level config (a `modelResolver`,
settings, a logger); without a `modelResolver` in it, a generator block fails at
run time exactly as it would through the HTTP layer.

## The result, and fire-and-forget

`runAction` resolves when the action reaches a terminal state. The
`ExecutionResult` it returns carries the run's `output`, the `items` it
produced, a `durationMs`, an `error` when the run failed, and the `requestId` —
the id of the run, for correlating logs or attaching a stream.

To fire-and-forget, don't await: drop the `await` and let the run proceed. The
run is durable either way — items and events persist to the `stores` you passed.
One caveat: an un-awaited run that fails produces an unhandled promise
rejection, so attach a `.catch` if a failure should be observed.

If you want the `requestId` *before* the run finishes — to attach a live stream
while it is still running — pass your own `requestId` in rather than reading it
off the result:

```ts
const requestId = crypto.randomUUID();
void runAction({ ...opts, requestId, stores }); // fire, don't await
// A separate HTTP server over the same `stores` can now stream this run by
// opening its GET-stream route for `requestId`.
```

Because the run persists against `requestId`, a separate HTTP server backed by
the *same* stores can stream it live. The job starts the flow; a dashboard
watches it.

### `onItem` mirrors the live stream

The optional `onItem` callback fires for every item as it is added, updated, and
done — the same live fan-out that feeds connected SSE clients. That includes
transient items (live-only items that are shown in real time but never
persisted). If you compare `onItem` against the persisted item log afterward,
the transient ones will be present in the former and absent from the latter,
exactly as they are for an HTTP client. Don't re-filter them. Listener
exceptions are isolated and never break the run.

:::note
If you are calling `runAction` to chain flow A's output into flow B, you
probably want a single flow with two actions instead. This path is for crossing
the no-transport boundary, not for stitching flows together in application code.
:::
