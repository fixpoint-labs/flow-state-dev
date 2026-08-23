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
rather than keeping a transport of its own, and that a spawn verb belongs beside a send verb
because **spawn supplies the address the send verb consumes** (the issue-3 paragraph below). It
certifies **no** issue's contracts: the noun the config group is called is still open (§5 Q2), and
the division in §4 — **six proposed issues** — is a proposal. **The gate is the last cheap moment
to redraw the set** — after it, redrawing costs specs already written. **No composition question
is left open:** the "swap issue 3 for issue 6" proposal is **retracted**, and whether issue 5
rides inside this epic is **decided** (§5 Q5, coordinator's call, reversible by the owner). Both
are recorded in §4's composition note rather than smoothed away.

**The address and the door are both settled now.** The owner has stated the address:
**a recipient is a `sessionId`**, and a sender is identified by its own `sessionId` — possibly
carrying the `requestId` of the sending request as well (an issue-1 spec detail, §5 Q1b). Messages
never travel from one user to another.

**And the door — the epic's load-bearing fork — is decided: it is asymmetric** *(owner, 2026-08-23:
"Yes, inside world verb/asymmetric door is right")*. **A sibling resolves `flow.actions`** — it *is*
a caller. **A workstream gets a narrow, author-declared inside-world surface** and never reaches
`flow.actions`. That is not a new security concept: it **extends an invariant the system already
enforces**, `flow.workstream`'s terminal resolution — *"an absent core is a named refusal and never
falls through to actions"* (`packages/core/src/types/flow.ts:549-557`, `:562`). What is new is only
that the inside-world surface becomes **declared** rather than framework-derived (theme 16, §5 Q1's
closed record). **The objective gate is therefore asking about the objective and the division, not
about an unanswered fork.**

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

**The set contains no consumer of its own objective — and the watch seam would be one. Raised at
the gate by the coordinator, not by the owner, because nobody has made this argument.** The five
original issues build a verb plus four adjacent things; the proof that the send verb is *useful*
lives outside the epic, in Conductor. The proposed watch seam (issue 6, §4) — a general one-off
notification primitive whose *first consumer* is the task board — is a direct consumer of the
objective sentence above: an event fires → a message reaches a session that was not running →
something happens. That is an end-to-end goal check on the real path, landing in
precisely the blank spot the paragraph above measures — where `goals/**` covers neither scheduled
dispatch nor concurrency arbitration. **Recorded as an argument for inclusion, not a decision.**
The gate answers it.

**Holistic necessity — and it now runs in both directions.** *(Two reviewers want the set smaller;
the owner has made it larger — and has kept issue 3 in. §4's composition note states that tension;
the coordinator's earlier "swap spawn for watch" resolution is **retracted**, because it rested on
a wrong premise about why spawn is in the set. This paragraph covers only the original cut
candidates.)* The cut candidate is issue 5, the `pending
feedback` task status: a task-board addition, not a messaging one. It stays because theme 5 —
the reply arrives as a new inbound message, nothing suspends — only works if a task can be
*parked* while its request ends. Without it a workstream that asks either holds a loop open or
loses its place, and the headline case does not land. It also depends on nothing, so carrying it
costs the set no sequencing.

**That necessity is now settled by run rather than argued.** §3's settlement took the
counter-claim — that the board's existing `awaitReview` / `resumeFromReview` already covers the
cold path — and **refuted** it: parking works and resuming works, but a parked task holds its
launching request open, so *the request may end* is not available today. **Where it is filed is
now decided too** — inside this epic, as issue 5 (§5 Q5, coordinator's call on 2026-08-23,
reversible by the owner): it is the set's only unblocked issue and theme 5's headline case depends
on it, so pointing at it from another epic buys taxonomy at the cost of sequencing.

**Issue 3, the sibling-spawn verb, is in the set because messages cross sessions.** *(Corrected by
the owner. The reasoning previously recorded here was the coordinator's, and it was wrong.)* Spawn
is the **address-supply side of cross-session messaging**: if a session can message a peer, it
needs a way to mint the peer it will address. Without spawn, cross-session messaging only ever
reaches sessions that some outside-world caller happened to create — the layer could send, but
could not bring a recipient into existence. That is **the messaging model completing itself**, not
a task-board concern and not implementation economy.

**Retracted: the "same missing layer" argument, and the swap it licensed.** This paragraph
previously kept issue 3 on *implementation economy* — same addressing, same per-adapter delivery,
so building it later means touching both again — and on that premise the coordinator proposed
**swapping issue 3 out for the watch seam**. Two bot reviewers (a cursor Grok pass and
chatgpt-codex) had each independently recommended cutting issue 3, and the coordinator agreed with
them. All three were reasoning from the wrong premise about *why* issue 3 is in the set. The
owner's reason supersedes; **issue 3 stays**, and the swap proposal is withdrawn wherever it
appeared (§1, §4's index, §4's composition note, §5, and the PR description).

**Tripwire, unchanged:** if issue 3 grows a delivery path of its own, it should have been its own
epic and should be pulled out rather than absorbed.

**Deliberately not doing** — named, not silent:

- **Fan-out. Ruled out, not deferred.** A request runs in a session, and nothing is processed
  without one, so an unaddressed message has nowhere to run. Delivering to every interested
  party would mean inventing a session per subscriber — *spawning work* wearing delivery's name.
  Even "a fresh session" is a named recipient. FIX-441's `NotificationFlow` subscriber shape is
  exactly this (§4). **A watch registry is not this**, and it is stated once — in §4's issue-6
  section — so it is not re-litigated: every subscription names its recipient's `sessionId` **at
  registration time**, so N subscriptions are N *addressed* deliveries. The banned shape is an
  unaddressed message with no session to run in.
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
admission budget is in scope** — **issue 1** (§4), theme 14. It is small: `Infinity`/omitted
already disables the timeout in the shipped gate, and Q4 ran the same scenario through it and the
delivery landed. Nothing about the *durable* path changes; that stays FIX-830's.

**It sits on issue 1, not issue 2 — a correction, recorded because the earlier text said issue 2.**
Issue 2 depends on issue 1 and theme 13 requires issue 1 to land first, so filing the budget on
issue 2 would ship an acknowledged send API while the 30-second admission budget is still
hardcoded — which is exactly the accepted-then-silently-dropped delivery this paragraph forbids.
The receipt and the budget need each other (theme 14), so they land together. Q4 proved the fix
is one parameter threaded through an option `createInboundTransportHost` already accepts
(`:106-113`), so moving it costs issue 1 almost nothing and costs issue 2 a dependency it no
longer needs.

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
   inside-world surface is a **sibling of an existing pattern**, not a novel concept.
   ***Which* door it is: decided — asymmetric, theme 16.** *(Was §5 Q1, closed by the owner on
   2026-08-23.)* The declared `relay?` group is that sibling, and it is the flow's first
   **authored** inside-world surface.

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
   and 5**, and issue 5 is what makes the workstream half representable at all — settled by run,
   not assumed: the board's existing park holds its launching request open (§3's settlement). Because the
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
    issue that finds itself adding a message field to a task row has hit this line. **Proposed
    issue 6 (watch) touches that line deliberately and stays on the right side of it:** the board
    **emits** — which it already does, `TASK_CHANGE_COMPONENT_TYPE = "task-change"`
    (`packages/orchestration/src/tasks/collection/get-or-create.ts:29-30`) — the **watch manager**
    matches, and Relay **delivers**. The row records nothing about the message and the message
    carries no board semantics. An issue-6 spec that stores message state on the row, or that adds
    a *new* emit to the board, has crossed here.

    **Which is why the watch manager lives in `engine`, not `orchestration`.** *(Decided — D4,
    §4's issue-6 decisions.)* Both of the owner's named event sources have to reach it, and one of
    them — the resource registry's `onResourceChanged`
    (`packages/engine/src/context/resource-registry.ts:545`) — is in `engine`. `orchestration`
    becomes a **consumer** that forwards the `task-change` event it already emits. That placement
    is what keeps the board single-writer instead of growing a delivery responsibility. The same
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

    **Proposed issue 6 (watch) joins the first group** — it consumes the send verb rather than
    building a second delivery path, so it cannot merge before issue 1 either. **It carries no
    spec-ordering constraint against issue 5.** *(Corrected: it did, as §5 Q6b.)* Under the
    notification-primitive model watch touches **no** board internals — the board only emits, which
    it already does — so Q6b is withdrawn and **issue 5 is free-standing again**, for spec purposes
    as well as merge order.

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

    **Constrains issue 1, which now owns both halves** — the receipt *and* the configurable budget
    (see §4). *(Corrected: this theme previously assigned the budget to issue 2.)* The reason is
    the sentence directly above — shipping the receipt without the budget is what produces a
    silent drop the sender was told was fine — and theme 13 puts issue 1 first, so a split across
    the two issues would guarantee exactly that window. Issue 2 still owns per-adapter delivery
    and consumes the parameter; issue 4 inherits it, since a schedule that waits for an answer is
    the same shape.

15. **Watch is the asynchronous, cross-session, runtime-registered sibling of `reactTo` — one
    event vocabulary, not two.** *(Added by owner amendment. The model is the owner's; this framing
    and the prior-art citations are the coordinator's, verified by read.)*

    **"When this event fires, run this bound thing" already exists — synchronously.** `reactTo`
    (`packages/engine/src/context/reactive-dispatch.ts:1-17`) resolves the bound block for a change
    kind, builds the `ResourceChange` payload, gates it through an optional `when` predicate and a
    per-request cascade controller, validates it against the block's `inputSchema`, and runs the
    block **in-session, awaited inline as part of the mutating turn**, with a throw propagating
    atomically. Caps are hard-coded: `MAX_CASCADE_DEPTH` 8, `MAX_CASCADE_FANOUT` 1000 (`:43-46`).

    **Watch is the same sentence with three words changed.** `reactTo` is *statically declared by
    the flow author*, fires *in the same turn*, in *the same session*. Watch is *registered at
    runtime*, fires *after the turn*, and delivers to *a different session*. Same event vocabulary;
    different binding time, different delivery.

    **This is what right-sizes issue 6.** Only three things are genuinely new: **(a)** the durable
    subscription registry, **(b)** a matcher that runs **outside** the mutating turn, **(c)**
    delivery as an **addressed relay message** rather than an inline block call. Everything else —
    the events, the payload shape, the predicate idiom — is already shipped and already consumed.

    **Coherence requirement, binding on issue 6's spec:** reuse `reactTo`'s change-payload shape
    and predicate idiom rather than inventing a second vocabulary for the same events. Two ways to
    describe one `resource_change` in one codebase is exactly the incoherence this theme exists to
    prevent. **Constrains issue 6**, and constrains any later consumer of the primitive.

16. **The door is asymmetric: a sibling resolves `flow.actions`; a workstream gets a narrow,
    declared inside-world surface.** *(Decided by the **owner**, 2026-08-23 — "Yes, inside world
    verb/asymmetric door is right." This closes §5 Q1, the epic's load-bearing fork; the closed
    record with the full reasoning is kept there.)*

    **The two halves get different doors, and that is the point.** A **sibling** is a caller — its
    own flow kind, nobody's child — so `flow.actions` is its natural entry. A **workstream** is
    not, and must never reach a caller-addressed action.

    **This extends an invariant that already exists and is already enforced — the cheap half.**
    `packages/core/src/types/flow.ts:562`, `workstream?: ActionCore`, is *"the single pre-assembled
    entry a detached dispatch resolves"* (FIX-999), and its doc comment states the rule at
    `:549-557`: *"resolution for the detached source is **terminal**, so an absent core is a named
    refusal and never falls through to {@link actions}. That is the security invariant — a detached
    dispatch must have no route to a caller-addressed action."* We are **widening one core to a
    declared set**, not inventing a security concept. Terminal resolution is unchanged.

    **The wrinkle, and the call on it — the surface must be *declared*, not derived.**
    *(Coordinator's engineering call, reversible by the owner.)* The same doc comment,
    `flow.ts:559-560`: *"Not an app-author surface. It is assembled by the framework from a board's
    drain bindings; nothing is declared to get one."* Today's inside-world surface is **derived**.
    A relay-receivable action cannot be: *"another session may address this by name"* is not
    inferable from block structure the way a drain binding is. So: **reuse the terminal-resolution
    mechanism, add a declared `relay?` group** — the owner's own naming (§5 Q2). `workstream` stays
    framework-assembled; **`relay?` becomes the flow's first authored inside-world surface**, the
    sibling of `webhooks?` / `schedules?` theme 3 anticipated. **Do not attempt to derive it** —
    inference would either under-declare (a message with nowhere to land) or over-declare (the
    wider door, opened by accident), and both fail silently.

    **Constrains issues 1, 3 and 6.** Issue 1 builds both doors and owns the promoted acceptance
    criterion in §4 (the recipient's `flowKind` is looked up, never asserted). Issue 3's sibling
    lands on `flow.actions` by construction. Issue 6's watch-callback action lands on the narrow
    surface by construction.

---

## 3. Shape of the whole *(POC)*

**Built:** a characterization POC of the four things the design was asserting from a code read —
that a running block can re-enter `host.dispatch` onto another live session, that a self-addressed
wait deadlocks, that a queued delivery outlives the request that sent it, and that the arbiter's
admission budget does or does not drop an already-accepted delivery. Not an end-state POC: the
division in §4 is still unchecked against an assembled surface, and §5 Q1 was a design
question no run settles *(since closed by the owner — theme 16)*.

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

**Changed:** nothing in §1's objective, and no re-division — **the five issues stand** *(true of
this run; the set has since been proposed at six — §4)*. What moved
is one scope cell and one theme. **Theme 14 is corrected, not extended:** it had recorded the
30 s constant as a deliberate *non-change* on the reasoning that a verb acking on `accepted` is
never inside the arbiter's wait; Q4 superseded that reasoning — the budget bounds the delivery,
not the caller — so a **configurable admission budget is now in scope**, on **issue 2** (§4)
*— superseded: the budget was later moved to **issue 1**, see theme 14 and §4* — and §1's named
risk says so. The two-clocks half of theme 14 stands, and Q2's phantom-record cost
still argues against merely *raising* the number: a longer wrong number is still a wrong number.
Theme 6 and theme 14's addition were owner amendments rather than run outcomes; the runs supply
their evidence. Q1's cross-user refusal was promoted from evidence here to §1, where the owner has
since restated it as a **design invariant** — never a user-to-user send — rather than a boundary
the design leans on.

### Settlement — does the board's existing park already cover the cold path? **REFUTED.**

**A settlement, not a fifth characterization check.** Q1–Q4 above are characterization: the
design was asserting things from a code read, so the POC ran them. This is a different
instrument with a different trigger — two bot reviewers asserted **opposite** answers about how
the shipped code behaves, the claim was argued twice, and it was run to a verdict rather than
argued a third time ([`orchestration.md`](../../docs/contributing/orchestration.md) → "Settling
a disputed claim"). It costs the epic PR no review round. It is recorded here so a sibling issue
cannot reopen it.

**The claim.** The task board's existing parked-task mechanism (`awaitReview` /
`resumeFromReview`) already supports the cold path — a worker parks a task, **its request ends**,
and a later separate request resumes it — so a new `pending feedback` status is unnecessary.

**Verdict: REFUTED.** The *request ends* half is false. The gap is real, and **issue 5 stays in
the set on its merits** rather than on theme 5's assertion.

**What ran** — two throwaway vitest scenarios on the real `taskBoard` / `awaitReview` /
`resumeFromReview` path:

| scenario | observed |
|---|---|
| **(A)** park and never resume | `elapsedMs=840 drainSettled=true finalStatus=awaiting_review` — the drain returns only when its iteration budget is silently exhausted, abandoning the task mid-park |
| **(B)** park, checkpoint at 120 ms, then resume | `drainSettledBeforeResume=false drainDoneAfterResume=true` |

**Anti-game check — this is what makes the verdict trustworthy.** Moving the resume *before* the
checkpoint flips `drainSettledBeforeResume` to `true` and fails the assertion. So (B)
discriminates real timing rather than hard-coding its own result.

**Mechanism.** `awaiting_review` is the one non-terminal status deliberately excluded from every
board-exit path (`boardQuiescence` / `inFlightCount` in `quiescence.ts` / `shared.ts`), so the
launching request's `.waitForCondition` stays open for the whole parked duration — in both
`onIdle` modes, and on a detached board too.

**First-party corroboration**, `packages/orchestration/src/task-board/shared.ts:140-144`: *"an
`awaiting_review` row is parked for an external actor whichever way it was dispatched… it keeps
holding the drain open. A detached board that parks for review therefore still blocks its
launching request; closing that is a separate question… not this one."*

**And it is already asserted in a committed test.**
`test/task-board/durable-board-freshness.test.ts` asserts `drainDoneBeforeResume === false`;
re-run clean (67 files / 1170 tests pass).

**What the counter-assertion got right — recorded so the verdict is not read wider than it is.**
The *resume* half works. `resumeFromReview` writes `task.feedback`, and `buildWorkerInput`
(`blocks/worker-step.ts`) spreads `feedback: task.feedback` onto the re-claimed worker's input,
delivered as a plain string. Only *the request ends* is false.

**Two secondary findings, both favourable to issue 5, with their honesty labels:**

- **Ran.** A parked row's lease is neither reclaimed nor needs renewal — `leaseLapsed`
  (`tasks/collection/internal.ts:531-534`) short-circuits to `false` for any non-`in_progress`
  status, by explicit design. A slow human cannot have the task reclaimed or retried out from
  under them.
- **Reasoned, not run.** Restart survival follows from the store adapter's general durability
  guarantee: parked state (`status`, `feedback`, `leaseUntil`) lives in the ordinary
  resource-backed collection store, and nothing about parking is in-memory-only. **Not verified
  by execution** — do not read it as such.

**The residual gap issue 5 must build** — the useful output of the settlement: **a park mode that
does not hold the drain's own request open.** Either an exit path that lets `boardQuiescence`
return something other than "continue" while a task sits parked, or routing review-parking
through the same `runsElsewhere` exclusion that detached dispatch already gets for
`in_progress`.

**Changed:** §1's necessity check now rests on evidence; §4's issue-5 cell carries the residual
gap; §5 **Q5's necessity half is settled and its placement half is not**. **No re-division — the
five issues stand** *(true of this settlement; the owner has since proposed a sixth. The
issue-5/issue-6 collision once recorded here as **§5 Q6b is withdrawn** — under the
notification-primitive model watch touches no board internals, so issue 5's residual gap is issue
5's alone.)*

---

## 4. Running index

The durable audit log for the set. **Nothing below is filed yet** — the owner gates the
objective before the set is created as sub-issues, so every row is a proposal and every issue
cell is empty by design, not by omission.

| # | Proposed issue | What it delivers | Depends on | Linear | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|---|---|---|
| 1 | The address, the send verb, and what a sender may legally address | the recipient address as a **`sessionId`** on the envelope, a **server-derived sender identity** (its `sessionId`, and possibly the sending `requestId` — open, §5 Q1b), the send verb, both send modes **and the reply-correlation identifier wait-for-response requires** (theme 6, §5 Q1b), **acceptance as the acknowledgement on both** (theme 6) and the **sender-side answer timeout, default 30 min** (theme 14), **the configurable in-process admission budget** (theme 14, §3 Q4 — *moved here from issue 2*: the receipt and the budget ship together or the send API acks deliveries the arbiter can still silently drop, and theme 13 lands this issue first), the self-addressed refusal, and the agent-facing tool — core + engine + tools. **The door is decided (theme 16, owner): both of them** — a sibling resolves `flow.actions`; a workstream resolves a **declared `relay?` group** reusing `flow.workstream`'s terminal resolution. **Acceptance criterion, promoted from an implementer note:** the recipient's **`flowKind` is looked up from the session record, never asserted by the sender** | — | not filed | spec | — | — | Proposed |
| 2 | Per-adapter delivery | in-process for a Node host; through the `FlowDispatcher` seam so a queue-backed deployment gets durability for free. **The configurable admission budget is no longer here** — it moved to issue 1 (theme 14); issue 2 consumes the parameter rather than introducing it | 1 | not filed | spec | — | — | Proposed |
| 3 | The sibling-spawn verb — **address supply for cross-session messaging** | an independent, self-managing session with its own flow kind and addressable key, resolving `flow.actions` like any other caller and talking back by message rather than `settleParentTask`. **In the set because messages cross sessions** (§1, owner): spawn mints the peer the send verb will address; without it, messaging only ever reaches sessions an outside-world caller happened to create. *(The earlier "same missing layer" / implementation-economy rationale, and the swap-out proposal it licensed, are retracted — §1.)* | 1 | not filed | spec | — | — | Proposed |
| 4 | Cron: a schedule addresses a session and fires as a message | the schema field, the resolver, and the one dispatch envelope; absent address preserves today's behaviour exactly | 1 | not filed | spec | — | — | Proposed |
| 5 | A `pending feedback` task status | "parked awaiting external input; the request may end; a later request resumes this task" — a genuine addition, not a rename of `awaiting_review`. **Necessity settled by run, not asserted** (§3's settlement, REFUTED): today's `awaitReview` parks and `resumeFromReview` resumes, but `awaiting_review` is excluded from every board-exit path, so the launching request stays open for the whole park. **The residual gap to build:** a park mode that does not hold the drain's own request open — either an exit path letting `boardQuiescence` stop returning "continue" while a task sits parked, or routing review-parking through the same `runsElsewhere` exclusion detached dispatch already gets for `in_progress`. **No collision with issue 6** — *corrected;* one was recorded as §5 Q6b and is withdrawn, because watch touches no board internals. Issue 5 owns this surface alone and depends on nothing | — | not filed | spec | — | — | Proposed |
| 6 | **Watch — a general one-off notification primitive** *(owner-proposed 2026-08-21; **redefined by the owner 2026-08-23** — it is **not** a task primitive)* | a durable **subscription registry**, an **event matcher**, and **delivery as an addressed relay message**. An entry says *when this event fires holding this value, call this flow for this session id*; a **relay action matching that event** must be defined on the recipient to receive the payload; the subscription is **one-off** and unsubscribes on fire. **The task board is its first consumer, not its subject** — a completing task forwards the `task-change` event it already emits; an updated resource value is the second named source. **Three of its four parts already ship** (theme 15: watch is `reactTo`'s async, cross-session, runtime-registered sibling); what is new is the registry, a matcher running outside the mutating turn, and addressed delivery. **Four calls already decided** — D1 satisfied-or-attach registration · D2 exact-match on identity key + event name · D3 TTL whose expiry *delivers* · D4 the manager lives in `engine` | 1 | not filed | spec | — | — | **Proposed (owner)** |

**The agent-facing tool is deliberately inside issue 1, not beside it.** The constraint is that
the programmatic sender and the tool are the *same verb*, differing only in who calls them.
Co-location is the strongest guarantee against the two drifting apart.

**Promoted to issue 1's acceptance criteria: the recipient's `flowKind` is looked up from the
session record, never asserted by the sender.** *(Promoted 2026-08-23 — by the door decision, not
by a new finding. It has been in the record since a codex round-5 P1 implementer note, and nothing
about the note changed.)* **What changed is its status.** Under a single door, asserting the
recipient's kind was a hygiene problem: the sender could describe its recipient wrongly and get a
confusing failure. **Under an asymmetric door it is structural** — the server must now decide
*which door to open*, which makes the recipient's kind a **routing decision**, and BP-031 is
categorical that routing is never derived from caller-controllable input. A sender able to assert
its own recipient's kind could **select the wider door**. That is not a note for the implementer to
weigh; it is a condition issue 1 is not done without.

### Issue 6 — watch, a general one-off notification primitive

**Redefined by the owner (2026-08-23). The earlier framing is superseded.** Issue 6 entered the set
on 2026-08-21 as *"register interest in a task-board row"*. That was too narrow: it made watch a
**task** primitive. The owner's definition is canonical and is quoted rather than paraphrased:

> "Fundamentally watch should be conceived not as a task primitive but as a more reusable
> notification primitive. It's a one off subscription. Something happens, a watcher was attached to
> that thing, tell the watcher (or watchers) the thing happened, unsubscribe. A task is completed,
> a resource value was updated, etc. we should build something that is simple as it needs to be and
> versatile enough to be reused whenever we need to wait on something else."

And the mechanism, also theirs, treated as the shape:

> "There is a subscription/watch resource holding onto subscriptions. An entry is created by saying
> when this event is fired holding this value, call this flow for this session id. A relay action
> matching that event must be defined to receive the payload of that event. When a task completes,
> it sends its event to the watch manager which handles the flow relay calling."

**So issue 6 is a durable subscription registry + an event matcher + delivery as an addressed relay
message.** The task board is its **first consumer, not its subject**. That is also what makes it sit
cleanly inside this epic: the delivery leg *is* issue 1's send verb.

#### It is much smaller than it reads — three of its four parts already exist

Verified by read in this session and cited with `file:line` so an issue-6 spec does not re-derive
any of it.

1. **A task change is already an event.** `TASK_CHANGE_COMPONENT_TYPE = "task-change"`
   (`packages/orchestration/src/tasks/collection/get-or-create.ts:29-30`), documented as the
   *"component-item type emitted on every task lifecycle transition"*, carrying
   `TaskChangeEvent { collectionId, taskId, kind, task, prevStatus }`
   (`packages/orchestration/src/tasks/collection/change-event.ts:37-44`), and already consumed as a
   wake predicate by `onTaskChangeFor`
   (`packages/orchestration/src/tasks/collection/predicates.ts:32-41`). **The board needs no new
   emit.** The owner's *"it sends its event to the watch manager"* is already half-built.
2. **A resource change is already an event.** `onResourceChanged`
   (`packages/engine/src/context/resource-registry.ts:545`) threads a change descriptor carrying the
   `storageKey`, a kind (`created` / `updated`), a live projection and `{ state, prevState }`
   (`resource-registry.ts:1205-1210`), wired per scope in `createExecutionContext.ts:2137-2170`. The
   owner's second named source also already emits.
3. **"When this event fires, run this bound thing" already exists — synchronously.** `reactTo` /
   `reactive-dispatch.ts` (FIX-751 PR2): it resolves the bound block for the change kind, builds the
   `ResourceChange` payload, gates it through an optional `when` predicate and a per-request cascade
   controller, validates against the block's `inputSchema`, and runs the block **in-session, awaited
   inline as part of the mutating turn**, throws propagating atomically. Caps `MAX_CASCADE_DEPTH` 8
   and `MAX_CASCADE_FANOUT` 1000 (`reactive-dispatch.ts:1-17`, `:43-46`).

**The clearest statement of what issue 6 is — theme 15:** *watch is the asynchronous, cross-session,
runtime-registered sibling of `reactTo`.* `reactTo` is statically declared by the flow author, fires
in the same turn, in the same session. Watch is registered at runtime, fires after the turn, and
delivers to a different session. **Same event vocabulary; different binding time, different
delivery.**

**What is genuinely new is only three things:** **(a)** the durable subscription registry, **(b)** a
matcher that runs **outside** the mutating turn, **(c)** delivery as an **addressed relay message**
rather than an inline block call. Said explicitly because it is what right-sizes the issue.

**Coherence requirement for issue 6's spec** (theme 15): reuse `reactTo`'s change-payload shape and
predicate idiom rather than inventing a second vocabulary for the same events.

#### The four calls the coordinator has already decided

Engineering decisions on the owner's model, recorded as **decided** rather than as open questions
(EM posture). Each is the coordinator's and each is reversible by the owner.

**D1 — the primitive is *"notify me when this becomes true, or immediately if it already is"*, not
*"notify me on the next matching event."*** The register/settle race verified in §3 does not go away
under the new model — it **generalizes**. Both task-board backings commit the terminal state inside
the serialized / CAS write and call `emit(...)` **after it, outside the lock**
(`packages/orchestration/src/tasks/collection/resource-backed.ts:450-474`;
`sequencer-backed.ts:264-338`). A subscription registered in that window attaches to something that
will never transition again. Subscribing to a condition that may already hold is the classic
subscribe-after-the-fact race, and it recurs for **every** event source, not just tasks.

So: **registration reads the current state and either attaches (not yet satisfied) or immediately
enqueues the delivery (already satisfied), atomically.** That makes the deadlock-shaped failure
**unrepresentable** rather than documented — theme 7's standing rule, applied to a second mechanism.

**The price, named honestly:** the primitive is then **not purely event-source-agnostic**. Each
source must supply a small *"is this already satisfied?"* read adapter. That is the actual cost of
the versatility the owner asked for. **The rejected alternative** — a dumb "notify on next matching
event" primitive, with check-then-register pushed onto every caller — is cheaper *in the primitive*
and buys a footgun *per source*, one that produces a watcher waiting forever on a thing that already
happened. The adapter wins because its cost is paid once per source by the framework, while the
footgun would be paid every time by a consumer.

**D2 — the match is exact-match on an identity key + event name. Not a predicate language.** Entries
stay plain serializable data (a `taskId`, a `storageKey`). A general content-based matcher over an
event stream is an **event bus with content routing**, which this epic has ruled out (§1, fan-out).
`reactTo`'s `when` predicate remains the escape hatch for the **synchronous, statically-declared**
case — it runs in-process against a declared binding and never needs serializing.

**D3 — lifetime: a TTL field on the entry, and expiry *delivers* rather than drops.** *(This closes
§5 Q6, the owner's own open question.)* One-off plus unsubscribe-on-fire self-cleans the common
case. What leaks is the **never-fires** case, and the owner correctly called never-settles *the
ordinary shape of abandoned work*, not an edge. A **TTL checked on read/match needs no sweeper**. On
expiry, deliver an `expired` outcome to the watcher instead of silently dropping it: it costs
nothing and turns a leak into a signal a live watcher can act on.

**D4 — the watch manager lives in `engine`, not `orchestration`.** Both named event sources must
reach it, and the resource registry is in `engine`. `orchestration` becomes a **consumer** that
forwards its existing `task-change` event. This also preserves the boundary the owner set (theme
11): the board **triggers**, Relay **delivers**; the board records nothing about the message and
stays single-writer.

#### Why polling cannot cover it — verified, not asserted

The interested party is not running. `countWaitable`
(`packages/orchestration/src/task-board/shared.ts:184-198`) does
`if (isHandedOff(row, now, runsElsewhere)) continue;` at `:195`, and its doc comment states the
intent plainly: *"Count rows in `statuses`, minus the `in_progress` ones `runsElsewhere` places
outside this drain."* `isHandedOff` (`shared.ts:111-120`, FIX-1074, *"One predicate, one answer"*)
returns true for an `in_progress` row that `runsElsewhere` claims and whose lease has not lapsed. So
the launching board **does not wait** for a handed-off row — it reports the hand-off and retires.
When the workstream settles later, there is provably nobody there. **This is stated design, not an
oversight**, which is why the answer is a registry rather than a longer poll.

#### Nothing existing covers it

The owner's survey, recorded so an issue-6 spec does not repeat it. *(`reactTo` and `resource_change`
are the two rows that changed meaning under the redefinition: they are no longer merely "not this" —
they are the **prior art** the primitive is modelled on, and the reason it is small.)*

| Surface | Why it is not this |
|---|---|
| `ctx.requestHost` | The whole cross-session surface, and it is closed at four verbs with no watch among them (`packages/core/src/types/request-host.ts:218-273`) |
| `parentTask()` | *"one coordinate, one row"* (`request-host.ts:240-241`) — the row **you** were assigned, not one you are interested in |
| `livenessOf` | An optional hint by its own doc, and lineage-filtered (`request-host.ts:256-273`, theme 10) |
| `ctx.response.subscribeToItems` | *"on this response"* (`packages/core/src/types/block.ts:123`, `:141`) — the same request, which is the one thing not available |
| `.waitForCondition` | Needs a response emitter and **holds the caller open** (`packages/core/src/blocks/sequencer-methods.ts:370`) — again the thing not available |
| `reactTo` | Runs *"in-session — awaited inline as part of the mutating turn"* (`packages/engine/src/context/reactive-dispatch.ts:9`), so a child settling fires it in the **child's** turn. **The sibling, not the answer** — theme 15 |
| `resource_change` | Reaches whoever streams the *mutating* request (`packages/engine/src/context/resource-registry.ts:749`) — the child's SSE, not the parent's session. **A source the watch manager consumes**, not a delivery path |

#### It respects both epic boundaries

***No fan-out* (§1).** Each subscription names **one** recipient's `sessionId` **at registration
time**, so three watchers are **three addressed deliveries, not one broadcast**. The registry is
many-holders and every delivery is one-to-one. Stated here once so it is not re-litigated as a
fan-out violation: the banned shape is an *unaddressed* message with no session to run in, and this
has an address on every entry by construction.

***Messages do not ride the board* (theme 11).** The board **emits** what it already emits, the
watch manager matches, and Relay delivers. The row records nothing about the message and the message
carries no board semantics.

**A consumer is already hand-rolling it.** **LAB-138** (*"The harness manager — a task row becomes a
watched, settled coding run"*, Backlog) specifies a done-condition predicate *"re-evaluated on each
wake (not computed once)"* and instructs the dispatcher to *"treat a liveness check as a hint, never
proof — corroborate against the durable row before re-dispatching."* That is a dispatcher polling a
row it owns because **registering interest is not expressible**.

**It consumes issue 1's verb rather than building a second delivery path**, which is what keeps it
from becoming the parallel seam `RequestHost` is being cleaned of elsewhere (FIX-1124). An issue-6
spec that grows its own delivery has left the epic's shape, exactly as issue 3's tripwire says.

**And it lands on the narrow door by construction** — a watch-callback relay action is a pure
inside-world verb, so it is declared in the `relay?` group and is never reachable from
`flow.actions` (theme 16). Nothing for issue 6's spec to decide here.

### Composition — the set is six, and the swap proposal is retracted

Stated rather than smoothed, because the gate is where it gets answered.

- **Smaller.** Two independent reviewers recommended cutting to **three** issues: drop
  sibling-spawn (issue 3), externalise `pending feedback` (issue 5, §5 Q5's placement half).
- **Larger.** The owner added the watch seam (issue 6), and has **kept issue 3 in**.

**Retracted — the coordinator's "swap rather than grow: watch in, sibling-spawn out" proposal.**
It argued fit-to-the-objective: spawn *creates* a session while watch *reaches one that is not
running*, and the owner, the coordinator and two reviewers had all seemed to judge spawn the
weakest fit. **The premise was wrong.** The coordinator's stated reason for issue 3 being in the
set — implementation economy, "the same missing layer" — was never the owner's reason. Spawn is
the **address-supply side of cross-session messaging**: it mints the peer the send verb will
address (§1). The two bot reviewers were reasoning from that same wrong premise, and so was the
coordinator when it agreed with them. **Issue 3 stays on the owner's reason**, and no swap is on
the table.

**And the last composition question is closed too.** Whether `pending feedback` (issue 5) rides
inside this epic or is filed outside it with a `relates-to` is **decided: inside** (§5 Q5,
coordinator's call on 2026-08-23, reversible by the owner). It is the set's only unblocked issue,
and theme 5's headline case depends on it, so filing it outside would make the epic depend on
another container for its own leading story. The reviewer's composition argument is kept in Q5's
record rather than dropped — the cost of being wrong is that the set reads as two epics in
retrospect, which is a documentation cost and not a rework one.

**So the set is six, no composition question is open, and the gate approves that division.**

Epic PR (this doc, never merged):
[#1357](https://github.com/fixpoint-labs/flow-state-dev/pull/1357).

### The relationship map — issues this epic touches but does not contain

| Issue | Relationship |
|---|---|
| **FIX-441** — cross-flow event bus (Backlog) | **Superseded by this epic.** Its `NotificationFlow` fan-out subscriber shape is the thing ruled out in §1. Its own subscriber half was already superseded by FIX-825. Recommend closing as superseded with a pointer here |
| **FIX-1056** — no channel to steer a running workstream (Backlog) | The same seam from the steering side. **Should survive as the carrier**: it holds the evidence and the owner decision. Its decision of 2026-08-10 named the tripwire ("if steering wants a channel that is not a task, the authored-entrypoint question re-opens"); that fork was met and **answered** on 2026-08-23 — theme 16, §5 Q1's closed record |
| **FIX-1075** — inbox capability (Backlog) | The same seam from the receiving side; FIX-1075 says so itself. Folds into issue 1 |
| **LAB-138** — the harness manager (Backlog) | A **consumer already hand-rolling the watch seam**: it polls a row it owns because registering interest is not expressible. Evidence for proposed issue 6, not a dependency of it — LAB-138 keeps working either way, more simply if issue 6 lands |
| **FIX-830** — BullMQ sunset (In Spec Review) | **Constrains**: build to the `FlowDispatcher` seam (theme 1). Also owns durable arbitration, which is why §5 Q3 does not pull it inward |
| **FIX-1124** — delete `parentTask`/`settleParentTask` from `RequestHost` | No direct conflict, but it sets the precedent theme 9 encodes: a stateless verb taking an explicit address is fine, a per-request bound one is not |
| **FIX-1122** — `WorkstreamAddress` | A **board coordinate** `(boardId, coordinate, topic)`, explicitly frozen at that content. **Not** the session address this epic needs; reusable for the workstream-side coordinate only |
| **FIX-1179** — a detached run cannot resume its external session | Related, **not** in the epic. It gates *steer-with-continuity*; the ask direction needs nothing from it |
| **FIX-1171** — a reply arriving as a turn in the originating conversation | Distinct. Under the Strands epic FIX-1169, blocked by FIX-1170 (strand identity) |
| **FIX-765**, **FIX-816** | Adjacent suspension/wait seams that theme 5's "reply as a new message" decision routes around |

---

## 5. Open cross-cutting questions

**Nothing here blocks the objective gate.** Resolved entries stay with their answers — that is what
stops a third issue reopening them. The ledger, so the state is readable without reading the
entries:

| | Status | Who |
|---|---|---|
| **Q1** — what may a sender legally address? | **DECIDED 2026-08-23 — the asymmetric door** (theme 16) | Owner |
| **Q1b** — does the sender's identity carry a `requestId`? | **Open, and scoped to issue 1's spec** — it blocks no other issue and is not a cross-cutting question. Listed here because the case for it was assembled here | Issue 1's spec |
| **Q2** — the name | **Open by the owner's choice** — they want code in front of them first. `relay` is the leaning and theme 16 now uses it for the declared group | Owner, later |
| **Q3** — does anything promise ordering or exclusion? | **Open on the durable path only.** The epic recommends promising nothing beyond the deployed dispatcher and documenting it plainly. Blocks nothing; the in-process half is now scope (theme 14) | Coordinator, if unchallenged |
| **Q4** — which layer does role materialization belong on? | **Deliberately deferred** — decide with real code in front of you. Recorded so a second issue does not re-open it from scratch | Later, with code |
| **Q5** — does `pending feedback` belong in this epic? | **CLOSED 2026-08-23 — both halves.** Needed (settled by run, §3); rides inside, as issue 5 | Run + coordinator |
| **Q6** — what is a watch's own lifetime? | **CLOSED by decision D3** — a TTL whose expiry delivers | Coordinator |
| **Q6b** — do watch and `pending feedback` collide? | **WITHDRAWN** — a consequence of the superseded task-primitive framing | Coordinator |

**Four entries remain open and none of them is a gate question.** Q1b is an issue-1 spec detail,
Q2 is the owner's own deferral, Q3 promises nothing and blocks nothing, and Q4 is explicitly a
later decision. Where the epic has a lean it is marked as a lean rather than a decision.

### ~~Q1. What may a sender legally address?~~ — **DECIDED by the owner, 2026-08-23: the asymmetric door**

**The epic's load-bearing fork, and it is closed.** The owner, verbatim: *"Yes, inside world
verb/asymmetric door is right."* Kept here with its answer so no issue spec reopens it.

**The decision.** The two halves get **different doors**, which is what "asymmetric" names:

| Sender | Door |
|---|---|
| **A sibling session** | resolves **`flow.actions`** like any other caller — it *is* a caller |
| **A workstream** | a **narrow, author-declared inside-world surface** — never `flow.actions` |

**Why this was the fork.** A sibling has its own flow kind, is nobody's child, and enters the way
any caller does. A workstream's only entry today is the terminal, board-derived `flow.workstream`.
Candidate (a) — one door, `flow.actions` for everyone — would have given a detached dispatch a
route to a caller-addressed action, which is the one thing the shipped invariant forbids. Candidate
(b) forced both halves through a new narrow surface, which is a second door for a job the sibling
half already has. The answer is neither: **keep the asymmetry the system already has, and widen
only the inside-world half.**

**The cheap half — this extends an invariant that already exists and is already enforced.**
`packages/core/src/types/flow.ts:562`, `workstream?: ActionCore` — *"The single pre-assembled entry
a detached dispatch resolves"* (FIX-999) — and its doc comment states the invariant directly
(`:549-557`):

> resolution for the detached source is **terminal**, so an absent core is a named refusal and
> never falls through to {@link actions}. That is the security invariant — a detached dispatch must
> have no route to a caller-addressed action.

**We are not inventing a security concept. We are widening one** — from a single pre-assembled core
to a declared set, with terminal resolution unchanged. *(Verified against the tree during this
fold.)*

**The wrinkle, carried because it shapes issue 1.** The same doc comment, `flow.ts:559-560`:

> Not an app-author surface. It is assembled by the framework from a board's drain bindings;
> nothing is declared to get one.

**Today the inside-world surface is *derived*, not declared** — and a relay-receivable action
**cannot** be derived the same way. *"Another session may address this by name"* is not inferable
from block structure the way a drain binding is; there is no structural fact to read it off.

**Decision on the wrinkle (coordinator's engineering call, reversible by the owner): reuse the
terminal-resolution *mechanism*, add a *declared* `relay?` group.** `relay` is the owner's own
naming from §5 Q2. Same invariant, new declaration. **`workstream` stays framework-assembled;
`relay?` becomes the flow's first authored inside-world surface** — the sibling-of-`webhooks?`/
`schedules?` shape theme 3 already anticipated. **Do not attempt to derive it.** An attempt to
infer relay-receivability from block structure would either under-declare (a message with nowhere
to land) or over-declare (the wider door, opened by accident), and both failures are silent.

**What it constrains — theme 16, and issue 1's acceptance criteria in §4.** **Blocks nothing
further:** issue 1's spec is unblocked, and so are 2, 3, 4 and 6.

### Q1b. Does the sender's identity carry a `requestId` as well as a `sessionId`?

**A separate, much smaller question than Q1 — deliberately not merged into it.** Q1 was the door
and is now closed (theme 16); this is one field on the sender's side of the envelope, and it was
never touched by the door decision either way.

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

**Theme 16 now writes `relay?` for the declared inside-world group, and that is not this question
being decided by the back door.** The door decision needed *a* name to be legible; it took the
leaning. **Renaming the group is a find-and-replace on an unshipped surface** — nothing is built,
so the cost of settling Q2 later is unchanged. What theme 16 fixes is the *shape* (a declared
sibling of `webhooks?` / `schedules?` with terminal resolution), not the noun.

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
sender reading `completed`. **Making that budget configurable is in scope** (theme 14, **issue 1**
— moved there from issue 2, see §1 and §4);
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

### ~~Q5. Does `pending feedback` belong in this epic or its own?~~ — **CLOSED. Both halves.**

**Two halves. Necessity was settled by run; placement is now decided too.**

**Settled — that it is needed at all.** It is a dependency of the design either way (theme 5),
and that is no longer an assertion. §3's settlement ran the counter-claim that `awaitReview` /
`resumeFromReview` already covers the cold path and **refuted** it: the park and the resume both
work, but the parked task keeps its launching request open, so *the request may end* is not
available today. Recorded so it is not reopened; the residual gap to build is in §4's issue-5
cell.

**Decided — where it is filed: inside this epic, as issue 5.** *(Coordinator's call, 2026-08-23.
Reversible by the owner. Recorded as a decision rather than surfaced as a fork, because it is a
near-zero-cost composition call and it is the coordinator's to make.)*

**The counter-argument, kept because it is a real one.** A reviewer argued for filing it outside on
composition grounds: it is a task-board addition, not a messaging one, and an epic whose point is a
message layer absorbing a board status is what makes a set harder to reason about later. That
argument survived §3's verdict entirely — proving the status is *necessary* says nothing about
which epic should *own* it.

**Why it rides here anyway.** Two reasons, both about throughput rather than taxonomy. It is the
**only unblocked issue in the set** (theme 13), so filing it outside means the epic's one
day-one-startable piece of work sits in a different container with a `relates-to` pointing at it.
And **the wait-for-response story depends on it**: theme 5's "the reply arrives as a new inbound
message, nothing suspends" only works if a task can be parked while its request ends, so the epic
would be depending on an outside issue for its own headline case. A dependency you own is cheaper
to sequence than one you point at.

**Cost of being wrong:** the set reads as two epics in retrospect. That is a documentation cost,
not a rework cost, which is what makes this the coordinator's call rather than the owner's.
**Blocks nothing.**

### ~~Q6. What is a watch's own lifetime?~~ — **CLOSED by decision D3**

**Raised by the owner when they proposed the seam; closed by the coordinator on 2026-08-23 (EM
posture — an engineering call, reversible by the owner).** Kept here with its answer so an issue-6
spec does not reopen it. The decision itself and its reasoning live in §4's issue-6 decisions (D3).

**The question was two halves.** *Who clears a watch when the watcher dies?* — the watcher is by
definition a session that is not running, and `livenessOf` cannot be that mechanism (theme 10: it
answers only for the caller's own lineage, by design, and this epic does not widen it). And *what
happens when the row never settles?* — stated plainly rather than as an edge case: **a row that
never reaches a terminal state is the ordinary shape of abandoned work**, so a registry with no
lifetime rule **leaks by default**, not exceptionally.

**The answer (D3): a TTL field on the entry, and expiry *delivers* rather than drops.** One-off
plus unsubscribe-on-fire self-cleans the common case, so the only leak is the never-fires case —
which the TTL bounds. **A TTL checked on read/match needs no sweeper**, which is what keeps the
answer small: no background job, no liveness probe, no widening of theme 10. And on expiry the
watcher receives an `expired` outcome rather than silence, which costs nothing and turns a leak
into a signal a live watcher can act on.

**What this does *not* claim.** It does not detect a dead watcher; it bounds the entry's life
instead. A delivery to a session nobody is reading is the same non-event it is anywhere else in
this epic. **Blocks nothing.**

### ~~Q6b. Watch and `pending feedback` touch the same machinery — who owns that surface?~~ — **WITHDRAWN**

**Raised at the gate by the coordinator on 2026-08-21; withdrawn on 2026-08-23.** Kept with its
withdrawal so it is not re-raised by a later cross-spec pass.

**What it claimed.** That proposed issue 6 and issue 5 had different intents on adjacent code —
issue 5 is *"the worker's own request may end"*, watch is *"a third party is told later"* — and
that both would land on `countWaitable`
(`packages/orchestration/src/task-board/shared.ts:184-198`), `boardQuiescence`, and what a drain
waits for. It required one spec to own that surface, or the two to be explicitly sequenced, before
either was specced.

**Why it is withdrawn.** It was a consequence of the superseded framing — watch as a *task*
primitive, registering interest in a board row. Under the owner's redefinition watch is a general
notification primitive and **touches no board internals at all**: the board only **emits**, which
it already does (`task-change`, `get-or-create.ts:29-30`), and the matcher and the registry live in
`engine` (D4). Nothing in issue 6 reads or changes `countWaitable`, `boardQuiescence`, or what a
drain waits for.

**Consequence: issue 5 is free-standing again**, for spec purposes as well as merge order (theme
13), and it owns its residual gap alone (§4's issue-5 cell). **Q5's placement half was unaffected
by this withdrawal** — that argument was never about this collision — and has since been decided
on its own terms (§5 Q5).

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
  *What it explicitly did not settle:* **§5 Q1's door question is untouched and stays open** *(Superseded 2026-08-23: the owner decided Q1 — the asymmetric door, theme 16.)* —
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
  **No re-division — the five issues stand**, and **§5 Q1's door question is untouched**. *(Superseded 2026-08-23: the owner decided Q1 — the asymmetric door, theme 16.)*
- **Settlement — the parked-task cold path. Claim REFUTED; the five issues stand.** *(Folded
  **outside** the epic PR's two-round budget, which stays spent and the doc stays converged: a
  settlement records a claim so it cannot be reopened, which is the opposite of reopening review.
  Nothing else was folded in this pass.)* *The claim:* two bot reviewers asserted opposite answers
  to the same factual claim — that `awaitReview` / `resumeFromReview` already supports a worker
  parking a task, **its request ending**, and a later separate request resuming it, making a
  `pending feedback` status unnecessary. Asserted and counter-asserted, so it was run rather than
  argued a third time. *What ran:* two throwaway vitest scenarios on the real `taskBoard` path —
  park-and-never-resume settled the drain only on a silently exhausted iteration budget
  (`elapsedMs=840 drainSettled=true finalStatus=awaiting_review`), and park-checkpoint-resume read
  `drainSettledBeforeResume=false drainDoneAfterResume=true`. Moving the resume *before* the
  checkpoint flips that flag and fails the assertion, so the check discriminates real timing
  rather than hard-coding a result. Corroborated first-party at `task-board/shared.ts:140-144`
  and by the committed `durable-board-freshness.test.ts`, which already asserts
  `drainDoneBeforeResume === false` (suite re-run clean: 67 files / 1170 tests). *Why:*
  `awaiting_review` is the one non-terminal status excluded from every board-exit path, so the
  launching request's `.waitForCondition` stays open for the whole park — in both `onIdle` modes
  and on a detached board. *What the counter-assertion got right, so the verdict is not read
  wider than it is:* the **resume** half works — `resumeFromReview` writes `task.feedback` and
  `buildWorkerInput` spreads it onto the re-claimed worker as a plain string. Only *the request
  ends* is false. *Two secondary findings, both favourable to issue 5:* a parked row's lease is
  neither reclaimed nor needs renewal (**ran** — `leaseLapsed` short-circuits for any
  non-`in_progress` status), and restart survival follows from the store adapter's general
  durability guarantee (**reasoned, not run** — not verified by execution). *What it changed:*
  §3 gains the settlement, marked as a settlement rather than a fifth characterization check;
  §4's issue-5 cell gains **the residual gap to build** — a park mode that does not hold the
  drain's own request open; §5 **Q5's necessity half is now settled and its placement half stays
  open** *(superseded 2026-08-23: the placement half is decided — inside, as issue 5)*, because the
  composition argument for filing it outside the epic survives the verdict untouched; §1's necessity check and theme 5 now rest on evidence rather than assertion.
  **No re-division — the five issues stand**, and **§5 Q1's door question is untouched**. *(Superseded 2026-08-23: the owner decided Q1 — the asymmetric door, theme 16.)*
- **Owner-proposed set change — the watch seam enters as proposed issue 6. Six proposed issues,
  and the set is now under opposite pressure from two directions.** *(A **set change proposed by
  the owner**, not a review fold. The epic PR's two-round budget stays spent and the doc stays
  converged: the objective gate approves the **division**, so a division the document no longer
  matches would put the gate on the wrong thing. **Nothing else was folded from the open review
  threads.** Nothing is filed in Linear — the gate precedes creation.)*
  *What the owner proposed:* a **watch** relationship beside today's only one, **claim**. Register
  interest in a task row, take no lease, hold nothing up, block nobody; on the row reaching a
  **terminal** state, its **outcome** is delivered as an addressed message. Their framing: *"this
  is a seam we think is missing. It is not filed anywhere in Linear, and there is no affordance
  for it in the codebase."* Scoped by them to terminal transitions only (mid-run progress and
  questions stay FIX-1056's steering direction), to the **row's outcome** rather than an authored
  reply, and silent about which strand an arriving turn joins.
  *Why polling cannot cover it — verified rather than assumed:* the interested party is not
  running. `countWaitable` (`task-board/shared.ts:184-198`) skips handed-off rows at `:195`, and
  `isHandedOff` (`shared.ts:111-120`, FIX-1074) is true for a leased `in_progress` row that
  `runsElsewhere` claims — so the launching board reports the hand-off and retires, and when the
  workstream settles there is provably nobody there. Stated design, not an oversight. The owner's
  survey of the seven surfaces that might have covered it — `requestHost`, `parentTask`,
  `livenessOf`, `subscribeToItems`, `.waitForCondition`, `reactTo`, `resource_change` — is
  recorded in §4 with file:line for each. **LAB-138** is already hand-rolling it.
  *Two additions raised at the gate by the coordinator, attributed as such:* (1) **watch could be
  this epic's proof, an argument for inclusion nobody had made** — the set otherwise builds a verb
  plus four adjacent things and contains **no consumer of its own objective**; recorded in §1's
  objective linkage. (2) **A collision with issue 5** over `countWaitable` / `boardQuiescence` /
  what a drain waits for — **§5 Q6b**, requiring one spec to own that surface or the two to be
  explicitly sequenced, **before either is specced**. *(Superseded by the next entry: Q6b is
  withdrawn — the collision was a consequence of the superseded task-primitive framing.)*
  *And the owner's own open question, recorded unanswered as **§5 Q6**:* the **watch's own
  lifetime** — who clears a watch when the watcher dies, and what happens when the row never
  settles. The never-settles case is the ordinary shape of abandoned work, not an edge case, so a
  registry without a lifetime rule **leaks by default**. That is issue 6's real cost.
  *(Superseded by the next entry: Q6 is closed by decision D3 — a TTL whose expiry delivers.)*
  *Composition, stated rather than smoothed (§4):* two independent reviewers recommend cutting to
  **three** issues (drop sibling-spawn, externalise `pending feedback`) while the owner proposes
  adding watch. **The coordinator proposes a swap, not growth — watch in, sibling-spawn out**:
  spawn *creates* a session, watch *reaches one that is not running*, which is §1's objective
  verbatim, and owner, coordinator and two reviewers have now separately judged spawn the weakest
  fit. **Marked a proposal, not a decision** — pulling issue 3 reverses an explicit owner call and
  only the owner can do that. The gate answers it. *(**Superseded by the next entry: the swap
  proposal is retracted.** It rested on the coordinator's own wrong premise about why issue 3 is in
  the set.)*
  **§5 Q1's door question is untouched and stays open.** *(Superseded 2026-08-23: the owner decided Q1 — the asymmetric door, theme 16.)*
- **Deferred decision landed — the configurable admission budget moves from issue 2 to issue 1.**
  Decided earlier by the coordinator and not yet in the document. *Why:* issue 2 depends on issue
  1 and theme 13 lands issue 1 first, so leaving the budget on issue 2 would ship an acknowledged
  send API while the arbiter's 30-second budget is still hardcoded — precisely the
  accepted-then-silently-dropped delivery §1 and theme 14 forbid. §3's Q4 proved the fix is one
  parameter through the `arbiter` option `createInboundTransportHost` already accepts
  (`:106-113`), so the move costs issue 1 almost nothing. *Reconciled:* theme 14's "constrains"
  line, §4's issue-1 and issue-2 cells, §1's named-risk scope paragraph, and §5 Q3's
  cross-reference; §3's Q4 "Changed" record keeps its original wording with a superseded marker,
  since it is a dated log of what was true then.

- **Owner amendment + set reshape — issue 3 stays on the owner's reason, and watch is redefined as
  a general notification primitive. Six issues.** *(Folded **outside** the epic PR's two-round
  budget, which stays spent and the doc stays converged. Legitimate on the same grounds as the
  previous set change: the gate approves the **objective and the division**, so a division — or a
  stated rationale — the document no longer matches would put the gate on the wrong thing. **No
  bot-review findings were folded and no converged material was reopened.** Nothing is filed in
  Linear; the gate precedes creation.)*

  **(1) Issue 3 stays, and the recorded rationale for it was wrong.** The owner: *"Spawn session was
  added not because of the task board, but because messages could cross sessions."* Spawn is the
  **address-supply side of cross-session messaging** — if a session can message a peer, it needs a
  way to mint the peer it will address; without it, cross-session messaging only ever reaches
  sessions some outside-world caller happened to create. That is the messaging model completing
  itself. *What was retracted:* the coordinator's "same missing layer" / implementation-economy
  rationale, and the **swap spawn for watch** proposal it licensed — pulled from §1, §4's index,
  §4's composition note and the PR description. *Recorded factually because it matters for how the
  next such recommendation is read:* **two bot reviewers (a cursor Grok pass and chatgpt-codex)
  each recommended cutting issue 3, and the coordinator agreed with them. All three were reasoning
  from the wrong premise about why issue 3 was in the set.** The owner's reason supersedes.

  **(2) Watch is not a task primitive.** The owner's definition, treated as canonical: *"a more
  reusable notification primitive… a one off subscription. Something happens, a watcher was
  attached to that thing, tell the watcher the thing happened, unsubscribe."* Their mechanism: a
  subscription resource holding entries of the form *when this event fires holding this value, call
  this flow for this session id*; a **relay action matching that event** receives the payload; a
  completing task **sends its event to the watch manager**, which handles the relay call. Issue 6 is
  rewritten to that: **a durable subscription registry + an event matcher + delivery as an addressed
  relay message, with the task board as its first consumer, not its subject.**

  **(3) Verified prior art, cited so issue 6 is not re-derived — it is much smaller than it reads.**
  A task change **is already an event** (`TASK_CHANGE_COMPONENT_TYPE = "task-change"`,
  `tasks/collection/get-or-create.ts:29-30`; `TaskChangeEvent`, `change-event.ts:37-44`; already a
  wake predicate, `predicates.ts:32-41`) — **the board needs no new emit**. A resource change **is
  already an event** (`onResourceChanged`, `engine/src/context/resource-registry.ts:545`,
  `:1205-1210`, wired per scope at `createExecutionContext.ts:2137-2170`). And *"when this event
  fires, run this bound thing"* **already exists synchronously** as `reactTo` /
  `reactive-dispatch.ts` (FIX-751 PR2, `:1-17`, `:43-46`). *New **theme 15** states the framing:*
  **watch is the asynchronous, cross-session, runtime-registered sibling of `reactTo`** — same event
  vocabulary, different binding time, different delivery — so only three things are genuinely new:
  the registry, a matcher running **outside** the mutating turn, and addressed delivery. Theme 15
  also binds issue 6's spec to **reuse `reactTo`'s change-payload shape and predicate idiom**.

  **(4) Four engineering calls decided by the coordinator (EM posture), reversible by the owner —
  §4's issue-6 decisions.** **D1:** the primitive is *"notify me when this becomes true, or
  immediately if it already is"*, not *"notify me on the next matching event"* — both board
  backings `emit(...)` **after** the committed write, outside the lock
  (`resource-backed.ts:450-474`, `sequencer-backed.ts:264-338`), so the register/settle race
  generalizes to every source; registration reads current state and attaches or immediately
  enqueues, atomically, making the failure **unrepresentable**. *Price named:* each source owes a
  small "is this already satisfied?" read adapter, so the primitive is not purely
  source-agnostic — the rejected alternative is cheaper in the primitive and gives a footgun per
  source. **D2:** exact-match on an identity key + event name, **not** a predicate language — a
  content-based matcher is the event bus this epic ruled out; `reactTo`'s `when` stays the escape
  hatch for the synchronous case. **D3:** a **TTL** on the entry whose **expiry delivers an
  `expired` outcome** rather than dropping — no sweeper needed, and a leak becomes a signal.
  **D4:** the watch manager lives in **`engine`**, not `orchestration`, which becomes a consumer
  forwarding its existing event — this is also what keeps the board single-writer (theme 11).

  **(5) Consequences applied across the document.** **§5 Q6 is CLOSED by D3** and kept with its
  answer. **§5 Q6b is WITHDRAWN** and kept with its withdrawal — the issue-5 collision was a
  consequence of the superseded task-primitive framing; under the new model watch touches **no**
  board internals, so **issue 5 is free-standing again** for spec purposes as well as merge order
  (theme 13, §4's issue-5 cell, §3's settlement record). **§5 Q1 gains new evidence and stays
  OPEN** *(Superseded 2026-08-23: the owner decided Q1 — the asymmetric door, theme 16.)***:** a relay action whose only purpose is to receive a watch callback is a *pure inside-world
  verb* that nothing should be able to invoke from the public surface — an independent argument for
  the asymmetric door, arising from the owner's own watch design, and **not** an answer to Q1.
  **Restated once so it is not re-litigated as a fan-out violation (§1, §4):** N subscriptions are
  N **addressed** deliveries, each naming its recipient's `sessionId` at registration time; the
  banned shape is an *unaddressed* message with no session to run in.

  **The set is six:** 1 address + send verb + two modes + agent tool + configurable admission
  budget · 2 per-adapter delivery (dep 1) · 3 sibling spawn, address supply for cross-session
  messaging (dep 1) · 4 cron as a scheduled message (dep 1) · 5 `pending feedback` task status
  (independent; necessity settled) · 6 watch, a general one-off notification primitive (dep 1; the
  task board is its first consumer). **§5 Q1's door question is untouched and stays open** *(Superseded 2026-08-23: the owner decided Q1 — the asymmetric door, theme 16.)*, and
  **the epic is not approved** — the gate is unchanged.

- **Owner decision — the door is asymmetric. Q1 closed, Q5 closed, and the artifact now carries no
  gate question.** *(Folded **outside** the epic PR's two-round budget on the same justification as
  the previous two folds — the gate must be honest about what it approves. **No converged material
  reopened, no bot findings folded, D1–D4 and theme 15 untouched.** Nothing filed in Linear.)*

  **(1) §5 Q1 — DECIDED by the owner, 2026-08-23.** Verbatim: *"Yes, inside world verb/asymmetric
  door is right."* **A sibling resolves `flow.actions`** — it *is* a caller. **A workstream gets a
  narrow, author-declared inside-world surface** and never reaches `flow.actions`. Recorded as
  **theme 16**, with Q1 kept in §5 as a closed record carrying the full reasoning. *Why it was the
  fork:* candidate (a), one door for everyone, would have given a detached dispatch a route to a
  caller-addressed action; candidate (b) forced both halves through a new narrow surface the
  sibling half does not need. The answer was neither — **keep the asymmetry the system already
  has, and widen only the inside-world half.**

  **(2) The cheap half — this extends an invariant that already exists and is already enforced.**
  `packages/core/src/types/flow.ts:562`, `workstream?: ActionCore`, is *"the single pre-assembled
  entry a detached dispatch resolves"* (FIX-999), and `:549-557` states the rule: *"resolution for
  the detached source is **terminal**, so an absent core is a named refusal and never falls through
  to {@link actions}. That is the security invariant — a detached dispatch must have no route to a
  caller-addressed action."* We are widening **one core to a declared set**, not inventing a
  security concept. Verified against the tree during this fold.

  **(3) The wrinkle, and the coordinator's call on it (reversible by the owner).** `flow.ts:559-560`:
  *"Not an app-author surface. It is assembled by the framework from a board's drain bindings;
  nothing is declared to get one."* Today's inside-world surface is **derived**, and a
  relay-receivable action cannot be — *"another session may address this by name"* is not inferable
  from block structure the way a drain binding is. **Decision: reuse the terminal-resolution
  mechanism, add a *declared* `relay?` group** (the owner's own naming, §5 Q2). `workstream` stays
  framework-assembled; **`relay?` becomes the flow's first authored inside-world surface**, the
  sibling of `webhooks?` / `schedules?` theme 3 anticipated. **Do not derive it** — inference would
  either under-declare (a message with nowhere to land) or over-declare (the wider door, opened by
  accident), and both fail silently.

  **(4) Promoted to issue 1's acceptance criteria: the recipient's `flowKind` is looked up from the
  session record, never asserted by the sender.** Promoted **by the door decision, not by a new
  finding** — it has been in the record since a codex round-5 P1 implementer note and the note is
  unchanged. What changed is its status: under a single door, asserting the recipient's kind was
  hygiene; under an **asymmetric** door the server must decide *which door to open*, which makes the
  recipient's kind a **routing decision**, and BP-031 is categorical that routing is never derived
  from caller-controllable input. **A sender able to assert its recipient's kind could select the
  wider door.**

  **(5) §5 Q5 — CLOSED, both halves. `pending feedback` rides inside this epic, as issue 5.**
  *(Coordinator's call, reversible by the owner; recorded as a decision rather than surfaced as a
  fork because it is a near-zero-cost composition call.)* Necessity was already settled by §3's
  run. On placement: issue 5 is the set's **only unblocked issue**, so filing it outside puts the
  epic's one day-one-startable piece of work in another container; and **theme 5's headline case
  depends on it**, so the epic would be depending on an outside issue for its own leading story.
  The reviewer's composition argument is kept in Q5's record rather than dropped. *Cost of being
  wrong:* the set reads as two epics in retrospect — a documentation cost, not a rework one, which
  is what makes it the coordinator's call.

  **(6) Issue 6 inherits the door with nothing to decide** — a watch-callback relay action is a pure
  inside-world verb, so it is declared in the `relay?` group and is never reachable from
  `flow.actions` (one line in §4; not re-argued).

  **(7) Reconciled across the document (tenet 5).** §1's address/door paragraph, §1's sign-off
  paragraph, §1's necessity check, theme 3's *"which door it is remains §5 Q1"*, §3's POC framing
  line, §4's issue-1 cell, §4's composition note, §4's issue-6 subsection, the relationship map's
  FIX-1056 row, Q1b's opener, Q6b's tail, and **§5's intro, which is now a ledger of every entry's
  status**. Every earlier "Q1 is open" / "Q5's placement stays open" claim inside a dated log entry
  carries a superseded marker rather than being rewritten.

  **Open-question count: four remain, and none is a gate question** — Q1b (an issue-1 spec detail
  that blocks nothing), Q2 (the name; the owner's own deferral until code is in front of them), Q3
  (durable-path ordering; the epic promises nothing and it blocks nothing), Q4 (the role
  materialization layer; explicitly deferred to real code). **Zero composition questions and zero
  door questions.** The epic is **not approved** — the objective gate is the only thing outstanding
  and nothing in this fold changes it.
