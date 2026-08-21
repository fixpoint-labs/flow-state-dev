# spec-poc/epic-relay — the three things the epic asserted from a code read

**POC code on a never-merged branch** (`epic/relay`, epic FIX-1197, PR #1357). Throwaway.
Please don't review it as code — review what it showed. It dies with the PR.

The epic's size claim ("five issues, not a subsystem") rests on *routing, queueing,
arbitration and session resolution all already exist; only the address, the send verb and
per-adapter delivery are missing.* That was established by reading. These scripts run it.

## Run it

```
pnpm tsx spec-poc/epic-relay/q1-inside-out-dispatch.ts       # instant
pnpm tsx spec-poc/epic-relay/q2-self-addressed-deadlock.ts   # ~35s, on purpose
pnpm tsx spec-poc/epic-relay/q3-delivery-outlives-sender.ts  # ~10s
```

No server, no store, no keys. `createInMemoryStores` + `createInboundTransportHost`, one
flow (`harness.ts`) with five actions: `seed`, `send`, `receive`, `busy`, `inspect`.

If the run dies with `FSDEV_DEFAULT_MODEL was set, but no intents are declared`, your shell
has FSDEV intent env vars set; prefix with
`env -u FSDEV_DEFAULT_MODEL -u FSDEV_INTENT_CHAT -u FSDEV_INTENT_UTILITY -u FSDEV_INTENT_PLAN -u FSDEV_INTENT_REASON`.

## Scope — in-process only

`arbiter.ts:22-27` and `createInboundTransportHost.ts:299-301` skip arbitration **entirely**
when an external dispatcher is configured. Everything below is the in-process dispatcher.
Nothing here says anything about the durable/queue-backed path, which is §5 Q3's territory
and FIX-830's.

## Q1 — inside-out dispatch onto an existing session

Three cases, because the interesting axis turned out not to be inside-vs-outside:

| | sender | recipient | envelope principal | outcome |
|---|---|---|---|---|
| 1 | `sess_sender` (user_a) | `sess_peer_same_user` (user_a) | `user_a` | **ran** |
| 2 | `sess_sender` (user_a) | `sess_peer_other_user` (user_b) | `user_a` | **refused** — `UserBindingMismatchError` |
| 3 | `sess_sender` (user_a) | `sess_peer_other_user` (user_b) | `user_b` | **ran, as user_b** |

Case 1 is the tracer bullet and it works. The second request completed, landed a request
record on the *recipient's* session (`userId: user_a`, `action: receive`), and its message is
in the recipient's `ctx.session.items.all()`. The sender's own session has no message items —
the two histories stay separate.

Cases 2 and 3 are the identity answer. The principal on the envelope is **caller-supplied and
unchecked at the seam**. What catches case 2 is `createExecutionContext.ts:631` — a
*consistency* check between the envelope's `userId` and the session record's owner, not an
authority check. Name the owner and it passes: case 3 ran a request as `user_b`, on `user_b`'s
session, from a block executing in `user_a`'s. `startDetached` doesn't have this exposure
because it closes over identity and takes no session id; a `dispatch`-shaped send verb does.

The second half of that is a constraint the epic-spec doesn't record: with an honestly-derived
principal, **a session can only be addressed by its own owner**. Cross-user sends are refused
by an existing invariant.

### The `ctx` gap — what the block had to reach for

This list is the shape of the send verb, and it is short:

1. **`host.dispatch` itself.** Not on `BlockContext` in any form. `harness.ts` reaches it
   through a module-level variable, which is the whole hack. `ctx.requestHost` is closed at
   four verbs, none of which takes a session id — and on this host it was `undefined`.
2. **`flowKind`.** `ctx` does not name the recipient's flow, or even its own.
3. **`source`.** `InboundSource` is stamped by adapters and there is no inside-world value; the
   POC lies and says `"http"`.
4. **A server-derived principal.** `ctx.session.identity.userId` exists, so the *sender's*
   identity is recoverable — the gap is that nothing forces the verb to use it.

Everything else the envelope wanted — `sessionId`, `orgId`, `tenantId` — reads off
`ctx.session.identity`.

## Q2 — the self-addressed deadlock

Under `request: { concurrency: "queue" }`, one request dispatching onto its own session and
awaiting the result:

```
wallClockMs: 30016
awaitThrew: ConcurrencyQueueTimeoutError: Timed out after 30000ms waiting for
            concurrency key "sess_talks_to_itself" to free up.
```

Confirmed: **it does not hang.** It stalls for the full `QUEUE_WAIT_TIMEOUT_MS`
(`arbiter.ts:40`) and then the queue waiter gives up.

The shape of the failure is worse than the error name suggests, and is the argument for
refusing at definition or dispatch time rather than documenting it:

- 30 seconds of dead time on a live session.
- The recipient request is materialized at enqueue time and left **`failed`** in the store —
  a request on the session's own history that never ran.
- The **sender reports `completed`**. The timeout surfaces inside the sending block; nothing
  propagates it upward by default.

The control run confirms theme 7's other half: self-addressed **fire-and-forget** works. It
queues behind the sender and runs to completion the moment the sender returns.

## Q3 — does a queued delivery outlive the SENDER's request?

Fire-and-forget's entire value rests on "delivery is attached to the process, not to the
originating web request". Nobody had run it. If it were false, delivery would need an owner
other than the sending request — a real scope change to issue 2.

Shape: `sess_busy_recipient` is held mid-run for 4s under `concurrency: "queue"`; a
*different* session dispatches `receive` onto it fire-and-forget and returns without
awaiting; the sender's own request is verified terminal in the store; then the recipient's
records are polled.

```
sender's request:   status completed, wallClockMs 4
                    acceptedPresent true, acceptedAfterMs 0
recipient after:    receive → completed   (polledForMs 3807)
                    busy    → completed
handler actually ran: { sessionId: sess_busy_recipient, from: sess_sender }
VERDICT: CONFIRMED
```

**CONFIRMED.** The queued `receive` ran to completion after the sender was terminal, and the
recipient's handler really executed — the message is on the recipient's session, not merely a
row in the store.

The second reading is the one the amended theme 6 needed: `handle.accepted` settled at **0ms**,
*while the run was still sitting behind the busy recipient's concurrency key*. That is the doc
comment's "In-process, `queue` policy … the run itself is still waiting behind its concurrency
key" (`packages/engine/src/transports/types.ts:186-227`) observed rather than inferred, and it
is what makes acceptance usable as the acknowledgement on both send modes. `acceptedPresent`
was `true`, which the type does not guarantee — `readonly accepted?:` is optional because a
custom dispatcher may not distinguish acceptance from completion.

**Not tested:** a recipient busy longer than `QUEUE_WAIT_TIMEOUT_MS` (30s, `arbiter.ts:40`).
The 4s window sits comfortably inside the admission budget, so this says nothing about whether
a queued delivery survives a *long*-busy recipient. That is theme 14's open edge.
