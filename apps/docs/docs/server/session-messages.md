---
sidebar_position: 7
sidebar_label: Messaging a session
---

# Messaging a session

A background job that hits a question can only finish on a stale brief or fail.
Neither is what you want when the thing it needs is one sentence from the
conversation that started it.

Messaging closes that. A session — the record the framework keeps for one
conversation, holding its state and the history of every request that ran in it —
has an address, which is the id it already has. Any running request can send a
message to that address, and the message arrives on the recipient as an ordinary
request, visible in its history like anything else.

## The address

There is no lookup step. The sender is *given* the address: a background job
knows the session that started it, and a coordinator knows the sessions it
started. Passing that id around is how a message finds its way.

```ts
await ctx.requestHost.sendMessage({
  to: coordinatorSessionId,
  kind: "status",
  payload: { stage: "drafting", percent: 40 },
  mode: "fireAndForget"
})
```

The call resolves once the system has **accepted** the message, not once the
recipient has run it. What comes back is the delivery's own request id:

```ts
const sent = await ctx.requestHost.sendMessage({ /* … */ })
if (sent.ok) {
  console.log(sent.deliveryRequestId)  // "req_…"
} else {
  console.log(sent.refused)            // "unknown-recipient", "no-relay-door", …
}
```

A refusal is a returned value with a name on it, never a thrown error. The names
are listed at the bottom of this page.

## Declaring what a session accepts

A flow says which message kinds it handles with a `relay` group on its
definition, beside `webhooks` and `schedules`:

```ts
defineFlow({
  kind: "conductor",
  relay: {
    on: {
      status: { block: recordStatus, input: (m) => m.payload },
      question: { block: answerQuestion, input: (m) => m.payload }
    }
  },
  actions: { /* … */ }
})
```

Each binding carries its handler block inline plus an `input` mapper. `m` is the
inbound message (`{ kind, payload, from }`), and the mapper turns it into
whatever the handler takes. A binding never appears in `flow.actions`, so
declaring one does not put a new endpoint on your HTTP surface.

The mapper's result is validated against the binding's schema exactly the way a
request body would be, so a message carrying the wrong shape fails before the
handler runs.

### Falling back to a public action

If the flow declares no binding for a kind, the message can reach a public action
of that name instead, and it arrives as the bare payload, the shape that action's
own schema already describes.

A background job is not reachable by fallback and cannot reach one, in either
direction. Its declared bindings are the whole of what it exposes and the whole
of what it can reach.

A public action declared `durable` is not reachable this way, since messages
cannot suspend (see [Limits](#limits)).

If you want a background job reachable, declare a binding. There is no setting
that widens this fallback.

## What the recipient sees

The message lands in the recipient's history as a user message, so the
recipient's next generator turn can read it and act on it. If the binding
declares its own `userMessage`, that is what appears; otherwise the framework
writes the kind, the sending session, and the payload's values.

## Where the authority comes from

Who may send is decided by the server from the sending request, never from
anything written in the message. Sender identity, tenant, organization and flow
are all read off the running request; the recipient's are read off its own
session record.

The one thing the caller supplies is the **address**. It is checked, not trusted:
the recipient must belong to the same owner, the same tenant, and the same flow.
A session id that fails any of those is refused `unknown-recipient`, the same
answer a session that does not exist gets. You cannot tell the two apart.

Organization is checked on its own. A sender and a recipient bound to different
organizations, including one bound and the other not, is refused `org-mismatch`.

## Sending from a generator

Add the tool factory to a generator's `tools` and the model can send messages:

```ts
import { generator, relaySendTool } from "@flow-state-dev/core"

const coordinator = generator({
  name: "coordinator",
  model: "openai/gpt-5.4-mini",
  tools: [relaySendTool()]
})
```

A generator that does not declare it cannot see it. The tool makes the same
`sendMessage` call your code does and returns the same result, so a model reads
`refused: "unknown-recipient"` where your code reads it.

The factory sets its own timeout and retry. A flow-wide `tools.defaults.timeoutMs`
does not apply to it; your other tools keep the flow defaults.

## Limits

**Messages do not suspend.** A message handler that calls `ctx.suspend()` is
refused at that call. A message has no caller-facing entry, so it has no
caller-facing way back in, and a suspended one could never be resumed.

**Messages do not run on a queue-backed deployment.** If your dispatcher hands
work to an external queue, a send is refused `external-dispatcher`.

## Waiting for a reply

Not available yet. `mode: "waitForResponse"` is refused `mode-not-available`.

## Concurrency

A message obeys the recipient's declared [concurrency
policy](../advanced/concurrency-policies.md). Under `queue`, deliveries wait
behind the key and all run when it frees; none is dropped. Under `reject`, a send
to a busy recipient comes back `recipient-busy`.

A flow that declares no concurrency policy runs deliveries as they arrive.

## Existing sessions

Messaging needs to know what kind of session it is addressing, and a session
whose record does not say is refused rather than guessed at. One command
classifies them:

```
fsdev migrate session-kind
```

It is safe to run again, since a session it has already classified is skipped. A
session that a concurrent writer held throughout is reported by id and the
command exits `1`; run it again to resolve those.

## Refusals

| Name | What happened |
|---|---|
| `unknown-recipient` | No such session, or one under another owner, tenant or flow |
| `org-mismatch` | Sender and recipient are bound to different organizations |
| `no-relay-door` | The recipient's flow declares neither a binding nor a public action of that kind |
| `recipient-not-addressable` | One end is a background job, or one end's record does not say what kind of session it is |
| `durable-action` | The fallback landed on a public action declared `durable` |
| `recipient-busy` | The recipient's own `reject` concurrency policy |
| `external-dispatcher` | The effective dispatcher is external |
| `no-send-operation` | This process runs requests but was not set up to dispatch one, so there is nothing to send through |
| `no-durable-sender` | The sending request named no session, so nothing could ask about the delivery later |
| `mode-not-available` | `waitForResponse`, which has not shipped |
| `invalid-timeout` | A `timeoutMs` that is not a finite integer in the supported range |
