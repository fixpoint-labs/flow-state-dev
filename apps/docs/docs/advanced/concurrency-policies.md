---
sidebar_position: 14
sidebar_label: Concurrency policies
---

# Concurrency policies

Two requests can hit the same session at once. A webhook fires twice a second apart. A user sends a second message before the first reply lands. Two browser tabs share one conversation. Without a rule, both requests resolve the session and run in parallel, racing to write the same state.

A concurrency policy decides what happens in that moment. You declare it on an action, or as a flow-wide default, and the framework arbitrates competing requests on a key you choose. By default the key is the session.

It sits next to [idempotency](./idempotency.md). Idempotency stops the *same* delivery from running twice. A concurrency policy arbitrates two *different* requests that collide on one key. Webhooks usually want both, and they compose.

## The policies

- **`allow`** runs requests concurrently. It's the default. Reach for it on cheap, append-only work where ordering doesn't matter.
- **`queue`** runs requests on the key one at a time, in arrival order (first in, first out). One finishes before the next starts. Use it for chat: a quick burst of messages gets ordered, coherent replies instead of racing duplicates. A run that waits more than 30 seconds for its turn fails with `ConcurrencyQueueTimeoutError` (status 503), which is safe to retry with backoff.
- **`reject`** drops a competing request while another one holds the key. Use it for webhook double-fire: the duplicate is dropped, not queued. How the dropped caller hears about it depends on the transport, covered [below](#webhooks-dropping-the-double-fire).

`debounce` (collapse a burst into one run) and `restart` (cancel the in-flight run) are reserved names, not implemented yet. Declaring either throws at definition time. See [Coming next](#coming-next).

### What `allow` leaves to you

Parallel runs are safe from data corruption. An update computed from current state is refused and retried if another run moved the record first, and an increment or an append is applied to whatever the store holds. What `allow` doesn't prevent is one run overwriting another's value on the same field, or two replies to one session interleaving. If ordering matters, use `queue` or `reject`.

## Setting a policy

Set `concurrency` on an action, or `request.concurrency` for a flow-wide default every action inherits:

```ts
defineFlow({
  kind: "support-chat",
  request: { concurrency: "queue" },                  // flow-wide default
  actions: {
    appendMessage: { block: appendPipeline, concurrency: "allow" }, // cheap, always runs
    respond:       { block: respondPipeline },                      // inherits "queue"
    syncInvoice:   { block: invoicePipeline,
                     concurrency: { policy: "reject", key: "user" } },
  },
});
```

The action's own setting wins: `action.concurrency ?? flow.request.concurrency ?? "allow"`. Leave both unset and every action runs as `allow`.

The same declaration governs every way a request arrives: HTTP, webhooks, schedules, MCP and dispatches from other flows. You don't wire it per transport.

## Keying

A policy arbitrates requests that share a *key*. By default that's the session, so two requests on one conversation contend and requests on different sessions never do. Override it with `key`:

- **`"session"`** (default): the session id, namespaced by tenant. Resolves to no key when the request has no session.
- **`"user"`**: the user id, namespaced by tenant. One in-flight run per user across all their sessions.
- **`"none"`**: no arbitration for this action.
- **a function**: `(ctx) => string | undefined`. Derive a custom key, such as a webhook delivery id pulled from `metadata`. Return `undefined` to opt the request out.

```ts
// One sync per user at a time, dropping duplicates.
syncInvoice: { block: invoicePipeline, concurrency: { policy: "reject", key: "user" } },

// Dedup webhook deliveries by the provider's delivery id. The webhook
// transport namespaces it under `metadata.webhook.deliveryId`.
onEvent: { block: handlePipeline, concurrency: {
  policy: "reject",
  key: (ctx) => (ctx.metadata?.webhook as { deliveryId?: string } | undefined)?.deliveryId,
} },
```

When the key resolves to `undefined`, the request runs as `allow`. That happens with no session under the `"session"` key, with `"none"`, and when a key function returns `undefined`. MCP calls carry no session, so they run unarbitrated under the default key.

## Chat: split append from respond

Appending an inbound message to a session is cheap and should always succeed. Generating a response is the expensive, contended part. Split them into two actions and each gets the policy it needs:

```ts
defineFlow({
  kind: "support-chat",
  actions: {
    appendMessage: { block: appendPipeline, concurrency: "allow" }, // every message lands
    respond:       { block: respondPipeline, concurrency: "queue" }, // replies stay ordered
  },
});
```

A burst of messages all append immediately, and the queued `respond` answers them in order over the accumulated history. No racing replies, no state-collision errors. Collapsing the whole burst into a single reply is what `debounce` will add.

## Webhooks: dropping the double-fire

Providers retry, and retries can arrive while the first delivery is still running. A `reject` policy keyed on the session, or on the delivery id, drops the duplicate:

```ts
defineFlow({
  kind: "billing",
  request: { concurrency: "reject" },
  actions: {}, // no caller-facing actions: webhooks are the only way in
  webhooks: { /* ... */ },
});
```

What the dropped caller sees depends on how it arrived:

| Transport | A rejected request gets |
|---|---|
| Webhook | `200 { status: "skipped" }`, so the provider stops retrying instead of counting a failure |
| Schedule | a skipped `200` |
| HTTP | `409` carrying the in-flight `requestId`, so a client can tail the run that won instead of retrying blindly |
| MCP | a server-busy error |

`reject` only catches a duplicate that arrives while the first is running. A redelivery minutes later, after the first finished, needs an [idempotency key](./idempotency.md).

## Across processes

Where the policy holds depends on how your server runs requests.

- **One server, no queue.** The policy is enforced in memory, in the process that runs the request.
- **A queue-backed deployment**, such as [`bullmqWorker`](/guides/background-jobs-bullmq). The policy holds across every process: the web process and each worker. Details below.
- **Several web servers, each running requests in process, with no queue between them.** Each server keeps its own keys, so two requests on one session can run at once if they land on different servers. Run that shape as a single instance, or put a queue in front of it.
- **A dispatcher you pass to `createFlowState` directly**, rather than through a `worker` adapter. It applies no policy to the work it hands off, and a [delivery into an existing session](../server/background-work.md#starting-a-job-from-a-flow) is refused with `external-dispatcher`.

### On a queue

A run takes its place on the key when it's accepted, then waits for its turn in whichever worker picks it up. Runs start in the order they were accepted. A worker never spends one of its slots waiting: a run whose turn hasn't come goes back on the queue and is checked again shortly. The 30-second wait limit is the same as on one server, and it counts only time spent waiting for the key, not time queued behind unrelated work.

A place on the key has a lease, which the worker running the job keeps renewing.

- If that worker dies, the key frees once the lease runs out (ten seconds by default), and the next run starts.
- If the worker is alive but can't reach Redis to renew, it aborts the run's signal at half the lease, and the run ends `interrupted`. A run that honours `ctx.signal` has stopped before anyone else can take the key. One that ignores it can overlap the next run.
- If Redis can't be reached when a run needs a place, the run isn't started and the caller is told why. A run never goes ahead without the policy.

Lease length, rollout order and sizing are covered in the [`@flow-state-dev/bullmq` README](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/bullmq#concurrency-across-workers).

## How it relates to other primitives

- **Scheduled `onOverlap`** is the scheduled-action spelling of the same idea. `onOverlap: "skip"` is `reject` keyed on the schedule id, and `onOverlap: "allow"` is `allow`. See [Scheduled actions](../server/scheduled.md).
- **The state layer** decides how two concurrent writes to one record resolve. A write built on a stale read is refused and re-applied against the value that won. An increment or an append is handed to the store as the operation itself. A plain single-field write is last-write-wins. See [State Operations](../fundamentals/state-operations.md#cas-semantics) for which calls get which. A concurrency policy sits above all of that: the state layer resolves a write that already happened, and the policy decides whether the second run starts at all.

## Coming next

- **`debounce`** will collapse a burst of arrivals into a single run. It never cancels a running run. Until it ships, use `queue` for chat bursts.
- **`restart`** will cancel the in-flight run and start fresh on the newest request. The runtime doesn't roll back state a cancelled run already committed, so cancelling mid-write could leave a record half-updated. It stays unavailable until that can be handled safely.
