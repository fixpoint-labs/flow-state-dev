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

`runFlow` is that way. It is the flow-level programmatic entry point: you hand it
a flow and an action, it starts the run and gives you back a handle. One rule
governs the whole API — execution is a flow-level concern. There is no
block-level equivalent. If you want to exercise a single block, that is the job
of [`@flow-state-dev/testing`](../testing/overview.md), not `runFlow`.

## When to reach for it

- **Background jobs** — a scheduled task that runs a flow on a timer.
- **Cron handlers** — the nightly digest, the weekly rollup.
- **Queue consumers** — a worker that runs a flow per drained message.
- **Custom integrations** — code reacting to an external event that wants a flow
  run in-process, with no HTTP round-trip to your own server.

## When not to

Anything a user triggers should go through HTTP. `runFlow` does not authenticate
and it does not shape a response — it is a bare execution seam, not an endpoint.

It also inherits the same trust boundary as the HTTP layer: you supply a
*resolved* `userId` — a user identity you have already verified belongs to the
caller. `runFlow` takes that identity at face value. Verifying it is your job.
See [authentication](../server/authentication.md) for the full trust model.

## Example

```ts
import { runFlow, createFilesystemStores } from "@flow-state-dev/server";
import { digestFlow } from "./flows/digest";

const stores = createFilesystemStores({ dir: ".flow-state" });

const handle = await runFlow(digestFlow, {
  action: "run",
  input: { since: "2026-05-01" },
  userId: "user_42", // already resolved + verified by your job
  sessionId: "nightly-digest",
  onItem: (item) => console.log(item.type, item.id)
});

console.log("started", handle.requestId);
const result = await handle.finished;
if (result.error) throw result.error;
```

You already hold `stores` — they are the same registry you built to construct
your server. `runtimeConfig` is optional; without a `modelResolver` in it, a
generator block fails at run time exactly as it would through the HTTP layer.

## The handle

`runFlow` resolves as soon as the run is *dispatched*, not when it finishes. The
handle it returns has three useful parts:

- **`requestId`** — the id of the run. Correlate logs with it, or open an SSE
  stream against it later (see below).
- **`status`** — always `"in_progress"` at handoff. The run has started, not
  completed.
- **`finished`** — a promise that resolves with the terminal `ExecutionResult`
  once the action reaches a terminal state. `result.error` is set when the run
  failed.

So you have two modes. Await `handle.finished` when you care about the outcome.
Or fire-and-forget: ignore the handle and let the run proceed. The run is
durable either way — items and events persist to the `stores` you passed.

One caveat for fire-and-forget: if you never attach to `finished` and the run
fails, you get an unhandled promise rejection. Attach a `.catch` (or await) if a
failure should be observed.

Because the run persists against `requestId`, a separate HTTP server backed by
the *same* stores can stream the run live by opening its GET-stream route for
that `requestId`. The job starts the flow; a dashboard watches it.

### `onItem` mirrors the live stream

The optional `onItem` callback fires for every item as it is added, updated, and
done — the same live fan-out that feeds connected SSE clients. That includes
transient items (live-only items that are shown in real time but never
persisted). If you compare `onItem` against the persisted item log afterward,
the transient ones will be present in the former and absent from the latter,
exactly as they are for an HTTP client. Listener exceptions are isolated and
never break the run.

:::note
If you are calling `runFlow` to chain flow A's output into flow B, you probably
want a single flow with two actions instead. `runFlow` is for crossing the
no-transport boundary, not for stitching flows together in application code.
:::
