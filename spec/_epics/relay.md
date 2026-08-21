# Epic — Relay: an internal message layer, and the cron changes that ride on it

> **Coordination artifact, not an implementing spec.** The issues under this epic do **not**
> derive from this doc — they *reference and align* to it, and each still writes (or skips)
> its own spec. See [`docs/contributing/orchestration.md`](../../docs/contributing/orchestration.md)
> → "The epic-spec".
>
> **Epic issue:** FIX-1197 · **Branch:** `epic/relay` (never merged, never deleted) ·
> **Epic PR:** [#1357](https://github.com/fixpoint-labs/flow-state-dev/pull/1357) ·
> **Project:** Orchestration Primitives · **Team:** FIX

---

## 1. Purpose & objective *(the `epic approved` sign-off surface)*

**The problem, in plain terms. A session, once it is running, is a dead end — nothing in the
system can reach it.** FSD can start a session, and it can start a detached child of one, but
there is no way back in to one that already exists. So a workstream that hits a question has
nowhere to put it — it finishes or it fails. A schedule that fires can only begin something
new. Those are the same hole seen from two sides, which is why cron is inside this epic rather
than beside it.

**Objective. Make an existing session reachable from inside the system.** A background
workstream can raise a question without ending. A coordinator can steer a workstream that is
already running. Two top-level sessions can keep each other informed. A schedule can fire onto
a named session instead of only ever starting a new one.

The consumer is **Conductor**, a meta-harness driving coding-agent runs across many sessions.
One known, committed consumer is what keeps this from being speculative surface (tenet 3).

**What sign-off certifies.** The objective and the grouping — that cron rides on this layer
rather than keeping a transport of its own, and that a spawn verb and a send verb are the same
missing layer. It certifies **no** issue's contracts: the verb's name and the config surface it
hangs off are open (§5), and the five-issue division in §4 is a proposal. **The gate is the last
cheap moment to redraw the set** — after it, redrawing costs specs already written.

**What the address *is* is settled; what a sender may address is not.** The owner has stated it:
**a recipient is a `sessionId`**, and a sender is identified by its own `sessionId` — possibly
carrying the `requestId` of the sending request as well (open, §5 Q1b). Messages never travel
from one user to another. What remains the load-bearing fork is the **door** — whether a sender
resolves `flow.actions` or a narrower author-declared inside-world surface (§5 Q1). That question
is untouched by the address being named, and it is what the objective gate is asking about.

**Where this lands against the project objective.** [`docs/objectives.md`](../../docs/objectives.md)
measures *goals passing over goals defined*. A grep across `goals/**` finds **no goal covering
scheduled dispatch and none covering concurrency arbitration** — zero `goal.md` hits for `cron`
or `schedule`, and the four that mention concurrency cover resource patching and task-board
settlement, not dispatch. (Nearest neighbours: `durable-claim-safety`, `task-board`,
`harness-workstream`, `webhook-transport`.) The epic lands in that blank spot and is expected to
add four goals: a session messages another session and the recipient acts; a workstream parks on
a question, its request ends, a later message resumes the task; a schedule with **no** address
still starts a new session per run — the preserved-behaviour check; a schedule **with** an
address fires as a new request on that session.

**Holistic necessity — five issues or four?** The cut candidate is issue 5, the `pending
feedback` task status: a task-board addition, not a messaging one. It stays because theme 5 —
the reply arrives as a new inbound message, nothing suspends — only works if a task can be
*parked* while its request ends. Without it a workstream that asks either holds a loop open or
loses its place, and the headline case does not land. It also depends on nothing, so carrying it
costs the set no sequencing.

Issue 3, the sibling-spawn verb, is second-weakest: a second verb in an epic whose point is a
first one. It stays because it is the same missing layer — same addressing, same per-adapter
delivery — so building it later means touching both again. **Tripwire:** if it grows a delivery
path of its own, it should have been its own epic and should be pulled out rather than absorbed.

**Deliberately not doing** — named, not silent:

- **Fan-out. Ruled out, not deferred.** A request runs in a session, and nothing is processed
  without one, so an unaddressed message has nowhere to run. Delivering to every interested
  party would mean inventing a session per subscriber — *spawning work* wearing delivery's name.
  Even "a fresh session" is a named recipient. FIX-441's `NotificationFlow` subscriber shape is
  exactly this (§4).
- **Session discovery.** Which sessions exist and what each is working on is consumer-owned
  domain state — a resource collection each coordinator writes, read into a role's context
  through a formatter. No framework session registry (tenet 4).
- **Widening `livenessOf`**, which answers only for the caller's own lineage by design (theme 10),
  and **cross-session progress polling**, which is a later mechanism and not a small addition
  (theme 10).
- **A new queueing mechanism** — the concurrency policy already arbitrates on the session key.
  Still true, and **making its admission budget configurable is not one** (theme 14): it is a
  parameter on the arbiter that exists, and the unbounded case already works in the shipped gate.
  (Delivery receipt is **no longer** on this list: acceptance already exists in shipped code and
  every send awaits it — theme 6, amended.)
- **Cross-user messaging. Not a scope cut — a design invariant.** The owner's wording is
  categorical: *"we are never sending from one user to another."* This is not "same-owner in v1"
  with a later widening implied; messaging is **within one owner, by construction**, and there is
  no open decision behind it. The objective's "two top-level sessions keep each other informed"
  means two sessions with the **same owner**, always.

  Two consequences, both of which make the epic *smaller*:

  - **`UserBindingMismatchError` is a guard against a bug, not a boundary the design leans on.**
    `packages/engine/src/context/createExecutionContext.ts:631` throws when the envelope's
    `userId` differs from the session record's owner, and the POC ran it (§3). A correctly-built
    sender never exercises that path — the principal is the same on both ends by construction. It
    stays as a backstop for an incorrectly-built one.
  - **The epic does not have to solve cross-user authorization at all.** It was never in the five
    issues; it is now a **stated non-goal** rather than an unexamined gap. No issue owes a design
    for it, and no reviewer should read its absence as an omission.

**Named risk: arbitration is in-process only, and this epic does not fix it.** The host skips
arbitration entirely when an external dispatcher is configured, deferring it to the durable
substrate (FIX-830); in-process, the gate is a per-process map and a queued waiter gives up
after 30 seconds. So "arbitration already exists" is **true in-process and false on the durable
path**. For a busy recipient that means two messages can run against one session at once on a
queue-backed deployment. Evidence and the options are §5 Q3; nothing is promised here.

**The in-process half of that risk is no longer a risk to accept — it is scope.** §3's Q4 ran it:
a delivery **accepted at 0 ms** is **dropped at 30 001 ms** when the recipient stays busy past the
arbiter's hardcoded budget, with the sender long since returned and reading `completed`. A
receipt that can be followed by a silent loss is worse than no receipt, so **a configurable
admission budget is in scope** — issue 2 (§4), theme 14. It is small: `Infinity`/omitted already
disables the timeout in the shipped gate, and Q4 ran the same scenario through it and the
delivery landed. Nothing about the *durable* path changes; that stays FIX-830's.

---

## 2. Themes & long-horizon direction

Cross-cutting decisions only — each constrains more than one issue. Numbered so an issue spec
can cite one.

1. **Build to the `FlowDispatcher` seam, never to BullMQ specifics.** FIX-830 (In Spec Review)
   is scoping a BullMQ sunset; its comment of 2026-06-17 notes that option (B), a plain Postgres
   queue, "already captures the 'drop Redis / one datastore' simplification that motivates moving
   off BullMQ." Both surviving options are Postgres — the seam survives, the implementation is
   the removal candidate. Durability therefore comes from whatever dispatcher is deployed, at no
   BullMQ-specific cost. **Constrains issue 2:** nothing in this epic imports or branches on
   BullMQ.

2. **One dispatch seam already exists; nothing here adds a second.** `host.dispatch`
   (`packages/engine/src/transports/host/createInboundTransportHost.ts:268`) is where every
   transport already funnels — HTTP (`engine/src/routes/action-routes.ts:171`), webhooks
   (`engine/src/transports/webhook/routes.ts:214`), scheduled (`packages/scheduled/src/routes.ts:205`),
   chat-sdk (`packages/chat-sdk/src/event-handlers.ts:393`), MCP
   (`packages/mcp/src/createMcpTransportAdapter.ts:410`), and `startDetached`
   (`engine/src/context/detached-start-operation.ts:135`). `packages/node`, `packages/vercel` and
   `packages/next` are not callers; `packages/bullmq` sits *below* the seam as a `FlowDispatcher`.
   The envelopes are `InboundRequestEnvelope` (`engine/src/transports/types.ts:68-172`, with
   `sessionId?` already at `:78`) and `DispatchEnvelope` (`engine/src/transports/dispatcher.ts:16-35`).
   **Constrains issues 1, 2 and 4:** the address goes on the envelope that exists and delivery
   goes through the seam that exists. An issue adding a parallel dispatch path has left the
   epic's shape. **The address on that envelope is a `sessionId`** (theme 9) — the field the
   envelope already carries at `:78`, not a new coordinate type.

   **`startDetached` is not that verb, and cannot be made into it.** It derives the child key
   from `[principal, parent session, seed]`; the child "inherits tenant, user, org and flow kind
   from the running request and records it as its parent"; and "there is no flow or action
   parameter, so `flow.actions` is not reachable." Each clause independently rules out a sibling,
   which has its own flow kind, is nobody's child, and resolves `flow.actions` like any other
   caller. The last clause is also why messaging cannot be built on it.

3. **A flow is already a mailroom; this adds a sender, not a routing model.** Actions are message
   types and the flow routes each to its workflow. Three senders are wired today — a person, a
   caller or tool-call, an external system's webhook — and this adds a fourth, internal one. What
   changes is *who may put a message through the door*, not how it is routed once inside.
   `FlowDefinition` already carries per-sender config surfaces beside `actions` (`mcp?`, `chat?`,
   `webhooks?`, `schedules?`, plus the derived `workstream?` and `workstreamBindings?`), so an
   inside-world surface would be a **sibling of an existing pattern**, not a novel concept.
   *Which* door it is remains §5 Q1.

4. **Cron becomes a sender, not a transport of its own.** A schedule fires, sends a message to an
   addressed session, and the bus routes it. One optional session address on the schedule row
   serves both cases: **absent means a new session per run — today's behaviour, preserved
   exactly**, which is a requirement rather than a nicety; present means each run is a new request
   on that session. The session-less dispatch path goes away. This is the decision that puts cron
   inside the epic instead of beside it, which is why it is a theme and not issue 4's business.

   **The change surface is one envelope** — correcting a description repeated in several places.
   `packages/scheduled/src/routes.ts` has exactly **one** dispatch site (`:205`), and its envelope
   (`:175-201`) *omits* `sessionId` rather than setting it to `undefined`. The two literal
   `sessionId: undefined` occurrences are at `:66` (gateway-auth principal resolution) and `:269`
   (the list handler); neither dispatches. The comment "scheduled envelopes have no session" sits
   at `:208-210`, inside the `ConcurrencyRejectedError` catch. Dynamic schedules carry a **user**,
   not a session (`defineScheduleCollection.ts:36-44`, collection force-scoped `"user"` at `:75`;
   `createResourceCollectionScheduleResolver.ts:56-65,109` synthesizes `principal: { userId }`),
   so the address is a new field on that row and not a repurposed one.

5. **The reply arrives as a new inbound message; nothing suspends across a human's answer.** A
   workstream that asks does not hold a suspension open. It ends its request carrying its
   question, and the answer re-enters as fresh work. That routes around FIX-765 (suspension inside
   detached durable execution) entirely for the workstream case. A **top-level** session may still
   block, using the existing durable suspend/resume. **One author-facing verb, two
   implementations** — documented as one verb rather than shipped as two. **Constrains issues 1
   and 5**, and issue 5 is what makes the workstream half representable at all. Because the
   answer is a *new* message rather than the sender's handle resolving, something has to
   correlate it with the question that was asked — theme 6, and §5 Q1b.

6. **Two send modes, not three — and acceptance is the acknowledgement on both.** *(Amended by
   the owner. Still two modes; what changed is that the receipt is not a third one.)*
   Fire-and-forget and wait-for-response are genuinely different intents and both are needed.
   **Every send awaits acceptance before returning.** Fire-and-forget returns there;
   wait-for-response carries on and waits for the answer (theme 14).

   **What correlates an answer with the question it answers is not yet named — and
   wait-for-response does not work without it.** *(Epic review, round 2.)* The mode is
   specified; the identifier is not. It has to be carried on the message and echoed on the
   reply, or a sender with more than one ask outstanding cannot tell which one a message
   answers — or that it is an answer at all. **§5 Q1b, the sending `requestId` on the sender's
   identity, is the leading candidate**, and this is a second, independent argument for it: Q1b
   was justified only by reply-routing granularity and §3 Q4's discoverability gap, which made
   it a convenience. A send mode that does not function without it makes it load-bearing.
   **Q1b stays open** — the owner hedged, and the field is issue 1's spec to settle. What is
   settled here is that wait-for-response owes an answer to it.

   **The reply is a new inbound message, not a resolution of the sender's handle.** Stated
   plainly because the opposite reading is easy to reach for: on the workstream path the answer
   re-enters as fresh inbound work (theme 5), so `DispatchHandle.finished` resolves *the
   recipient's handling of the message that was sent* — a different event from *the answer
   arriving*. Nothing in this epic awaits `finished` for an answer, and a design that did would
   be waiting on the wrong event.

   **The receipt already exists in shipped code** — `DispatchHandle.accepted`,
   `packages/engine/src/transports/types.ts:186-227`. Its doc comment is unusually explicit, so
   it is quoted rather than paraphrased:

   > Resolves once the request has been *accepted* — discoverable, with nothing left that could
   > make it silently not exist. It does not wait for execution to finish, and it rejects when
   > acceptance fails, so a caller that acks on it never acks a request that never runs.

   Under the in-process `queue` policy that is exactly "accepted, queued, keep waiting":

   > **In-process, `queue` policy** (FIX-999): the same enqueue-time writes. The run itself is
   > still waiting behind its concurrency key.

   Acceptance resolves once the `activeRequests` entry and the `in_progress` record have
   committed — the request is discoverable — **while the message is still sitting behind a busy
   recipient's session key**. §3's Q3 run measured it: acceptance settled in **0 ms** while the
   recipient was mid-run, and the delivery was admitted ~3.8 s later.

   **It is deliberately self-limiting, and the verb must not over-promise on it:**

   > **Acceptance is discoverability, not safety, and it is not trying to be.** Setup continues
   > after it and can still fail without recording anything.

   > What acceptance buys is therefore *visibility*, not safety: a fire-and-forget caller holds
   > no `finished`, so without this a registration failure is silent and the row waits out its
   > lease with nothing anywhere saying why.

   And what actually catches a dead recipient is not the receipt:

   > What protects a caller that handed over durable work is that work's own lease: if the run
   > dies at any point — during setup, mid-execution, or by the process going away — the lease
   > lapses and the owner recovers the row. That is the designed recovery path for every way a
   > child can die, and no dispatch milestone improves on it.

   **And it is more self-limiting than its own doc comment says.** "A caller that acks on it
   never acks a request that never runs" is quoted above because it is what the code claims;
   §3's **Q4** falsified it on the in-process `queue` path. A delivery accepted at **0 ms** was
   dropped at **30 001 ms** when the recipient stayed busy past the arbiter's admission budget,
   and nothing told the sender. So acceptance means *the recipient's queue took it*, never *it
   will run* — which is why theme 14 now puts that budget in scope rather than leaving the
   receipt to carry a guarantee it does not have.

   **The verb has to tolerate acceptance being absent.** It is `readonly accepted?:` — optional
   "because a custom dispatcher may not distinguish acceptance from completion. Every dispatcher
   this package ships does." A send running against a custom dispatcher gets no ack and must
   degrade rather than fail.

   **Why the earlier reasoning is superseded.** This theme previously excluded delivery receipt
   on the grounds that it answers *did it arrive*, and a durable row already answers that. The
   row does answer that. A receipt is answering a different question — ***am I right to still be
   waiting*** — which the row cannot answer, and that is the question that licenses a long
   sender-side timeout (theme 14).

   **Constrains issues 1 and 2.**

7. **Make the self-addressed deadlock unrepresentable, not documented.** Self-addressed plus
   wait-for-response must be **refused at definition or dispatch time**. Under `queue`
   (`packages/core/src/types/concurrency.ts:33`) one request runs to completion before the next
   starts, so a sender awaiting its own message never lets it start. Fire-and-forget to self is
   fine, and is the mechanism behind "the same session as a new request". **Constrains issue 1**;
   issue 4 inherits the refusal, since a schedule addressing its own session is the same shape.

8. **Fan-in collapsing is anticipated and additive — do not build a second mechanism for it.**
   `debounce` is already reserved in the policy enum and rejected at definition time
   (`concurrency.ts:33`, `:90`, `:110-116`), and it is exactly what "three workstreams posted
   questions, wake the coordinator once" wants. The collapse case has a home. Nothing in this epic
   invents one.

9. **A stateless verb taking an explicit address, with the sender's identity server-derived.**
   FIX-1124 (deleting `parentTask`/`settleParentTask` from `RequestHost`) names the mechanical
   trap: `runtimeConfig.requestHost` is one object per process, mutated in place, "which a
   per-request binding can never correctly be." So the send verb must not be bound per request.
   And the sender's identity comes from the execution context, never from the caller — BP-031,
   never make auth or routing decisions from caller-controllable input. **Constrains issues 1
   and 3.**

   **The address is a `sessionId`, on both ends** — stated by the owner, so an issue spec builds
   to it rather than re-deriving it. The **recipient** is named by `sessionId`. The **sender** is
   identified by its own `sessionId`, and **possibly also by the `requestId` of the sending
   request** — the requestId half is an open detail for issue 1's spec, not a decision here
   (§5 Q1b). Neither value is caller-supplied: both read off the execution context
   (`ctx.session.identity`, §3's ctx-gap list). Since sender and recipient are the same owner by
   construction (§1), the address carries no user coordinate and no cross-user authorization
   question rides on it.

10. **`livenessOf`'s lineage filter is containment, not an oversight — this epic does not widen
    it.** `packages/engine/src/context/liveness-read.ts` filters every answer through
    `isDescendantSession` (`create-request-host.ts`) plus a `flowKind` equality check, so a
    **peer** coordinator's requestId returns `false`, indistinguishable from an unknown id. Its
    own doc says "false means 'no live registration was found', never 'definitely dead'." Every
    hop re-checks the principal, which is what stops a chain being followed out of its tenant. A
    sibling therefore learns about a sibling by **message**, not by probing liveness.

    **Future direction — cross-session progress polling, and its known wall.** The owner has
    raised periodic "is the target session still making progress" polls as a later, more mature
    mechanism than a sender-side timeout. **Not in this epic**, and worth recording *why it is
    not a small addition*: `livenessOf` filters every answer through `isDescendantSession`
    (`packages/engine/src/context/liveness-read.ts:131`, resolved at
    `create-request-host.ts:433,493`) plus a `flowKind` equality check (`liveness-read.ts:127`),
    so a **peer** session's request returns `false` — indistinguishable from an unknown id. That
    filter is deliberate containment and **is not to be widened**. Cross-session progress needs
    something genuinely new, not a relaxed predicate.

11. **Messages are not tasks, and the board stays single-writer.** A task has a goal and a sense
    of completion, possibly long-running and concurrent, tracked by a board the session does not
    itself run. A message is a collaboration mechanism that works *while a task is in process* —
    it is what makes steering possible. **Tasks go downward; messages go upward and sideways.** An
    issue that finds itself adding a message field to a task row has hit this line. The same
    boundary sets the default for board writes: a workstream **requests** a plan change and the
    top session decides. Once addressed messaging exists, a request costs no more than a mutation
    would, and single-writer is what keeps the board reasonable about. Whether some workstreams may
    write directly is open; the default is *request*.

12. **A role is always a block; only the call site varies.** Isolation is free in a block;
    concurrency is what costs a session. The consequence for this epic is narrow and worth stating
    so nobody builds otherwise: **the messaging layer needs no role-awareness.** It addresses
    sessions, not roles.

13. **Sequencing: issue 1 lands first; issue 5 is independent.** Issues 2, 3 and 4 all consume the
    address and the verb, so none can merge before issue 1 — they can be *specced* in parallel.
    Issue 5 depends on nothing in the set and can start immediately.

14. **Two clocks, two jobs — and the admission budget must become configurable.**
    *(Added by owner amendment; **corrected by §3's Q4 run**, which superseded the reasoning this
    theme originally rested on.)*

    **The two clocks stand, and that half is unchanged.** `QUEUE_WAIT_TIMEOUT_MS = 30_000`
    (`packages/engine/src/transports/concurrency/arbiter.ts:40`) is an **admission** budget: how
    long the arbiter holds a *kickoff* waiting for the recipient's concurrency key to free. The
    sender's **answer** timeout is a different thing on a different clock. Conflating them is
    still the error to avoid, and "just raise the 30 s so the sender waits longer" is still the
    obvious wrong fix.

    **What was wrong.** This theme originally recorded the constant as a *deliberate non-change*,
    on the reasoning that a verb acking on `accepted` (theme 6) is never inside the arbiter's
    wait, so the budget is not that verb's number. That reasoning is **superseded**. The budget
    does not bound a *caller*; it bounds the **delivery**, whoever is or is not awaiting it.
    `runExclusive` "rejects with `ConcurrencyQueueTimeoutError` and **never runs `fn`**"
    (`packages/engine/src/utils/keyed-async-gate.ts:39-44`). Q4 ran it: a delivery **accepted at
    0 ms** was **dropped at 30 001 ms** because the recipient stayed busy for 35 s, and the sender
    — already returned, reading `completed` — was never told.

    **So: the admission budget must be configurable**, with `Infinity`/omitted as the unbounded
    case. That case is already supported rather than new work: `runExclusive`'s timer is guarded
    by `waitTimeoutMs !== undefined && waitTimeoutMs !== Infinity && waitTimeoutMs > 0`
    (`keyed-async-gate.ts:141-145`), and Q4 ran the same 35 s scenario through an arbiter whose
    only difference is that budget, set to `Infinity`. The delivery landed. The fix is therefore
    **a parameter at the arbiter**, not a structural change — but the epic only gets to say that
    because it was run.

    **Raising the number is still not the fix.** Q2's cost stands as the argument against merely
    setting a bigger constant: a queue-wait timeout costs the full budget in dead time, leaves a
    **`failed`** record on the recipient's session for a run that never started, and the sender
    reports **`completed`**. At 30 minutes that is a half-hour phantom. A longer wrong number is
    still a wrong number — the budget has to be the *deployment's* call, including "don't expire".

    **The sender-side answer timeout: default 30 minutes, explicitly configurable.**
    Wait-for-response takes its own timeout, generous on purpose. What actually detects a dead
    recipient is the **lease** — "if the run dies at any point … the lease lapses and the owner
    recovers the row … no dispatch milestone improves on it"
    (`packages/engine/src/transports/types.ts:212-217`). So the sender's clock is a **backstop**,
    not the primary safety mechanism, and a short default would fire on healthy slow work rather
    than catch anything the lease does not already catch. **This supersedes any reading elsewhere
    in this document that 30 s is the relevant number for a sender** — 30 s is the arbiter's
    number, and it is the *delivery's* deadline, not the sender's.

    **Why acceptance alone is not enough, stated so issue 1 does not ship the receipt and stop.**
    Q4 is the case where `accepted` resolves and the message still never arrives, so acceptance
    answers *the recipient's queue took it*, never *it will run*. A send that acks on acceptance
    and a delivery that can expire behind it need each other: the receipt is theme 6's, the
    budget is this theme's, and shipping one without the other is what produces a silent drop
    the sender was told was fine.

    **Constrains issues 1 and 2** — issue 2 owns the configurable budget (see §4); issue 4
    inherits it, since a schedule that waits for an answer is the same shape.

---

## 3. Shape of the whole *(POC)*

**Built:** a characterization POC of the four things the design was asserting from a code read —
that a running block can re-enter `host.dispatch` onto another live session, that a self-addressed
wait deadlocks, that a queued delivery outlives the request that sent it, and that the arbiter's
admission budget does or does not drop an already-accepted delivery. Not an end-state POC: the
division in §4 is still unchecked against an assembled surface, and §5 Q1 remains a design
question no run settles.

**See it:** `spec-poc/epic-relay/` on this branch.

```
pnpm tsx spec-poc/epic-relay/q1-inside-out-dispatch.ts       # instant
pnpm tsx spec-poc/epic-relay/q2-self-addressed-deadlock.ts   # ~35s, on purpose
pnpm tsx spec-poc/epic-relay/q3-delivery-outlives-sender.ts  # ~10s
pnpm tsx spec-poc/epic-relay/q4-admission-budget-drop.ts     # ~80s, on purpose
```

**In-process only.** `arbiter.ts:22-27` and `createInboundTransportHost.ts:299-301` skip
arbitration entirely under an external dispatcher, so nothing below speaks to the durable path
(§5 Q3, §1's named risk). All four remain unchecked by run there.

**Showed — Q1, the tracer bullet: it works, and identity is the sharp edge.** A block in
`sess_sender` dispatched onto a live peer session and the second request ran to completion,
landed a request record on the *recipient*, and its message is in the recipient's
`ctx.session.items.all()`. The sender's own history stays clean. But the principal is a plain
field on the envelope and **nothing at the seam checks it**:

| sender | recipient owner | envelope principal | outcome |
|---|---|---|---|
| user_a | user_a | `user_a` | ran |
| user_a | user_b | `user_a` | refused — `UserBindingMismatchError` |
| user_a | user_b | `user_b` | **ran, as `user_b`** |

What catches row 2 is `createExecutionContext.ts:631` — a *consistency* check between the
envelope and the session record's owner, not an authority check. Name the owner and it passes.
So theme 9's "the sender's identity server-derived" is now proven necessary rather than argued:
a `dispatch`-shaped verb has the exposure `startDetached` avoids by closing over identity.

The same guard also shows, mechanically, that **with an honest principal a session can only be
addressed by its own owner.** Since the owner has since stated same-owner as a **design
invariant** rather than a boundary (§1) — *"we are never sending from one user to another"* — row
2 is not the design leaning on a refusal; it is what a *bug* would hit. A correctly-built sender
never reaches it. Row 3 is the finding that still bites: naming another owner in the envelope
passes, which is why theme 9's server-derived identity is a requirement and not a preference.

**The `ctx` gap — the shape of the send verb, and it is short.** Four things the block had to
reach for: **`host.dispatch` itself** (not on `BlockContext` in any form; the POC uses a
module-level hack, and `ctx.requestHost` was `undefined` besides being closed at four
session-less verbs); **`flowKind`** (ctx names neither the recipient's flow nor its own);
**`source`** (no inside-world `InboundSource` exists — the POC lies and says `"http"`); and a
**server-derived principal** (`ctx.session.identity.userId` exists, so the value is recoverable
— the gap is that nothing forces the verb to use it). `sessionId`, `orgId` and `tenantId` all
read off `ctx.session.identity`.

**Showed — Q2: the deadlock is real and it fails safe, but louder than theme 7 assumes.** Under
`request: { concurrency: "queue" }`, a request awaiting its own session timed out at **30016ms**
with `ConcurrencyQueueTimeoutError: Timed out after 30000ms waiting for concurrency key
"sess_talks_to_itself" to free up.` It does **not** hang. Three details strengthen the
refuse-at-definition-or-dispatch case rather than weaken it: 30 seconds of dead time on a live
session; the recipient request left **`failed`** in the store, a run on the session's own history
that never started; and the sender reporting **`completed`**, because the timeout surfaces inside
the sending block and nothing propagates it. The control run confirms theme 7's other half —
self-addressed fire-and-forget queues behind the sender and completes.

**Showed — Q3: CONFIRMED. Delivery outlives the sender's request, and acceptance resolves while
the message is still queued.** Fire-and-forget's whole value rests on "delivery is attached to
the process, not to the originating web request", and nobody had run it. Under
`request: { concurrency: "queue" }`, `sess_busy_recipient` was held mid-run for 4 s; a *different*
session, `sess_sender`, dispatched onto it fire-and-forget and returned without awaiting; the
sender's own request reached `completed` in the store in **4 ms**. The queued `receive` was then
admitted once the recipient's in-flight work finished and ran to **`completed`** — after the
sender was terminal — landing its message on the recipient's session (`from: sess_sender`).

The second reading is the one theme 6 needed: the send awaited `handle.accepted` and it settled
at **`acceptedAfterMs: 0`** — acceptance resolved immediately, *while the run was still sitting
behind the busy recipient's concurrency key*. That is "accepted, queued, keep waiting" observed
rather than inferred, and it is what makes acceptance usable as the acknowledgement on both send
modes. The run also confirms `accepted` is present on the in-process path
(`acceptedPresent: true`), which the type does not guarantee.

**What Q3 did not test:** a recipient busy longer than `QUEUE_WAIT_TIMEOUT_MS`. The 4 s window is
comfortably inside the arbiter's 30 s admission budget. **Q4 tested exactly that window.**

**Showed — Q4: CONFIRMED. An accepted delivery is silently dropped at 30 s, and the sender is
told it succeeded.** Same shape as Q3 with one number changed — the recipient holds its
concurrency key for **35 s**, past the budget. The sender awaited `accepted`, got it at
**0 ms**, returned in **4 ms**, and never awaited `finished`. The delivery then died:

| | observed |
|---|---|
| the handler | **never ran** — no side effect, nothing in `received` |
| recipient's `receive` record | **`failed`**, `startedAtMs` 1787347096195 → `failedAtMs` 1787347126196 (**30 001 ms**, never started) |
| recipient's session items | `seed` + `busy` only — **no message from the sender** |
| sender's record | **`completed`** |
| host warn/error logs · unhandled rejections · leftover `activeRequests` | **none, none, none** |

**Is the drop discoverable? Barely, and not as itself.** There *is* a `failed` request record on
the recipient's session and the sender holds its `requestId`, so a coordinator that knows to poll
can find it — better than "you notice the answer never came". But that is the whole of it.
`RequestRecord` carries no error field (`stores/types.ts:117-172`), so nothing records **why**;
`startedAtMs` is stamped at enqueue, so the row reads as a run that took 30 s and failed rather
than one that never began; and `ConcurrencyQueueTimeoutError` **never surfaces anywhere** —
`void finished.catch(() => {})` (`createInboundTransportHost.ts:692`) marks the rejection handled,
so it is swallowed, not merely unobserved. Acceptance at 0 ms plus loss at 30 s is what makes the
receipt insufficient on its own (theme 14, theme 6).

**And the fix is small — run, not read.** `runExclusive`'s timer is guarded by
`waitTimeoutMs !== undefined && waitTimeoutMs !== Infinity && waitTimeoutMs > 0`
(`keyed-async-gate.ts:141-145`). Isolated on the real gate, one held key and three waiters:
`waitTimeoutMs=300` → `ConcurrencyQueueTimeoutError`, fn never ran; **`Infinity` → fn ran**;
**omitted → fn ran**. Then the identical 35 s scenario against an arbiter differing from the
shipped one *only* in that the budget is a parameter set to `Infinity` — injected through the
`arbiter` option `createInboundTransportHost` already takes (`:106-113`), with no engine code
patched. **The delivery landed:** `receive` completed after waiting 34.7 s, its message on the
recipient's session. So a configurable budget at the arbiter is a parameter, not a redesign.

**Changed:** nothing in §1's objective, and no re-division — **the five issues stand**. What moved
is one scope cell and one theme. **Theme 14 is corrected, not extended:** it had recorded the
30 s constant as a deliberate *non-change* on the reasoning that a verb acking on `accepted` is
never inside the arbiter's wait; Q4 superseded that reasoning — the budget bounds the delivery,
not the caller — so a **configurable admission budget is now in scope**, on **issue 2** (§4), and
§1's named risk says so. The two-clocks half of theme 14 stands, and Q2's phantom-record cost
still argues against merely *raising* the number: a longer wrong number is still a wrong number.
Theme 6 and theme 14's addition were owner amendments rather than run outcomes; the runs supply
their evidence. Q1's cross-user refusal was promoted from evidence here to §1, where the owner has
since restated it as a **design invariant** — never a user-to-user send — rather than a boundary
the design leans on.

---

## 4. Running index

The durable audit log for the set. **Nothing below is filed yet** — the owner gates the
objective before the set is created as sub-issues, so every row is a proposal and every issue
cell is empty by design, not by omission.

| # | Proposed issue | What it delivers | Depends on | Linear | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|---|---|---|
| 1 | The address, the send verb, and what a sender may legally address | the recipient address as a **`sessionId`** on the envelope, a **server-derived sender identity** (its `sessionId`, and possibly the sending `requestId` — open, §5 Q1b), the send verb, both send modes **and the reply-correlation identifier wait-for-response requires** (theme 6, §5 Q1b), **acceptance as the acknowledgement on both** (theme 6) and the **sender-side answer timeout, default 30 min** (theme 14), the self-addressed refusal, and the agent-facing tool — core + engine + tools | — | not filed | spec | — | — | Proposed |
| 2 | Per-adapter delivery | in-process for a Node host; through the `FlowDispatcher` seam so a queue-backed deployment gets durability for free; **plus a configurable in-process admission budget** (theme 14, §3 Q4) — the arbiter's hardcoded 30 s silently drops an already-accepted delivery, and `Infinity`/omitted is the unbounded case the gate already supports | 1 | not filed | spec | — | — | Proposed |
| 3 | The sibling-spawn verb | an independent, self-managing session with its own flow kind and addressable key, resolving `flow.actions` like any other caller and talking back by message rather than `settleParentTask` | 1 | not filed | spec | — | — | Proposed |
| 4 | Cron: a schedule addresses a session and fires as a message | the schema field, the resolver, and the one dispatch envelope; absent address preserves today's behaviour exactly | 1 | not filed | spec | — | — | Proposed |
| 5 | A `pending feedback` task status | "parked awaiting external input; the request may end; a later request resumes this task" — a genuine addition, not a rename of `awaiting_review` | — | not filed | spec | — | — | Proposed |

**The agent-facing tool is deliberately inside issue 1, not beside it.** The constraint is that
the programmatic sender and the tool are the *same verb*, differing only in who calls them.
Co-location is the strongest guarantee against the two drifting apart.

Epic PR (this doc, never merged):
[#1357](https://github.com/fixpoint-labs/flow-state-dev/pull/1357).

### The relationship map — issues this epic touches but does not contain

| Issue | Relationship |
|---|---|
| **FIX-441** — cross-flow event bus (Backlog) | **Superseded by this epic.** Its `NotificationFlow` fan-out subscriber shape is the thing ruled out in §1. Its own subscriber half was already superseded by FIX-825. Recommend closing as superseded with a pointer here |
| **FIX-1056** — no channel to steer a running workstream (Backlog) | The same seam from the steering side. **Should survive as the carrier**: it holds the evidence and the owner decision. Its decision of 2026-08-10 is quoted in §5 Q1 |
| **FIX-1075** — inbox capability (Backlog) | The same seam from the receiving side; FIX-1075 says so itself. Folds into issue 1 |
| **FIX-830** — BullMQ sunset (In Spec Review) | **Constrains**: build to the `FlowDispatcher` seam (theme 1). Also owns durable arbitration, which is why §5 Q3 does not pull it inward |
| **FIX-1124** — delete `parentTask`/`settleParentTask` from `RequestHost` | No direct conflict, but it sets the precedent theme 9 encodes: a stateless verb taking an explicit address is fine, a per-request bound one is not |
| **FIX-1122** — `WorkstreamAddress` | A **board coordinate** `(boardId, coordinate, topic)`, explicitly frozen at that content. **Not** the session address this epic needs; reusable for the workstream-side coordinate only |
| **FIX-1179** — a detached run cannot resume its external session | Related, **not** in the epic. It gates *steer-with-continuity*; the ask direction needs nothing from it |
| **FIX-1171** — a reply arriving as a turn in the originating conversation | Distinct. Under the Strands epic FIX-1169, blocked by FIX-1170 (strand identity) |
| **FIX-765**, **FIX-816** | Adjacent suspension/wait seams that theme 5's "reply as a new message" decision routes around |

---

## 5. Open cross-cutting questions

**The owner is in challenge mode: nothing below is locked, and none of it is settled by this
document.** Where the epic has a lean, it is marked as the epic's lean rather than a decision.

### Q1. What may a sender legally address?

**Still open, and still the load-bearing fork.** One half of the addressing space *is* settled:
the owner has stated that a recipient is a **`sessionId`** and that messaging never crosses
users (§1). That answers **which sessions exist to be addressed** — the same owner's, always. It
does **not** answer this question, which is about **what a sender may name once it has a session
in hand**: the flow's caller-addressed `actions`, or a narrower author-declared inside-world
surface. Nothing below is settled by the address being named.

**The first design question of the build, not a detail inside it.** `RequestHost` is closed at
four verbs — `startDetached`, `parentTask`, `settleParentTask`, `livenessOf?`
(`packages/core/src/types/request-host.ts:29,233,243,254,272`) — and none of them takes a
session id as a parameter. A caller supplies a seed; identity is closed over. That is precisely
so nobody can name a session they do not own. Messaging must name a recipient, so it meets that
constraint head-on.

Candidate shapes:

- **(a) Messages resolve `flow.actions` like any other caller.** The mailroom reading, and the
  cheapest. Against it: a workstream is not a trusted caller the way an API client is, and
  BP-031 says never route from caller-controllable input. `ActionConfig` is explicitly the
  **caller-addressed** form (`packages/core/src/types/flow.ts:237-243`), and the same doc notes
  that event-addressed handlers "are a different form — they carry the core inline on their
  transport binding and never enter this map."
- **(b) A new author-declared inside-world surface on the flow** — a `relay?:` config, sibling
  of `webhooks?` / `schedules?` — that the **recipient** declares and the sender may only name a
  message type within. This would be the flow's **first author-declared inside-world entry**:
  additive rather than a narrowing of anything shipped.
- **(c) Something narrower still**, scoped per relationship.

**The asymmetry that makes this sharp.** A **sibling** *is* a caller, and `flow.actions` is its
natural entry. A **workstream**'s only entry today is the terminal, board-derived
`flow.workstream`, whose doc states the security invariant directly
(`packages/core/src/types/flow.ts:548-566`): "resolution for the detached source is **terminal**,
so an absent core is a named refusal and never falls through to `actions`. That is the security
invariant — a detached dispatch must have no route to a caller-addressed action." The two halves
may therefore not want the same answer, and a shape that gives them one may be forcing it.

**The owner has already met this fork once.** FIX-1056 carries a decision of 2026-08-10: "a
detached task stays the only way to start a Workstream", with the tripwire "If steering wants a
channel that is not a task, that is the point where the authored-entrypoint question re-opens…
Recorded here so that fork is met deliberately rather than discovered." Steering does want a
channel that is not a task. This is that point.

**The epic's lean (not a decision): (b).** The owner's own framing is that a flow's `actions`
were designed for outside-world contact, not inside-world coordination, and (b) keeps the
`flow.workstream` invariant intact rather than arguing around it. **What would change it:** a
concrete case where a sibling needs to invoke an action a human caller can already invoke — if
that is the common case rather than the exception, (b) is a second door for one job and (a) is
right for the sibling half at least.

**Blocks:** issue 1's spec, and therefore 2, 3 and 4. Issue 5 is unaffected.

### Q1b. Does the sender's identity carry a `requestId` as well as a `sessionId`?

**A separate, much smaller question than Q1 — deliberately not merged into it.** Q1 is the door;
this is one field on the sender's side of the envelope, and answering it settles nothing about
Q1.

The owner stated the recipient address as a `sessionId` and the sender as "sessionId (and **maybe**
requestId for senders)". The hedge is recorded as a hedge: **this is an open detail for issue 1's
spec to settle**, not a decision the epic makes. Three things argue for carrying it, recorded here
so whoever specs issue 1 has the case in hand rather than rebuilding it:

- **Reply routing granularity.** A sender's `sessionId` routes a reply back to the *session*. The
  `requestId` of the sending request is what would route it back to the **specific request that
  asked** — which matters exactly where a session has more than one question outstanding.
- **A handle for the discoverability gap.** §3's **Q4** run showed a dropped delivery leaving a
  bare `failed` record on the recipient with **no reason recorded and no link to what sent it**
  (`RequestRecord` carries no error field; `ConcurrencyQueueTimeoutError` is swallowed). A sending
  `requestId` on the envelope is a concrete correlation handle for that, and cheap.
- **Wait-for-response needs *some* correlation identifier to work at all.** *(Epic review, round
  2.)* Theme 6 specifies the mode; nothing said what matches an arriving answer to the question it
  answers, and on the workstream path the answer is a separate inbound message rather than the
  sender's handle resolving. An identifier carried on the message and echoed on the reply is what
  closes that, and the sending `requestId` is the obvious candidate. This argument is different in
  kind from the two above: they are conveniences, this is a send mode that is under-specified
  without one.

None of the three is decisive about the *shape* — a correlation identifier is required, but
whether it is the sending `requestId` or a field carried beside it is issue 1's call — which is why
this stays open. **Scope:** issue 1's spec. **Blocks no other issue** — the address itself is
settled without it — but issue 1 cannot specify wait-for-response without answering it.

### Q2. The name

Unsettled on purpose, and worth settling **before the schema is written** — the noun is what the
config surface inherits and what every later doc repeats.

The competing shape is not a synonym but a different decomposition. **Message** is already
uniform in this system (user message, session message, webhook message), so rather than
introducing a parallel noun, extend messages with a **sender** and a **recipient**. Cron then
falls out as a "scheduled message": one noun, several origins. If the flow-config group needs a
qualifier, **`relay`** is the accurate one — it names *routing*, which is what this does, rather
than storage.

Rejected, with reasons: **`exchange`** is AMQP-loaded, and an exchange is a fan-out primitive —
the one thing ruled out. **`intake`** implies inbound-only, and this is bidirectional. **"Mail"**
reads as internal, which is its virtue; its risk is that a mailbox implies polling, which is the
model this design rejects.

**Leaning:** message-with-sender-and-recipient, `relay` for the config group. **Not settled
here** — the owner wants code in front of them first.

### Q3. Does anything promise ordering or exclusion?

**The evidence for §1's named risk.**
`packages/engine/src/transports/concurrency/arbiter.ts:22-27` states it: "v1 enforces the policy
for the in-process dispatcher only. With an external dispatcher the run completes in another
worker, so the host skips arbitration (passing no key) and enforcement is deferred to the durable
substrate (FIX-830)." That skip is implemented at
`packages/engine/src/transports/host/createInboundTransportHost.ts:299-301`. In-process, the gate
is a per-process `Map` that dies with the process
(`packages/engine/src/utils/keyed-async-gate.ts:13-16`), and a `queue` waiter gives up on the key
after 30 seconds (`arbiter.ts:40`, `QUEUE_WAIT_TIMEOUT_MS`). The default key is also inert
without a session — `"session"` resolves to `undefined` when the envelope has none
(`arbiter.ts:101-105`), which is exactly today's scheduled-dispatch case.

So: in-process a recipient gets FIFO with a 30-second give-up; on a queue-backed deployment it
gets nothing. **That 30 seconds is an admission budget, not a sender's timeout** — theme 14 — and
§3's Q4 ran what the give-up costs: an already-accepted delivery is dropped at 30 001 ms with the
sender reading `completed`. **Making that budget configurable is in scope** (theme 14, issue 2);
this open question is about the *durable* path only, where the epic promises nothing. Two options:

- **Promise nothing beyond what the deployed dispatcher gives, and document it plainly.** Cheap,
  honest, and additive later — a stronger promise can be added without breaking anyone.
- **Pull durable arbitration in.** That is FIX-830 territory, and it would roughly double the
  epic.

**The epic's recommendation (not a decision): the first.** Retracting a promise is expensive;
adding one is not, and FIX-830 already owns the durable half. The cost of being wrong is that a
consumer builds on ordering that only holds in development and breaks in a queue-backed
deployment — which is exactly what documenting it plainly is meant to prevent. **Blocks
nothing**; issue 2's spec records whichever answer lands.

### Q4. Which layer does role materialization belong on?

`@flow-state-dev/workforce` is not a settled package — it was intended as a file-conventions
system, an opinionated wrapper over primitives already beneath it. Its `agent-block.ts` calls
itself "a thin wrapper around materializeAgent", and `materialize-agent.ts` imports
`workerInputSchema`, `buildUserMessage` and `taskTools` from `orchestration`. So the question is
not reuse-or-build, it is **which layer**: if the only piece needed is materializing a role as a
block, that piece may belong in `orchestration` rather than in a wrapper over it. The owner leans
toward building on `workforce`, explicitly not locked. **This epic does not settle it** — decide
with real code in front of you. Recorded here so a second issue does not re-open it from scratch.

### Q5. Does `pending feedback` belong in this epic or its own?

It is a dependency of the design either way (theme 5). The epic proposes carrying it as issue 5,
unblocked and startable immediately. The alternative is filing it outside the epic and depending
on it. **This is the composition half of the objective gate** — see §1's necessity check.

---

## Epic evolution

- **Epic drafted** — five proposed issues under one outcome: an existing session becomes
  reachable from inside the system. Fan-out ruled out rather than deferred; cron folded in as a
  sender rather than left beside as a transport; the in-process-only arbitration limit recorded
  as a named risk rather than discovered later.
- **Owner amendment — the receipt, and the two clocks.** Delivery receipt is no longer excluded:
  it answers *am I right to still be waiting*, not *did it arrive*, and it already ships as
  `DispatchHandle.accepted`. Theme 6 rewritten so acceptance is the acknowledgement on **both**
  send modes rather than a third mode; theme 14 added, separating the arbiter's 30 s **admission**
  budget (deliberately unchanged — *superseded by the next entry*) from a sender-side **answer**
  timeout defaulting to 30 minutes.
  Cross-session progress polling recorded as future direction with its wall (theme 10);
  **cross-user messaging stated as out of scope in §1** — recorded then as "same-owner only in
  v1", *superseded by the last entry: it is a design invariant, not a v1 boundary*. Q3 added to the
  POC and run: delivery outlives the sending request (CONFIRMED), and acceptance resolves while
  the message is still queued.
- **Correction — the admission budget drops accepted deliveries, and theme 14 was wrong about
  why that did not matter.** *What was recorded:* theme 14 held the arbiter's
  `QUEUE_WAIT_TIMEOUT_MS = 30_000` as a **deliberate non-change**, reasoning that a send verb
  acking on `accepted` is never inside the arbiter's wait, so the constant is not that verb's
  number. That was settled by reading, and it was wrong. *What ran:* §3's **Q4** — the Q3 shape
  with the recipient busy **35 s** instead of 4 s. The delivery was accepted at **0 ms** and
  dropped at **30 001 ms**; the handler never ran; the recipient's record reads a bare `failed`
  with no reason and an enqueue-time `startedAtMs`; nothing reached the recipient's item history,
  the logs, or an unhandled rejection; the sender read `completed`. A second phase ran the same
  scenario through an arbiter differing only in a configurable budget set to `Infinity` — already
  supported by the shipped gate's guard — and the delivery landed. *What it changed:* theme 14
  rewritten — the two clocks stand, the non-change does not, and **a configurable admission
  budget is now in scope on issue 2**; §1's named risk and §4's issue-2 cell updated to match;
  §5 Q3 narrowed to the durable path. **No re-division — the five issues stand.**
- **Owner comment — the address is a `sessionId`, and same-owner is an invariant, not a v1 cut.**
  On §3's identity table: *"when we say sender and recipient, we mean sessionId (and maybe
  requestId for senders). We are never sending from one user to another."*
  *What it settled:* (1) **Same-owner is a design invariant.** §1's "cross-user messaging" bullet
  was a **scope boundary** phrased as "same-owner only in v1", which implied a limitation awaiting
  a later decision. It is not one — there is no open decision behind it. Reframed in §1 and §3;
  two consequences stated explicitly because both *reduce* scope: `UserBindingMismatchError`
  (`createExecutionContext.ts:631`) is a guard against a bug rather than a boundary the design
  leans on, and **cross-user authorization is now a stated non-goal of the epic** rather than an
  unexamined gap. (2) **The address shape.** The recipient is a `sessionId`; the sender is
  identified by its own `sessionId`. Recorded in theme 9, theme 2, §1 and §4's issue-1 cell.
  *What it explicitly did not settle:* **§5 Q1's door question is untouched and stays open** —
  whether a sender resolves `flow.actions` or a narrower author-declared inside-world surface is
  still the load-bearing fork the objective gate asks about. Knowing *which sessions* may be
  addressed says nothing about *what may be named* on one. And the `requestId`-on-the-sender half
  was hedged by the owner ("maybe"), so it is recorded as **§5 Q1b — an open detail for issue 1's
  spec**, with the case for it (reply-to-the-specific-request routing; a correlation handle for
  the §3 Q4 discoverability gap) written down but not decided.
- **Epic review, round 2 — the reply-correlation gap, and §1 now leads with the problem. This
  spends the last of the epic PR's two-round budget: the epic-spec is converged.** Remaining and
  future epic-PR threads are carried as **implementer notes** on the issue each belongs to rather
  than folded here. Two findings, both on the doc.
  (1) **Wait-for-response had no reply correlation.** The mechanism as reported — that the mode
  awaits `DispatchHandle.finished` and so resolves on the recipient's run instead of the answer —
  is not what this document specifies; theme 5 says the reply arrives as a *new inbound message*,
  and nothing here awaits `finished` for an answer. *The gap underneath it is real and ours:* the
  mode was specified without ever naming **what matches an arriving answer to the question it
  answers**. Theme 6 now requires a correlation identifier carried on the message and echoed on
  the reply, and states plainly that `finished` resolves the *recipient's handling of the message
  sent*, which is a different event from *the answer arriving*. **§5 Q1b — the sending `requestId`
  — is the leading candidate**, and this is its third and first non-optional argument: it moves
  Q1b from a convenience to **load-bearing for a send mode**, and **does not settle it** (the
  owner hedged; the field is issue 1's spec to settle). Theme 5 and §4's issue-1 cell
  cross-reference it so the mode and the identifier are not read apart again.
  (2) **§1 led with the objective before the problem**, against BP-039 — worst on the one section
  the gate signs off, since it makes the direction harder to assess independently of its proposed
  solution. Reordered: problem first, objective second, nothing dropped.
  **No re-division — the five issues stand**, and **§5 Q1's door question is untouched**.
