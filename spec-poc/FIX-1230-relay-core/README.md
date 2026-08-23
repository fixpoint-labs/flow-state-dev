# spec-poc/FIX-1230-relay-core — the reply half, and the key it collides on

**POC code on a never-merged branch** (`spec/FIX-1230`, epic FIX-1197). Throwaway. Please
don't review it as code — review what it showed. It dies with the PR.

The epic's POC (`spec-poc/epic-relay/` on `epic/relay`) settled the **send** half: a running
block can dispatch onto another live session (Q1), a self-addressed wait deadlocks (Q2),
delivery outlives the sender (Q3), and a finite admission budget drops an accepted delivery
(Q4). Nobody had run the **reply** half — which the epic-spec says has been specified wrong
twice, with the instruction *"do not attempt a third variant without code."* So: code.

## Run it

```
pnpm tsx spec-poc/FIX-1230-relay-core/q5-correlated-reply.ts   # ~1s
pnpm tsx spec-poc/FIX-1230-relay-core/q6-arbiter-key.ts        # ~10s
```

No server, no store, no keys, no model. `createInMemoryStores` +
`createInboundTransportHost`, one flow (`harness.ts`).

If the run dies with `FSDEV_DEFAULT_MODEL was set, but no intents are declared`, prefix with
`env -u FSDEV_DEFAULT_MODEL -u FSDEV_INTENT_CHAT -u FSDEV_INTENT_UTILITY -u FSDEV_INTENT_PLAN -u FSDEV_INTENT_REASON`.

## Scope — in-process only

`arbiter.ts:22-27` and `createInboundTransportHost.ts:299-301` skip arbitration entirely under
an external dispatcher, and both seams below are per-process maps. Everything here is the
in-process dispatcher. That is not a limitation of the experiment; it *is* the finding behind
AC 4.

## Q5 — does a reply reach the sender, and do two sends stay separate?

One request issues **two** blocking sends at once, to two different sessions. Each recipient
runs as its own request, works for 150 ms, then replies.

| | |
|---|---|
| both woke without timing out | **yes** (160 ms / 161 ms) |
| each woke on **its own** reply | **yes** — `corr_A` woke on `relay_reply_corr_A`, `corr_B` on `relay_reply_corr_B` |
| two separate recipient requests, on their own sessions | **yes** |

Two seams are hand-wired in `harness.ts`, and they are the proposal:

- **`liveReplyTargets`** — `Map<requestId, emitter>`, deliberately the same shape as the
  shipped `execution/abort-registry.ts`. A cancellation already reaches a live request from
  outside it through a map exactly like this one; a reply is the same move carrying a
  different payload.
- **`waitForCorrelated`** — the wait, built at **tool-call runtime** out of
  `ctx.response.subscribeToItems` + a timer. `waitForCondition` cannot serve this: its
  predicate is fixed when the sequencer is *defined* and the correlation id does not exist
  until the send runs. But nothing new was needed to build it — this is
  `waitForCondition`'s own engine (`core/src/blocks/sequencer.ts:2295-2385`) with a call-time
  predicate, and `ctx.response` already exposes everything it reads
  (`core/src/types/block.ts:107-146`, `:271`).

### The first run failed, and that is the sharpest thing here

The first version emitted the obvious shape — `{ type: "message", id, payload }` — onto the
waiting request's emitter. It reported **delivered, and woke nobody.**
`ResponseEmitter.emit` accepts anything with a string `type`
(`isRequestStreamDraft`, `response-emitter.ts:112-121`) and only routes
`item.added` / `item.done` / `item.updated` through item tracking (`:343-364`). Everything
else is appended as a raw stream event: never an item, so never in `getItems()`, so
`subscribeToItems` never fires. **A reply delivered that way is dropped in silence** — no
throw, no log above debug, and the sender times out looking healthy.

So the delivery target is not "the emitter" — it is an **item event on the emitter**, and the
registry must hold the engine's `ResponseEmitter` (which has `emitItemOneShot`), not the
`ResponseEmitterHandle` a block sees, which is closed at `emit` / `getItems` /
`subscribeToItems`.

## Q6 — which key should a relay delivery arbitrate on?

The epic settled that a blocking send must be **refused** when the delivery resolves to a key
the sender already holds. It did not settle **what key the delivery resolves to**, and that
decides whether the refusal leaves the blocking mode usable. Two candidates crossed with the
flow's declared key and the target — every case under `policy: "queue"`:

| case | declared | flow key | relay keying | target | keys collide | recipient ran | sender |
|---|---|---|---|---|---|---|---|
| 1 | `queue` | `user` | inherit | peer | **yes** | no | timed out |
| 2 | `queue` | `user` | pin to recipient session | peer | no | yes | woke |
| 3 | `queue` | `user` | pin to recipient session | **self** | no | **yes** | woke |
| 4 | `queue` | `session` | inherit | peer | no | yes | woke |
| 5 | `queue` | `session` | inherit | **self** | **yes** | no | timed out |
| 6 | **none** | — | inherit | peer | no | yes | woke |
| 7 | **none** | — | inherit | **self** | no | **yes** | woke |

**Predicted collision matched observed stall in every case.** The refusal needs no heuristic:
compare the key the sender's own dispatch resolved against the key the delivery resolves, and
that is the whole test.

Three things fall out that prose had not:

1. **The deadlock is a property of a shared key, not of relay.** Case 4 is an ordinary A→C
   blocking send on a `queue`-configured flow and it works today with no relay change at all.
   Case 1 is the same send under `key: "user"`. The epic's *"every blocking send deadlocks"*
   holds for `{queue, user}` specifically — and note that a flow declaring no `concurrency`
   at all normalizes to `{policy: "allow", key: "session"}` (`arbiter.ts:88-93`), where
   `gate` is a passthrough and **no key is ever held**, so nothing collides.
2. **Pinning rescues case 1 — and case 3 is the bill.** A self-addressed delivery ran
   *concurrently with the sender's own open request on the same session*, which is exactly
   what the `queue` policy exists to prevent. Pinning does not remove the collision; it moves
   relay into a different key space so the declared policy stops applying to it.
3. **A stalled delivery is not a dropped one.** Unbounded admission keeps it queued and it
   runs once the sender's request ends (epic Q3/Q4). That is why the refusal has to happen at
   **send** time: by the time the wait times out, the delivery is still coming.
4. **Cases 6 and 7 are the default configuration, and 7 is a trap.** They were added after
   the first five let a real defect through: every original case declared `policy: "queue"`,
   so the matrix never exercised what most apps actually have — no `concurrency` block at
   all. **A resolved key is not a held key.** `normalizeConfig(undefined)` returns
   `{ policy: "allow", key: "session" }` (`arbiter.ts:88-93`), so an undeclared flow still
   *resolves* a populated session key, but `gate` short-circuits on `policy === "allow"` and
   acquires **nothing** (`:164-167`). Case 7 is a self-addressed blocking send on that
   config: the naive resolved-key comparison says *collide*, and the run says **permitted** —
   recipient ran, sender woke. A refusal built on the resolved key would fire falsely on the
   common path. The row prints both (`naiveResolvedKeyCollide` vs `keysCollide`) so the
   distinction is visible rather than argued.

## What this did not test

- Anything cross-process. Both seams are per-process maps; that is AC 4's subject and issue
  2's.
- Identity derivation. Epic Q1 owns that, and `blockingSend` here reads the principal off
  `ctx` so the experiment stays about delivery.
- A real model, a real generator, or the tool surface. The sends are handler blocks; the tool
  wrapper adds no new wait behaviour, which is the only thing being measured.
