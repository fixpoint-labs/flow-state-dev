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

**Objective. Make an existing session reachable from inside the system.** A background
workstream can raise a question without ending. A coordinator can steer a workstream that is
already running. Two top-level sessions can keep each other informed. A schedule can fire onto
a named session instead of only ever starting a new one.

**The problem, in plain terms.** FSD can start a session, and it can start a detached child of
one. Nothing can reach a session that already exists. So a workstream that hits a question has
nowhere to put it — it finishes or it fails. A schedule that fires can only begin something
new. Those are the same hole seen from two sides, which is why cron is inside this epic rather
than beside it.

The consumer is **Conductor**, a meta-harness driving coding-agent runs across many sessions.
One known, committed consumer is what keeps this from being speculative surface (tenet 3).

**What sign-off certifies.** The objective and the grouping — that cron rides on this layer
rather than keeping a transport of its own, and that a spawn verb and a send verb are the same
missing layer. It certifies **no** issue's contracts: the address shape, the verb's name, and
the config surface it hangs off are all open (§5), and the five-issue division in §4 is a
proposal. **The gate is the last cheap moment to redraw the set** — after it, redrawing costs
specs already written.

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
  (Delivery receipt is **no longer** on this list: acceptance already exists in shipped code and
  every send awaits it — theme 6, amended.)
- **Cross-user messaging. Same-owner only in v1** — confirmed by the owner. The objective's "two
  top-level sessions keep each other informed" means two sessions with the **same owner**. With an
  honestly ctx-derived principal a session is addressable only by its own owner:
  `packages/engine/src/context/createExecutionContext.ts:631` throws `UserBindingMismatchError`
  when the envelope's `userId` differs from the session record's owner, and the POC ran it (§3).
  Reaching across users would be a deliberate decision **against an existing refusal**, not
  something this epic delivers.

**Named risk: arbitration is in-process only, and this epic does not fix it.** The host skips
arbitration entirely when an external dispatcher is configured, deferring it to the durable
substrate (FIX-830); in-process, the gate is a per-process map and a queued waiter gives up
after 30 seconds. So "arbitration already exists" is **true in-process and false on the durable
path**. For a busy recipient that means two messages can run against one session at once on a
queue-backed deployment, and a queued message can be dropped in-process. Evidence and the
options are §5 Q3; nothing is promised here.

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
   epic's shape.

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
   and 5**, and issue 5 is what makes the workstream half representable at all.

6. **Two send modes, not three — and acceptance is the acknowledgement on both.** *(Amended by
   the owner. Still two modes; what changed is that the receipt is not a third one.)*
   Fire-and-forget and wait-for-response are genuinely different intents and both are needed.
   **Every send awaits acceptance before returning.** Fire-and-forget returns there;
   wait-for-response carries on and waits for the answer (theme 14).

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

14. **Two clocks, two jobs — the arbiter's admission budget is not the sender's answer timeout.**
    *(Added by owner amendment; the sharp part of theme 6.)* `QUEUE_WAIT_TIMEOUT_MS = 30_000`
    (`packages/engine/src/transports/concurrency/arbiter.ts:40`) is an **admission** timeout: how
    long the arbiter holds a *kickoff* waiting for the recipient's concurrency key to free. It
    bites a caller that is awaiting the kickoff. A send verb that acks on `accepted` (theme 6)
    and then waits for the **answer** on its own clock is never inside the arbiter's wait, so the
    30 seconds is not that verb's number.

    **This epic does not propose changing that constant.** Recorded as a deliberate non-change,
    because "just raise the timeout" is the obvious wrong fix and someone will suggest it. §3's
    Q2 run is the argument: a queue-wait timeout today costs **30 s of dead time**, leaves a
    **`failed`** record on the recipient's session for a run that never started, and the sender
    reports **`completed`**, because the error surfaces inside the sending block and nothing
    propagates it. At 30 minutes that is a half-hour phantom. Raising the budget scales the
    damage; not waiting on it is the fix.

    **The sender-side answer timeout: default 30 minutes, explicitly configurable.**
    Wait-for-response takes its own timeout, generous on purpose. What actually detects a dead
    recipient is the **lease** — "if the run dies at any point … the lease lapses and the owner
    recovers the row … no dispatch milestone improves on it"
    (`packages/engine/src/transports/types.ts:212-217`). So the sender's clock is a **backstop**,
    not the primary safety mechanism, and a short default would fire on healthy slow work rather
    than catch anything the lease does not already catch. **This supersedes any reading elsewhere
    in this document that 30 s is the relevant number for a sender** — 30 s is the arbiter's
    number, and only for a caller awaiting admission.

    **What the non-change does *not* buy, stated so issue 2 does not discover it.** The 30 s
    budget still bounds how long a *queued delivery* may wait for admission, whoever is or is not
    awaiting it. A recipient busy longer than that is §1's named risk ("a queued message can be
    dropped in-process"), and a 30-minute sender timeout does not rescue it. **Unverified by
    run** — Q3 exercised a 4 s busy window, not a 30 s one — so issue 2's spec should check it
    rather than inherit it.

    **Constrains issues 1 and 2**; issue 4 inherits it, since a schedule that waits for an answer
    is the same shape.

---

## 3. Shape of the whole *(POC)*

**Built:** a characterization POC of the three things the design was asserting from a code read —
that a running block can re-enter `host.dispatch` onto another live session, that a self-addressed
wait deadlocks, and that a queued delivery outlives the request that sent it. Not an end-state
POC: the division in §4 is still unchecked against an assembled surface, and §5 Q1 remains a
design question no run settles.

**See it:** `spec-poc/epic-relay/` on this branch.

```
pnpm tsx spec-poc/epic-relay/q1-inside-out-dispatch.ts       # instant
pnpm tsx spec-poc/epic-relay/q2-self-addressed-deadlock.ts   # ~35s, on purpose
pnpm tsx spec-poc/epic-relay/q3-delivery-outlives-sender.ts  # ~10s
```

**In-process only.** `arbiter.ts:22-27` and `createInboundTransportHost.ts:299-301` skip
arbitration entirely under an external dispatcher, so nothing below speaks to the durable path
(§5 Q3, §1's named risk). All three remain unchecked by run.

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

The same guard is also a constraint the epic did not record: **with an honest principal, a
session can only be addressed by its own owner.** Every cross-user reading of §1's "two
top-level sessions keep each other informed" meets an existing refusal. That belongs in §5 Q1's
evidence, not §1's objective — the ask does not change, its boundary does.

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
comfortably inside the arbiter's 30 s admission budget, so this run says nothing about whether a
queued delivery survives a *long*-busy recipient (theme 14, §1's named risk).

**Changed:** nothing in §1's objective, §4, or the five-issue division. All three premises held.
What changed is theme 6 and the addition of theme 14, both by owner amendment rather than by the
run — the run supplies their evidence. Q3's other contribution is negative and useful: the
long-busy case is still unchecked, and issue 2's spec should check it rather than inherit it.
Q1's cross-user refusal has been promoted from evidence here to a stated boundary in §1.

---

## 4. Running index

The durable audit log for the set. **Nothing below is filed yet** — the owner gates the
objective before the set is created as sub-issues, so every row is a proposal and every issue
cell is empty by design, not by omission.

| # | Proposed issue | What it delivers | Depends on | Linear | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|---|---|---|
| 1 | The address, the send verb, and what a sender may legally address | `to` on the envelope, the send verb, both send modes, **acceptance as the acknowledgement on both** (theme 6) and the **sender-side answer timeout, default 30 min** (theme 14), the self-addressed refusal, and the agent-facing tool — core + engine + tools | — | not filed | spec | — | — | Proposed |
| 2 | Per-adapter delivery | in-process for a Node host; through the `FlowDispatcher` seam so a queue-backed deployment gets durability for free | 1 | not filed | spec | — | — | Proposed |
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
gets nothing. **That 30 seconds is an admission budget, not a sender's timeout** — theme 14, and
this epic does not propose changing it. Two options:

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
  budget (deliberately unchanged) from a sender-side **answer** timeout defaulting to 30 minutes.
  Cross-session progress polling recorded as future direction with its wall (theme 10);
  **cross-user messaging stated as out of scope in §1** — same-owner only in v1. Q3 added to the
  POC and run: delivery outlives the sending request (CONFIRMED), and acceptance resolves while
  the message is still queued.
