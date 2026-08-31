---
sidebar_position: 14
sidebar_label: Concurrency policies
---

# Concurrency policies

Two requests can hit the same session at once. A webhook fires twice a second apart. A user sends a second message before the first reply lands. Two browser tabs share one conversation. Without a rule, both requests resolve the session and run in parallel, racing to write the same state.

A concurrency policy decides what happens in that moment. You declare it on an action (or as a flow-wide default), and the framework arbitrates competing requests on a key you choose — by default, the session.

This is the request-arbitration sibling of [idempotency](./idempotency.md). Idempotency stops the *same* delivery from running twice. A concurrency policy arbitrates two *different* requests that collide on one key. Webhooks need both, and they compose.

## The default: `allow`

When you set nothing, the policy is `allow`: requests run concurrently, exactly as they did before this existed. Nothing changes for flows that don't opt in.

```ts
defineFlow({
  kind: "support-chat",
  actions: {
    respond: { block: respondPipeline }, // allow — runs in parallel
  },
});
```

Parallel runs are still safe from data corruption. An update computed from current state is refused and retried if someone moved the record first, and an increment or an append is applied to whatever the store holds. What that doesn't stop is one run overwriting another's value on the same field. What `allow` doesn't give you is *ordering*. Two replies to one session can interleave. That's what the other policies are for.

## Setting a policy

Set `concurrency` on an action to override the default, or `request.concurrency` to set a flow-wide default every action inherits:

```ts
defineFlow({
  kind: "support-chat",
  request: { concurrency: "queue" },                  // flow-wide default
  actions: {
    appendMessage: { block: appendPipeline, concurrency: "allow" }, // cheap — always runs
    respond:       { block: respondPipeline },                      // inherits "queue"
    syncInvoice:   { block: invoicePipeline,
                     concurrency: { policy: "reject", key: "user" } },
  },
});
```

Resolution is per-action-wins: `action.concurrency ?? flow.request.concurrency ?? "allow"`.

The policy is enforced once, at the shared dispatch seam every transport funnels through. So the same declaration governs HTTP, chat, webhooks, and MCP — you don't wire it per transport.

## The policies

There are three:

- **`allow`** — run concurrently. The default. Reach for it on cheap, append-only work where ordering doesn't matter.
- **`queue`** — serialize requests on the key in arrival order (FIFO — first in, first out). One runs to completion before the next starts. This is the answer for chat: a rapid burst of messages produces ordered, coherent replies instead of racing duplicates.
- **`reject`** — while one request holds the key, drop a competing one. The dropped caller gets a 409 that names the in-flight request it could tail instead. This is the answer for webhook double-fire: the duplicate is dropped, not queued.

```ts
respond:     { block: respondPipeline, concurrency: "queue" },
syncInvoice: { block: invoicePipeline, concurrency: "reject" },
```

Two more names — `debounce` (collapse a burst into one run) and `restart` (cancel the in-flight run) — are reserved but not implemented. Declaring either throws at definition time. See [Coming next](#coming-next).

## Keying

A policy arbitrates requests that share a *key*. By default that's the session, so two requests on one conversation contend and requests on different sessions never do. Override it with `key`:

- **`"session"`** (default) — the session id, namespaced by tenant. Resolves to no key when the request has no session.
- **`"user"`** — the user id, namespaced by tenant. One in-flight run per user across all their sessions.
- **`"none"`** — disable arbitration for this action.
- **a function** — `(ctx) => string | undefined`. Derive a custom key, e.g. a webhook delivery id pulled from `metadata`. Return `undefined` to opt this request out.

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

When the key resolves to `undefined` — no session under the `"session"` key, `"none"`, or a function that returns `undefined` — there is no arbitration and the request runs as `allow`. This is why MCP, whose calls carry no session, runs unarbitrated under the default key.

## Chat: the append-vs-respond split

Appending an inbound message to a session is cheap and should always succeed. Generating a response is the expensive, contended part. Splitting them into two actions lets each carry the policy it wants:

```ts
defineFlow({
  kind: "support-chat",
  actions: {
    appendMessage: { block: appendPipeline, concurrency: "allow" }, // every message lands
    respond:       { block: respondPipeline, concurrency: "queue" }, // replies stay ordered
  },
});
```

A rapid burst of messages all append immediately, and the `queue`d `respond` answers them in order over the accumulated history. No racing replies, no surfaced state-collision error. (Collapsing the whole burst into a single reply is what the future `debounce` policy adds.)

## Webhooks: dropping the double-fire

Providers retry, and retries arrive concurrently. A `reject` policy keyed on the session (or the delivery id) drops the duplicate while the first is still running. The webhook transport answers the dropped delivery with a benign `200 { status: "skipped" }`, so the provider stops retrying rather than treating it as a failure:

```ts
defineFlow({
  kind: "billing",
  request: { concurrency: "reject" },
  webhooks: { /* ... */ },
});
```

Over HTTP, a `reject` instead returns `409` carrying the in-flight `requestId`, so a client can tail the surviving request rather than retry blindly.

`reject` handles the *concurrent* duplicate. For a retry that arrives *after* the first finished — the same delivery redelivered minutes later — pair it with an [idempotency key](./idempotency.md). The two cover different windows.

## Messages: waiting behind the key, and never dropping one

A message sent to a session ([Messaging a session](../server/session-messages.md))
arrives as an ordinary request on the recipient, so it obeys the recipient's
policy like anything else. Two things differ, and both are worth knowing before
you set a key on a flow that receives messages.

**A queued delivery waits as long as it has to.** An ordinary queued request
gives up after thirty seconds, because a caller is holding a connection at the
other end and a stalled request is worse for them than a refused one. Nobody is
holding a connection behind a message, so it waits instead — the trade being that
deliveries pile up behind a held key and then all run in a burst when it frees.
That is deliberate: never dropping a message is the property, and a burst is what
it costs. If you have a key that is held for a long time and a sender that emits
often, you will see the burst before you see anything else.

**A busy recipient under `reject` refuses by name.** The send comes back
`recipient-busy` rather than throwing, so the sender can decide whether to try
again — which is the same shape every other messaging refusal takes.

There is also a case you cannot hit yet but will: waiting for a reply is
incompatible with a key the *sender itself* holds, because the reply can only
come from a delivery that is queued behind the sender's own request. That
combination will be refused at the moment of sending rather than discovered as a
timeout. Two ways out — send without waiting, or narrow the key so the sender and
the recipient do not share one.

## Coming next

- **`debounce`** — collapse a burst of arrivals into a single run. Safe (it never cancels a running run), deferred only to keep the first release lean. Until it ships, `queue` is the way to handle a chat burst.
- **`restart`** — cancel the in-flight run and start fresh on the newest request. Held back behind a safety contract: the runtime does not roll back state a cancelled run already committed, so cancelling mid-write can leave torn state.

## Relationship to other primitives

- **Scheduled `onOverlap`** is the scheduled-action spelling of the same idea. `onOverlap: "skip"` is `reject` keyed on the schedule id; `onOverlap: "allow"` is `allow`. See [Scheduled actions](../server/scheduled.md).
- **The state layer** decides how two concurrent writes to one record resolve: a write built on a stale read is refused and re-applied against the value that won, an increment or an append is handed to the store as the operation itself, and a plain single-field write is last-write-wins. See [State Operations](../fundamentals/state-operations.md#cas-semantics) for which calls get which. A concurrency policy sits above that: the state layer resolves a write that already happened, the policy decides whether the second run starts at all.

## Limits

This applies to the in-process dispatcher (the default), single-instance. The arbiter is a map in the running process, so it serializes requests that run in that process. If you route execution to external workers (a queue-backed dispatcher), the run happens elsewhere, so the policy isn't enforced there — cross-worker arbitration depends on a durable substrate and is future work.
