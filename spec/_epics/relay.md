# Epic — Relay: an internal message layer, and the cron changes that ride on it

> **Epic issue:** FIX-1197 · **Branch:** `epic/relay` (never merged) · **PR:**
> [#1357](https://github.com/fixpoint-labs/flow-state-dev/pull/1357) · **Project:** Orchestration
> Primitives
>
> A coordination artifact, not an implementing spec. Issues *reference and align* to it; each
> writes its own spec. Front section is for the **owner**; everything below the fold is for
> whoever writes an issue spec.

---

## 1. What this is

- **A running session cannot be reached.** FSD can start one, and start a detached child of one,
  but there is no way back *in*. A workstream that hits a question finishes or fails; a schedule
  that fires can only begin something new.
- **Relay is an internal message layer**: one session addresses another by `sessionId`, and the
  message arrives as an ordinary request on the recipient.
- **Cron rides on it** — a schedule becomes a sender. Absent address means a new session per run,
  as today.
- **The consumer is Conductor**, a meta-harness driving coding-agent runs across many sessions —
  one committed consumer, so this is not speculative surface.
- **Not an event bus.** No fan-out, no subscribers, no discovery. Every message names one
  recipient.

## 2. The objective — this is what the gate approves

**Make an existing session reachable from inside the system.** A workstream raises a question
without ending. A coordinator steers a run already in flight. Two top-level sessions keep each
other informed. A schedule fires onto a named session.

> **Identity: relay always sends within a single user identity.** User-to-user communication is
> **not possible in the framework** — there is no such feature. The only cross-user mechanism is
> **org-level resource sharing**, which is not messaging.
>
> **What makes that hold for relay is something we are specifying, not something the framework
> already guarantees:** the **server-derived sender identity** issue 1 enforces (§8, AC 3). The
> `userId` binding check is **not** the proof — it guards a *mismatched* request reaching another
> user's session, and a dispatcher supplying the **recipient's** `userId` passes it — our own POC
> ran that case.
>
> **Distinct from the org constraint — never collapse them.** That one is **one user with sessions
> in two orgs**: inside a single user identity, crossing an org boundary, and a real gap.

## 3. The issues — five certain, one conditional

Nothing is filed; the gate precedes creation. Every row is a proposal.

| # | Issue | Depends on |
|---|---|---|
| 1 | The address, the send verb, both send modes, the agent-facing tool, admission | — |
| **2** | **CONDITIONAL** — **the cross-worker wake channel**, which exists **only if we choose to build it** | 1 |
| 3 | Sibling spawn — **address supply**: it mints the peer the send verb addresses | 1 |
| 4 | Cron: a schedule addresses a session and fires as a message | 1 |
| 5 | An exit/park mode for `awaiting_review` — a parked task whose request may **end** | — |
| 6 | Watch — a general one-off notification primitive; the task board is its first consumer | 1, 4† |

**† Two of these edges are conditional on constraint forks this document has *not* settled, and
they are marked rather than drawn as if decided.**

- **Issue 2 exists if and only if we build the wake channel.** Its alternative is to **restrict
  blocking wait to in-process** — and issue 1's AC 4 already makes issue 1 refuse blocking sends
  when the dispatcher cannot serve them. **Under the restrict outcome AC 4 is the whole answer and
  issue 2 has no delta left.** *(Second challenge to its content; both were right about different
  things.)*
- **Issue 6's edge to issue 4 is conditional on C5.** If the expiry sweep is a scheduled message it
  needs issue 4 — and even then not sufficiently, since the framework runs no ticker (deployment
  fact 1). If C5 instead takes an **engine-owned periodic job**, the sweep invokes issue 1's relay
  seam directly and **issue 4 is not needed at all**.

**So the gate approves five certain issues and one conditional**, not six certain.

**Issue 1 does *not* depend on issue 5.** It ships both modes complete — a top-level sender waits
on `waitForCondition` and needs no park. The park matters only for the **workstream ask-and-end**
path: **a scenario dependency for the headline case, not a build-order edge.**

## 4. The waiting model

The owner's rule, and it governs the epic:

> there are two ways we may need to watch things, and suspend isn't one of them. That is an
> "unexpected" wait in my mind. If a request expects to wait for something, then it should just
> use `waitForCondition`. Otherwise we are waking to a new request.

| Case | Mechanism | The request |
|---|---|---|
| **Expected wait** — waiting for a specific known thing | `waitForCondition` | stays **open** |
| **Otherwise** | wake to a **new request** | ends; a later one resumes |
| **Unexpected wait** — human-in-the-loop, arbitrary duration | `ctx.suspend()` | **relay does not use this** |

**Wait-for-response is the first case**, so its clock is `waitForCondition`'s own `timeoutMs` and
`{ timedOut }` is the signal — no separate answer timeout exists.

**The design implication, and it is the sharp one.** `waitForCondition` watches **one request's
own response stream** (§9). The board drain works because its children
emit into its own stream; relay does not, because the reply is a fresh request on the *replier's*
side. Therefore:

> **A correlated reply must land as an item on the waiting request's response stream.**

Not a new waiting mechanism — a **delivery target**, the same species as the dispatch seam:
reaching into a live request from outside it. **Issue 1 designs it; this document does not.**

## 5. Decisions, and who made them

**Owner:**

- **The door is asymmetric.** A **sibling** resolves `flow.actions` (it *is* a caller); a
  **workstream** gets a narrow, author-declared inside-world surface and never reaches
  `flow.actions`. Extends an invariant already enforced — `flow.workstream` resolves *terminally*.
- **The address is a `sessionId`** on both ends — the **recipient locator** caller-supplied, the
  **sender identity** server-derived (AC 3).
- **Two send modes, not three** — fire-and-forget and wait-for-response. Acceptance is the
  acknowledgement on both, not a third mode.
- **Cron rides on this layer** rather than keeping a transport of its own.
- **The waiting model** (§4).
- **Issue 3 stays**, because messages cross sessions and spawn supplies the address.
- **Watch is a general notification primitive**, not a task primitive.

**Coordinator (reversible by the owner):**

- **The inside-world surface is *declared***, as a `relay?` group — a sibling of `webhooks?` /
  `schedules?`. It cannot be derived the way `flow.workstream` is.
- **Issue 5 rides inside this epic.** It is the only issue that **does not depend on the send
  verb** — unblocked like issue 1, but orthogonal to the core — and the headline case needs it.
  *Cost of being wrong: the set reads as two epics later — documentation, not rework.*
- **Relay dispatches use unbounded admission**; the wait is bounded by `waitForCondition`.
  *Alternative not taken: propagate admission expiry back to the sender.*
- **The epic promises nothing about ordering on the durable path.** Pulling durable arbitration in
  is out of scope by two boundaries already set; FIX-830 owns it.
- **Authorization is defined on the full server-derived identity tuple**, including
  bound-versus-unbound **org** equality — see §2's distinction, and §8's issue-1 requirements.

**Deliberately not doing:** session discovery (consumer-owned domain state) · widening
`livenessOf` · cross-session progress polling · a new queueing mechanism.

## 6. Still open — two questions, neither gating

- **The name.** `relay` is the leaning for the config group; `message-with-sender-and-recipient`
  for the noun. Also covers issue 5's exit-mode name. **Owner's deferral** — they want code in
  front of them first.
- **Which layer role materialization belongs on** — `workforce` or `orchestration`. Deferred to
  real code, deliberately.

## 7. Deployment facts the objective inherits

- **The framework runs no scheduler.** *"Hosts run their own scheduler … and POST to this endpoint
  when a schedule is due"* (`scheduled/src/index.ts:8-13`). Issue 4 stays true — it never claimed
  to build a ticker — but anything riding on **schedules** needs a host-provisioned one (whether
  watch expiry does is C5's open choice). `bullmq` ships native cron; bare Vercel needs Vercel Cron.
- **An expected wait holds a request open.** Fine on a long-lived host or a bullmq worker; **not**
  on a platform with a hard request ceiling. **Serverless deployments get the wake-to-a-new-request
  form** (§4, row 2) — no new mechanism needed.
- **Blocking wait-for-response is in-process-only today.** `waitForCondition` subscribes to the
  waiting worker's **in-memory** emitter; in a queue-backed deployment the reply runs in **another
  worker**, and the bullmq bridge is a one-way **publisher** aimed at a streaming client
  (`bullmq/src/worker.ts:74-104`, *"bridge is best-effort"*) — **no inbound path can inject an item
  into another worker's live emitter.** So such a deployment needs a **cross-worker wake channel**
  or it does not get the blocking mode — the fork §3 marks as conditional. *Operational, not
  theoretical:* enough blocked waiters can **exhaust the worker pool** before recipients ever run.

---

# Below the fold — for whoever writes an issue spec

## 8. Constraints for issue specs

**These are constraints, not decided mechanism.** Each states what must be true, plus the
coordinator's recommended resolution and its evidence. An issue spec must satisfy the constraint;
it may reach it differently, with reason. **They are settled with code and a POC, in the issue's
own spec — not here.**

### Issue 1

- **Correlation is per-send.** A per-send ID, minted at send time, echoed by the reply.
  `requestId` identifies the **asker, not the ask** — one request can issue two wait-for-response
  sends (parallel branches, multiple tool calls) — so it is **provenance only**, never the
  correlator.
- **Beyond §4's delivery target, issue 1 owns a runtime correlation-aware wait seam.**
  `waitForCondition`'s predicate is fixed when the **sequencer is defined** and receives only the
  shared request item array (`core/src/blocks/sequencer.ts:2297-2318`), while a correlation ID is
  minted at **tool-call runtime**. Framework tool calls in one model step run **concurrently** on a
  shared parent emitter (`core/src/blocks/generator.ts:1286-1309`), so two relay invocations cannot
  each bind that static predicate to their own new ID — one reply satisfies **both waiters or
  neither**. *Note: this is the second time "just use `waitForCondition`" has turned out to need a
  new seam.* **State it; do not design it** — the stop applies.
- **Authorization on the full identity tuple**, including bound-versus-unbound **org** equality.
  An unbound sender that omits `orgId` fires **no check** and `resolvedOrgId` becomes *the
  recipient's* org, so the sender runs against the recipient's org resources
  (`createExecutionContext.ts:656-661`; the file names the gap itself at `:725-728`, `:733-734`).
  **Distinct from cross-user, which has no feature behind it and is held by AC 3** (§2). *The generalisation worth keeping: an
  owner-level invariant is structurally blind to any distinction below the owner — org binding and
  resource scope are both exactly that.*
- **Key-collision refusal — about the **effective arbiter key**, with self-addressing one instance
  of it, and coupled to the waiting mechanism.** On the **expected-wait path** (request open, key
  **held**) a send whose target resolves to a key the sender already holds must be **refused**:
  under `queue` one request runs to completion before the next starts, so the recipient can never
  start. Q2 measured it. On the **wake-to-new-request path** (request ended, key released) no
  refusal is needed. **Severity: under the supported `{policy:"queue", key:"user"}` every blocking
  send deadlocks** — a same-owner A→C send targets the user key A already holds, and **every send
  is same-owner by design invariant** (§2), so this is the common case, not an edge. Custom shared
  keys collide identically despite different `sessionId`s.
- **AC 1** — the recipient's `flowKind` is **looked up from the session record, never asserted by
  the sender**. Under an asymmetric door this is a *routing* decision, and BP-031 is categorical.
- **AC 2** — **relay dispatches are unbounded-admission, or admission expiry reaches the sender.**
  Configurability alone is insufficient: any finite value reproduces Q4's accepted-then-dropped
  shape.
  - **One rule, and it closes this region: a bounded wait over an unbounded delivery yields an
    UNKNOWN outcome, never a negative one.** `{ timedOut }` means *"I stopped waiting"*, not *"it
    did not happen"* — **the same rule as watch's `expired`** below. **Two instances:** *the reply
    arrives late* — past `timeoutMs` the listener is torn down (`core/src/blocks/sequencer.ts:2358-2383`) and the
    sending request may be terminal, so an ack for an answer that can wake nobody, or an append to
    a completed request; and *the delivery happens late* — unbounded admission keeps it queued, so
    it **will** run, and a caller that retried gets **both executions**. Duplicate execution is the
    worse class, and both fall out of **two of our own decisions composed**: unbounded admission
    plus a bounded wait mean delivery is certain while the caller may have stopped waiting.
    **Requirement:** define and surface the timeout outcome as **unknown**, with either
    cancellation of the undelivered request or a **durable status / idempotency contract** blocking
    unsafe retries. *Lean, not a decision:* the idempotency contract — it matches `expired`, and
    cancellation is itself racy (the request may be mid-execution when it arrives). **Neither
    picked; nothing designed here.**
- **AC 3 — two halves, and conflating them breaks the epic.** The **sender identity and the
  authorization tuple** used to validate a send are **derived server-side from the sending context,
  never taken from the envelope**; that is what makes §2's claim true for relay. **The recipient
  locator is not covered by this rule.** *Which* session to reach is **caller-supplied and
  opaque**, and must be: the objective includes *"two top-level sessions keep each other
  informed"* — sessions that **already exist**, where issue 3 only mints *new* siblings and
  discovery is out of scope — and the session API takes a caller-supplied `sessionId` by design
  (`state-and-scopes.md:398`, `:402`). **A rule phrased "never caller-supplied" is exactly the kind
  an implementer over-applies, and over-applying it here makes the headline case unreachable.**
  **AC 3 assumes a sending session, and not every origin has one — so the rule is stated once
  here rather than patched per origin.** **Any origin that is not a session must carry
  server-derived authority persisted at registration or definition time, or go through a narrow
  trusted system-origin door.** Three origins already need this — **cron** (issue 4), **C5's
  engine-owned periodic job**, and AC 3's own framing, which presumes a session — and stating it
  as a rule covers the next one by construction. **The door is not designed here:** a design that
  picks the engine-owned job must satisfy this rule, and that is the whole of what this document
  says about it.

  **The trap on the other half: do not rely on the `userId` binding check in place of deriving
  identity** — it compares `sessionRecord.userId !== userId`
  (`createExecutionContext.ts:625-632`), so an envelope naming the **recipient's** `userId` passes.
  *(That check was once cited here as proof of unreachability. It is not — the POC that found it
  said "once the sender's identity is ctx-derived", and that clause was the whole load.)*
- **AC 4** — **issue 1 must reject blocking sends when the effective dispatcher lacks cross-worker
  wake support.** The channel is issue 2's — conditional, and **dependent on** issue 1 — so without this criterion
  the moment issue 1 lands a queue-backed caller can invoke an *advertised* blocking mode with no
  guard in existence, at deployment fact 3's cost. **Second instance of a pattern worth seeing** —
  the same species as shipping the acceptance ack before the admission budget was addressable,
  which opened the window AC 2 exists to close. *Rejected option:* make issue 2 a hard prerequisite
  — refusing what it cannot do keeps issue 1 shippable and useful in-process, where a prerequisite
  would serialise the epic for a case in-process deployments never hit. **Detection not designed here.**
- **Open, no answer: which callers use `waitForCondition` and which wake to a new request** —
  specifically a workstream drain, whose request does stay open. `suspend` / `continueRequest` is
  **not** the mechanism (§4, §9). **This area was specified wrong twice** — a suspension-resume
  form invented, then the blocking form deleted. **Do not attempt a third variant without code.**

### Issue 2

- **`sessionId` already flows end-to-end** — `DispatchEnvelope` declares it, the host forwards it,
  bullmq serializes and restores it. So "per-adapter delivery" named **no adapter delta** and would
  have produced an empty spec. **Re-described, then made conditional:** issue 2's content is the
  **cross-worker wake channel**, and it exists **only if we choose to build it** (§3). Under the
  other branch — restrict blocking wait to in-process — **issue 1's AC 4 ships the guard and issue
  2 has nothing left**. *Read as "a short spec", that branch invites an **empty issue being filed** —
  which is the concrete harm this framing closes.*

### Issue 4

- **Can an addressed schedule target a session on another flow?** `scheduled/src/routes.ts:175-199`
  resolves the binding from the **URL** flow, while issue 1 requires the **recipient's** `flowKind`.
  Both cannot hold for a cross-flow target. *Options, no pick:* require same-flow targets, or
  define an explicit relay action on the recipient. Pairs with the **"cron has no sender identity"**
  gap — same seam, both halves. **That gap is an instance of AC 3's non-session-origin rule**, not
  a problem of its own: a schedule has no sending session, so it carries persisted server-derived
  authority or uses the system-origin door.

### Issue 5

- **The gap is the exit predicate, not a new status.** `awaitReview` already parks durably and
  `resumeFromReview` already persists feedback and resumes; the sole missing behaviour is that
  `boardQuiescence` keeps the launching request open. Build an **exit/park mode** — an exit path
  letting `boardQuiescence` stop returning "continue" while parked, or routing review-parking
  through the same `runsElsewhere` exclusion detached dispatch gets for `in_progress`.
- **A third waiting case, distinct from §4's two:** the board drain waiting on a **human**, where
  the wait is genuinely unbounded — which is why it needs an exit predicate rather than a timeout.

### Issue 6 — C1–C6

**Watch is `reactTo`'s asynchronous, cross-session, runtime-registered sibling** — same event
vocabulary, different binding time and delivery. Reuse `reactTo`'s change-payload shape and
predicate idiom — **including its split between state and content updates** (C1b). Three of its
four parts already ship (task-change and resource-change already emit; `reactTo` already does bound
dispatch); what is new is the registry, an out-of-turn matcher,
and addressed delivery — **plus the expiry sweep, which is required, not optional.**

| | Constraint | Recommended resolution |
|---|---|---|
| **C1** | Registration must not lose a condition that is **already true** — both board backings `emit(...)` *after* the committed write, outside the lock | Satisfied-or-attach, atomically. *Price:* each source owes a small "is this already satisfied?" adapter |
| **C1b** | **"Already true" is undefined for an edge source.** A task's terminal status is a **level** predicate; a resource `updated` is an **edge** event, so a current-state read gives no baseline. **And "resource updated" is two kinds, not one:** a **content** write goes to the separate content store and fires the seam with `{ contentWrite: true }` and **no state delta** — *"A content write carries no state delta"* (`resource-registry.ts:853-859`) — so there is no version to compare and a content write between the baseline read and the attach is **still missed** | A **versioned baseline for state writes**, where per-key versions already exist — **the cheapness claim holds for state and not for content.** **Unverified, check first:** whether that version is readable on a public path at registration time. **For content, mirror `reactTo`'s existing split** rather than inventing a cursor across two stores: the framework already treats a content update as its own kind, mapping `contentWrite` to `reactTo.contentUpdated` (FIX-843), and mirroring it is both the smaller change and coherent with watch reusing `reactTo`'s vocabulary. *Rejected:* a unified cursor spanning both stores — larger, and it invents a vocabulary where one already exists. *Pre-committed fallback:* level-only immediate satisfaction, edge watches carrying the residual race **stated, not hidden** |
| **C2** | The match key must be the **complete coordinate** — scope kind + owner + collection/namespace + id, on **both** the registration and the event. Three registries can emit the same `storageKey`; `TaskChangeEvent` identity is the `collectionId`+`taskId` pair. A bare id mis-delivers **inside one owner** | Complete coordinate, with the scope **server-derived** per BP-031 |
| **C3** | A bounded lifetime that **something actually fires**. A lazily-checked TTL never runs for the never-fires case it exists to close | TTL + a **periodic sweep**. **What triggers the sweep is C5's question, not this one** — C3 requires only that a sweep exist. *Rejected:* cleanup-on-next-activity with no `expired` promise — it answers the lifetime question with "nothing clears it" |
| **C4** | The manager must sit where **both** event sources reach it | `engine`, with `orchestration` a consumer forwarding the event it already emits. Keeps the board single-writer |
| **C5** | **UNRESOLVED — the sweep C3 requires has no framework-owned trigger.** `@flow-state-dev/scheduled` runs no loop. **Trigger selection is this constraint's alone** | *Options, no pick:* an **engine-owned periodic job** (needs no issue 4, and no host scheduler — but it has **no sending session**, so it is an instance of AC 3's non-session-origin rule and must satisfy it), or a **specified required external scheduler + target session** (a scheduled message, so it needs issue 4 and a host ticker). The choice decides issue 6's edge to issue 4 — §3 |
| **C6** | **UNRESOLVED — the `expired` announcement can itself be lost**, over the same best-effort path it backstops. If the sweep consumes the entry and the delivery is lost, no entry remains and the watcher is told nothing | *Options, no pick:* retain and retry until handoff is confirmed, or weaken the guarantee explicitly |

**Delivery is explicitly best-effort — no durable outbox** (out of scope by the owner's boundary).
**Loss is never prevented.** The bound is **conditional**: bounded *if C5 is resolved*,
self-announcing *if C6 is*, recoverable by re-registration *where C1's guarantee holds*.
**`expired` is AC 2's rule again:** *"I stopped watching; re-check if you still care"* — never
"it did not happen", because in the crash case it did.

**Boundary:** the board **emits** (it already does), the watch manager **matches**, Relay
**delivers**. A spec that stores message state on the row, or adds a new emit to the board, has
crossed it.

## 9. Verified evidence

Every load-bearing claim this document makes about existing behaviour, with its citation. **Checked
in the tree.**

| Claim | Evidence |
|---|---|
| One dispatch seam already exists; every transport funnels through it | `createInboundTransportHost.ts:268`; callers at `action-routes.ts:171`, `webhook/routes.ts:214`, `scheduled/routes.ts:205`, `chat-sdk/event-handlers.ts:393`, `mcp/createMcpTransportAdapter.ts:410`, `detached-start-operation.ts:135` |
| The envelope already carries `sessionId` | `engine/src/transports/types.ts:68-172` (`:78`) |
| The `userId` binding check guards a **mismatched** request, not impersonation — supplying the recipient's `userId` passes it | `createExecutionContext.ts:625-632` |
| Org is checked only when it **differs**; an omitted `orgId` resolves to the recipient's org | `createExecutionContext.ts:656-661`, `:725-728`, `:733-734` |
| `flow.workstream` resolves **terminally** — no fall-through to `actions` | `core/src/types/flow.ts:549-557`, `:562` |
| …and is **framework-assembled**, not author-declared | `core/src/types/flow.ts:559-560` |
| `waitForCondition` watches **one request's own response stream**; `{ timeoutMs, wakeOn? }` in, `{ timedOut }` out | `core/src/blocks/sequencer-methods.ts:344-379` |
| A suspension resume re-invokes the **same** request id; no new request is spawned | `docs/architecture/execution-and-errors.md:397-407` (FIX-811) |
| Acceptance resolves while the message is still queued | `engine/src/transports/types.ts:186-227` |
| Arbitration is **in-process only**; skipped under an external dispatcher | `concurrency/arbiter.ts:22-27`, `createInboundTransportHost.ts:299-301` |
| `QUEUE_WAIT_TIMEOUT_MS = 30_000`, and the gate is a per-process map | `arbiter.ts:40`, `keyed-async-gate.ts:13-16` |
| The admission fix is a **parameter**: `Infinity`/omitted already disables the timer, and the arbiter is injectable | `keyed-async-gate.ts:141-145`; `createInboundTransportHost.ts:106-113` |
| `ConcurrencyQueueTimeoutError` is swallowed; `RequestRecord` has no error field | `createInboundTransportHost.ts:692`; `stores/types.ts:117-172` |
| The framework runs **no scheduler**; hosts POST when due | `packages/scheduled/src/index.ts:8-13` |
| bullmq ships native cron (repeatable job schedulers) | `bullmq/src/schedule-index.ts:21-24,43,52` |
| A schedule's envelope resolves its binding from the **URL** flow | `scheduled/src/routes.ts:175-199` |
| Dynamic schedules carry a **user**, not a session | `defineScheduleCollection.ts:36-44,75`; `createResourceCollectionScheduleResolver.ts:56-65,109` |
| A task change is **already an event** | `tasks/collection/get-or-create.ts:29-30`; `change-event.ts:37-44`; consumed at `predicates.ts:32-41` |
| A resource change is **already an event**, wired per scope | `resource-registry.ts:545`, `:1205-1210`; `createExecutionContext.ts:2137-2170` |
| Three scope registries can emit the **same** `storageKey` | `createExecutionContext.ts:2044`, installed `:2137`, `:2152`, `:2170` |
| Per-key versions already exist — **for state writes only** | `resource-registry.ts:480-491` (D10), `:523-527` (D7) |
| A **content** write carries **no state delta**; it fires the seam with `{ contentWrite: true }`, which maps to `reactTo.contentUpdated` (FIX-843) | `resource-registry.ts:853-859` |
| `reactTo` already does bound dispatch — **in-session, inline in the mutating turn** | `reactive-dispatch.ts:1-17`, `:43-46` |
| Both board backings `emit(...)` **after** the committed write, outside the lock | `resource-backed.ts:450-474`; `sequencer-backed.ts:264-338` |
| `awaiting_review` is excluded from every board-exit path | `task-board/shared.ts:140-144`; `countWaitable` `:184-198`; `isHandedOff` `:111-120` |
| `livenessOf` is lineage-filtered — a peer returns `false` | `liveness-read.ts:127`, `:131`; `create-request-host.ts:433,493` |

## 10. POC verdicts

Built on this branch under `spec-poc/epic-relay/`. Throwaway; none of it ships.

| | Question | Verdict |
|---|---|---|
| **Q1** | Can a running block dispatch onto another live session? | **YES** — it ran and landed a request on the recipient. **The sharp edge:** the envelope principal is a plain field and nothing at the seam checks it, so naming another owner *passes*. That is why the sender's identity must be server-derived |
| **Q2** | Does a self-addressed wait deadlock? | **YES**, and it fails loudly: `ConcurrencyQueueTimeoutError` at 30 016 ms, a `failed` record on the recipient for a run that never started, and the sender reporting `completed` |
| **Q3** | Does delivery outlive the sending request? | **YES.** The sender reached `completed` in 4 ms; the queued delivery ran later and landed — **and `accepted` settled at 0 ms while still queued**, which is what makes acceptance usable as the ack on both modes |
| **Q4** | Does the admission budget drop an already-accepted delivery? | **YES.** Accepted at 0 ms, **dropped at 30 001 ms**, handler never ran, nothing in the logs, sender read `completed`. Re-run unbounded — **the delivery landed** |
| **S** | *(Settlement)* Does the board's existing park already cover the cold path? | **REFUTED.** Park and resume both work, but the launching request stays open for the whole park, so *the request may end* is not available today — issue 5's gap |

## 11. How to review this

**This is a DESIGN document at EPIC altitude.** It fixes an **objective**, a **division of work**,
and the **constraints each issue's spec must satisfy**. It does **not** specify implementations.

**In scope:**

- **The objective** — is this worth doing, and is the outcome right?
- **The division into issues** — six or four? Does one not serve the objective? Is one missing?
  **Whether the set overbuilds can only be asked here.**
- **A constraint that is wrong, missing, or contradicts another.**
- **A false claim about existing behaviour — cite `file:line`.** §9 is full of them; corrections
  are always welcome.

**Out of scope — settled in each issue's own spec, with a POC, and NOT repaired here:**

- Mechanism design and protocol details.
- Concurrency, atomicity and ordering of code that has not been written.
- Storage schemas, retry semantics, delivery semantics, claiming semantics.
- **Any defect that only exists once someone picks an implementation.** If your finding requires
  assuming a particular implementation to be a defect, it belongs in that issue's spec review.

**This is not a soft preference** — findings of the second kind are read, judged, and **not
carried**. Six landed on issue 6's semantics, and each epic-altitude repair was an untested design
decision that generated the next defect. **A primitive's correctness contract cannot be settled
without code.**

**The most useful thing a reviewer can do here is challenge the objective or the division.** In
round 15 one finally did — that issue 2 named no adapter delta — and it was **right, in scope, and
sharpened the division rather than collapsing it**: issue 2 was described wrong, not scoped wrong.
That is this contract working.

**POC files on this branch are out of scope entirely** — this PR never merges and none of it ships.
React to what §10 says they showed, not to the code.
