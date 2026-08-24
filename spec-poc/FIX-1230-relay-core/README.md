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
node_modules/.bin/tsc -p spec-poc/FIX-1230-relay-core          # the carrier's type check
```

**Both scripts exit nonzero when a verdict condition is false.** They did not for ten review
rounds — they printed `false` and exited `0`, while the spec cited them as CONFIRMED evidence
the whole time, so anything checking status rather than reading output would have taken a
refuted experiment for a confirmed one. Verified in the direction that matters:

| broken on purpose | result |
|---|---|
| Q5's carrier stamped `history: true` | exit **1**, `replyIsAbsentFromReconstructedLLMHistory` named |
| Q6's rule using the *resolved* key instead of the *held* one | exit **1**, two conditions named, including the case-7 trap |
| Q6's case-2 pin replaced by `inherit` (the rescue removed) | exit **1**, `pinning rescues key:user` named — **which it was not, until the observation sinks were isolated** |
| Q5's carrier stamped `client: true` (the defect a reviewer found here) | exit **1**, `replyIsAbsentFromClientProjection` named |
| all restored | exit **0** |

The second row is the round-5 defect itself: had the scripts asserted from the start, that
bug would have exited nonzero rather than being caught three rounds later by reading.

**The third row is a later defect, and it is the worse kind.** Q6 boots a fresh host per case
but kept ONE module-global `received` array, cleared at the top of each case and read at the
bottom. Cases 1 and 5 deliberately time out and leave their delivery **queued**; it runs once
the sender releases the key, and the measured margin is that it lands **~4 ms INSIDE the next
case's window**. A late push can only move a count up, so the only value it could fabricate
is `recipientRanWhileSenderWaited: true` — the reading that means "no deadlock", which is the
outcome the pin candidate wanted. **The error ran in the direction of confirming the thing
the POC was built to test.**

The matrix below survived it: both polluted cells (2 and 6) were `true` on their own merits,
and re-running with per-host sinks reproduces every cell exactly. But *"the answer was right"*
is not *"the check worked"* — with the pin deliberately removed, the old shared array still
reported the rescue as working (row 3 above). That condition was **unfalsifiable**.

**This is the SECOND verdict condition on this POC that could not fail, and two is a
pattern.** The first was `concludeOrFail` itself: for ten rounds every condition printed
`false` and exited `0`, so the whole verdict was unfalsifiable at the process level. This one
is narrower and nastier — the assertion machinery works, and a single condition was reading a
number that another case could write. Both were found by a reviewer, neither by a run. The
rule they point at, and the one worth carrying past this throwaway: **every verdict condition
ships with the sabotage that makes it fail.** Not a re-read, not an argument — the deleted
field, the removed pin, the flipped stamp, exercised and recorded. The table at the top of
this file is that record for these three; it exists because the two defects above are what
happens without it.

**And a THIRD challenge to the same value, which is the one that matters most.** Isolating the
sinks fixed the *cross-case* leak; it did nothing about a *within-case* ordering problem.
`obs.received` was read only after `fromOutside()` awaited the sender's completion — but in a
collision case the queued recipient is released **by that same request ending**, so promise
scheduling decided whether its push landed before or after the read. A recipient stalled for
the entire wait could still be counted as having run during it, and again the error could only
ever produce `true`.

**Measured, because "it agrees today" is not an answer.** The reading is now an ordering
comparison against a `waitEndedAt` stamp captured *inside* the request while it still holds its
key, and both readings are printed side by side. Across 20 stress runs of the two collision
cases: **0 disagreements, and no cell moved.** The reason they agreed is worth writing down —
the queued release lands **2.9–7.2 ms after the wait ends** (median 4.11). Milliseconds, not
structure: a GC pause between the `await` resolving and the read would have inverted it. Three
rounds, three challenges, one value — the pattern is that *"did X happen while Y was true"* was
being answered by looking at a variable afterwards instead of by comparing two timestamps.

Each host now owns its sink
(`Observations` in `harness.ts`), so the leak is unrepresentable rather than unlikely, and
`q6-arbiter-key.ts` prints a replay of what the shared array *would* have reported so the
contamination stays visible rather than becoming folklore.

```
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

### The reply carrier took four attempts, and only the compiler ended it

Worth reading `reply-item.ts` for the sequence, because the shape of the mistake matters
more than any one instance. Four times this item was written as a hand-shaped object
literal; four times it was invalid; **four times it passed at runtime.** `response.emit`
takes `unknown` and `isOutputItem` (`response-emitter.ts:142-151`) checks `id`, `type` and
`itemIndex` — a guard strictly shallower than the type it guards.

The carrier now lives in its own file, annotated `MessageItem`, and is type-checked. Deleting
a required field fails with *"Property 'ts' is missing … but required in type
`OutputItemBase`"*, which is how the check was **verified able to fire** rather than merely
reported green — the first version of that check resolved the import to `any` and reported
clean while catching nothing (tenet 7).

`itemVisibility: { client: false, history: false }` on it is load-bearing on **both** axes,
not tidiness — and this file previously said `client: true`, which was the contract's opposite.
A reviewer caught it: the POC is the executable evidence, the README called the wrong setting
load-bearing, and an implementer following the runnable artifact would have shipped a client
projection carrying an internal correlation envelope. Fixed on both, and the assertion below is
now on the **absence from the client projection** rather than on the flag — the flag is the
mechanism, the absence is the promise.
`message` is a conversational type, so an unstamped carrier resolves to `history: true`
(`contracts/src/items/resolve-visibility.ts:43-45`) and the serialized correlation envelope
is replayed into a later generator turn **as a fake user utterance** — the sender reading its
own answer twice, once as the tool result it awaited and once as invented history. Q5 asserts
this against the real reconstruction (`itemToLLMMessages`), and that assertion was also
checked by flipping the stamp: `history: true` yields 2 reconstructed messages, `false`
yields 0.

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
