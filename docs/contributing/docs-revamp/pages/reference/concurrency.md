---
title: Concurrency policies
type: reference
description: "What a second request on the same session does: the five policies, the keys they arbitrate on, and what a refused caller sees."
---

# Concurrency policies

Two requests can hit the same session at once. A webhook fires twice a second apart. A user sends a second message before the first reply lands. Two browser tabs share one conversation. By default, both requests load the session and run in parallel, racing to write the same state.

A concurrency policy decides what happens in that moment. You declare it on an action, or as a flow-wide default, and the framework arbitrates competing requests on a key you choose. By default the key is the session. It sits next to [idempotency](./durable-execution.md): idempotency stops the same delivery from running twice, and a concurrency policy arbitrates two different requests that collide on one key. Webhooks usually want both.

## The policies

The default is `allow`.

| Policy | A second request on the key while one is running |
|---|---|
| `allow` (default) | Runs at once, beside it. Takes no place on the key. For how parallel writes resolve, see [What `allow` leaves to you](#what-allow-leaves-to-you). |
| `queue` | Waits for its turn, first in, first out, one at a time. A run that waits more than 30 seconds fails with `ConcurrencyQueueTimeoutError` (status `503`), safe to retry with backoff. |
| `reject` | Dropped while another request holds the key. Nothing is created for it. What the caller gets depends on the transport, see [Refused requests](#refused-requests). It catches a duplicate only while the first is running; a redelivery after the first finished needs an [idempotency key](./durable-execution.md). |
| `hold` | Runs at once, like `allow`, and marks the key busy while it runs. Never waits, never refused. |
| `defer` | Waits until nothing on the key is running or waiting, then runs. Deferred requests run one at a time. See [`hold` and `defer`](#hold-and-defer). |

`debounce` and `restart` are reserved names. Declaring either throws at definition time, as does an unknown name.

### What `allow` leaves to you

| Case | Result |
|---|---|
| An update computed from current state, when another run moved the record first | The write is refused and the framework retries your update against the newer record |
| An increment or an append | Applied to whatever the store holds |
| Two runs writing one field | Last write wins |
| Two replies to one session | Can interleave |

If ordering matters, use `queue` or `reject`. [State operations](./state-operations.md) lists which write calls get which behavior.

## Setting a policy

| Setting | Where | Meaning |
|---|---|---|
| `concurrency` | An action | A policy name, or `{ policy, key? }`. A bare name uses the `"session"` key. |
| `request.concurrency` | The flow | Default for every action that sets none. |
| Resolution | | `action.concurrency ?? flow.request.concurrency ?? "allow"` |
| Transports | | The same declaration governs HTTP, webhooks, schedules, MCP and dispatches from other flows. A caller cannot choose the policy. |
| `autoResume` | An action | Controls which request a reloaded client reattaches to. See [Flows and actions](./flows.md). |

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { appendMessage } from "./blocks/append-message";
import { exportTranscript } from "./blocks/export-transcript";
import { reportResult } from "./blocks/report-result";
import { respond } from "./blocks/respond";

export const supportFlow = defineFlow({
  kind: "support",
  request: { concurrency: "queue" },                                // flow-wide default
  actions: {
    appendMessage:    { block: appendMessage, concurrency: "allow" }, // every message lands
    respond:          { block: respond, concurrency: "hold" },        // a user's message
    reportResult:     { block: reportResult, concurrency: "defer" },  // a finished job's follow-up
    exportTranscript,                    // inherits "queue"
  },
});
```

`appendMessage`, `respond`, `reportResult` and `exportTranscript` are blocks, each in its own file under `src/flows/support/blocks/`. They store a message, produce the reply, post a finished job's follow-up and export the conversation.

## Keys

A policy arbitrates requests that share a key. Requests on different keys never contend.

| `key` | Resolves to |
|---|---|
| `"session"` (default) | The session id, namespaced by tenant. No session, no key. |
| `"user"` | The user id, namespaced by tenant. One policy line per user across all their sessions. |
| `"none"` | No key: no arbitration for this action. |
| `(ctx) => string \| undefined` | Your own key. `undefined` opts the request out. |

A key function receives `flowKind`, `actionName`, `sessionId?`, `userId`, `tenantId?`, `orgId?`, `source?` and `metadata?`.

When the key resolves to nothing, the request runs as `allow`. That happens with no session under `"session"`, with `"none"`, and when a key function returns `undefined`. An MCP call has a session only when its action sets `mcp.session` (a minted id per call, or one read from the call's input). Otherwise it has none and runs unarbitrated under the default key.

```ts title="src/flows/billing/flow.ts"
import { defineFlow, defineWebhookBinding } from "@flow-state-dev/core";
import { handleEvent } from "./blocks/handle-event";
import { syncInvoice } from "./blocks/sync-invoice";

export const billingFlow = defineFlow({
  kind: "billing",
  actions: {
    // One sync per user at a time; duplicates are dropped.
    syncInvoice: { block: syncInvoice, concurrency: { policy: "reject", key: "user" } },
  },
  webhooks: {
    stripe: {
      on: {
        // Dedupe deliveries on the provider's delivery id.
        "invoice.paid": defineWebhookBinding({
          block: handleEvent,
          input: (event) => event.payload,
          concurrency: {
            policy: "reject",
            key: (ctx) => (ctx.metadata?.webhook as { deliveryId?: string } | undefined)?.deliveryId,
          },
        }),
      },
    },
  },
});
```

`syncInvoice` and `handleEvent` are blocks, each in its own file under `src/flows/billing/blocks/`. They sync a user's invoice and handle a provider's webhook event. A webhook delivery takes its policy from its binding under `webhooks`, never from `actions`. The webhook transport puts the provider's delivery id at `metadata.webhook.deliveryId`.

## `hold` and `defer`

Use `hold` for a user's turn and `defer` for follow-up work that must land after it, such as the `respond` and `reportResult` actions above. What happens on one session:

| While this runs | A `hold` request | A `defer` request |
|---|---|---|
| nothing | runs at once | runs at once |
| a `hold` request | runs at once, alongside it | waits until every running `hold` has ended |
| a `defer` request | runs at once, alongside it | waits its turn |

`queue` and `reject` requests on the same key see a running `hold` too: a `queue` request waits for it, and a `reject` request is refused while it runs.

| Behavior of a deferred request | Detail |
|---|---|
| Id and stream | Its request id and stream are available at once. The stream stays open while it waits. |
| Cancel | Cancelled while waiting, it never runs. |
| Newer `hold` requests | It waits for every `hold` running on the key. It also waits for `hold` requests that start while it waits, for up to 30 seconds. After that it waits only for the `hold` requests already running, then runs. |
| Time limit | No overall limit. The wait ends when the request ahead of it finishes, throws or is cancelled. |
| Server crash | A deferred request waiting on another server starts once the crashed server's lease on the key runs out (10 seconds by default with `bullmqJobQueue`). |
| After it starts | It waits for nothing else. A message sent while it runs starts at once, beside it. |
| Cap | At most 32 `defer` requests wait on one key in each server process. The next is refused the way `reject` refuses and nothing is created for it. Retry once the session quiets down. |

## Refused requests

A `reject` request, and a `defer` request past the cap, is refused. What the caller gets:

| Transport | Result |
|---|---|
| HTTP | `409` carrying the in-flight `requestId`, so a client can tail the run that won |
| Webhook | `200 { status: "skipped" }`, so the provider stops retrying |
| Schedule | A skipped `200` |
| MCP | A server-busy error |

## Requests that pause and resume

A request that [suspends](./durable-execution.md) to wait for a user gives up its place on the key, and takes a new place like a fresh request when it resumes. Other requests on the session run while it waits.

| Policy of the action | A resumed request |
|---|---|
| `allow`, `hold` | Runs at once. `hold` marks the key busy. |
| `queue`, `reject`, `defer` | Waits as `queue` does, with its 30-second limit. Never refused or dropped. |
| The key resolves to none | Runs at once. |

| Case | Behavior |
|---|---|
| The resume call | Does not wait for the turn. The answer is recorded and the call replies at once, `202 { requestId }` or the event stream. |
| The wait for a turn fails | The limit passes, or the backend fails. The answer stays recorded and the request stays `suspended`. The lease is released and the stream closes with no events. The host logs `a continued request did not get its turn in its session; it stays parked with its resolution recorded, and the durability sweep continues it`. The sweeper continues it later. |
| `RequestHandle.abort()` (`useSession().abortRequest()` in React) while it waits for its turn | `409`. The status reads `suspended` until it starts, then `in_progress`. |

## Where a policy holds

| Deployment | Where the policy holds |
|---|---|
| One server, no queue | In memory, in the process that runs the request. |
| Queue-backed, such as [`bullmqJobQueue`](../build/background-jobs-bullmq.md) | Across every process, the web process and each one processing jobs, over the same Redis as the queue. |
| Several web servers, each running requests in process, no queue between them | Each server keeps its own keys, so two requests on one session can run at once if they land on different servers. Run that shape as a single instance, or put a queue in front of it. |
| A runner you pass to `createFlowState` directly, not through a `jobQueue` adapter | No policy is applied to the work it dispatches. A [delivery into an existing session](./background-work.md#starting-a-job-from-a-flow) is refused: the `dispatcher()` block throws `DispatchRefusedError`, and its `refused` field reads `external-flow-runner`. |

### On a queue

Order of starts, the wait limit, how a waiting run avoids holding a job slot, and what happens when a process running jobs dies or loses Redis are in [Background work](./background-work.md) and the [`@flow-state-dev/bullmq` README](https://github.com/fixpoint-labs/flow-state-dev/tree/main/packages/bullmq#concurrency-across-workers). The 32-request `defer` cap is counted in the process that accepted the request, not across the queue, and a request counts from acceptance until its job ends.

## Related settings

| Setting | Relation |
|---|---|
| `onOverlap` on a schedule | The schedule's own overlap setting, separate from the action's `concurrency`. See [Schedules](./schedules.md). |
| State writes | A concurrency policy decides whether the second run starts. [State operations](./state-operations.md) decides how two concurrent writes to one record resolve. |
