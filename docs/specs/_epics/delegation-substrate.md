# Epic — Delegation substrate: host model, roster & identity, and worker context supply

> **Coordination artifact, not an implementing spec.** The issues under this epic do
> **not** derive from this doc — they *reference and align* to it. This is the shared
> surface, the sequencing spine, and the running index for the set. See
> [`docs/contributing/orchestration.md`](../../contributing/orchestration.md) for what an
> epic-spec is.
>
> **Epic branch:** `epic/delegation-substrate` (never merged, never deleted) ·
> **Project:** Orchestration Primitives · **Team:** flow-state

---

## 1. Purpose & objective *(the `epic approved` sign-off surface)*

> **Status: APPROVED.** The human approved the objective; `epic approved` is applied on
> epic PR #873 and FIX-930 is **In Development** (2026-07-23). The set is authorized; what
> paces the work is the **sequencing spine**, not the gate. The keystone decision the rest
> aligns to (**FIX-923**) has **landed** and is **Done**. Since then the scope has
> **narrowed to in-request only**: all detached / background / durable-job execution has
> moved **wholesale out** to a new tracking epic, **FIX-939** (Durable jobs & detached-task
> substrate). This objective states the narrowed, in-request shape.

**Why this body of work.** FIX-918 (spec PRs #850/#855, impl PR #854 — **shipped**,
merged 2026-07-22) landed the board-commanded delegation model: a skill declares a roster
under `agents:`, the coordinating host plans work with
`addTask({ goal, assignee, deps, input })`, and drains it with `runBoard` (the old
`context: pattern` / `context: fork` skill execution modes were removed). That landing was
deliberately kept focused, and it left a *cluster* of tightly-coupled follow-ons and open
design decisions all sitting on the **same delegation surface** —
`worker-materializer.ts`, `task-tools-capability.ts`, `worker-step.ts`, the substrate
`TaskInit`, and the `keyedRouter` dispatch. Decided in isolation they would contradict each
other: the sharpest example was that FIX-924 wanted to **reject** an unknown assignee at
creation while FIX-923's on-demand direction wanted to **accept** an explicitly ad-hoc one.
This epic exists so those cross-cutting calls are made together rather than in a vacuum —
and FIX-923 has now reconciled exactly that tension by deciding **two board modes**
(strict-roster vs. validate-but-allow-fallback) rather than one strict rule. It **includes
FIX-918 itself as the shipped foundation** (parented under the epic), so the delegation
surface and everything built on it are discoverable from one place and the sequencing story
reads end-to-end.

**Scope: in-request only (the settled boundary).** This epic delivers delegation that runs
**inside a single request**. All tasks are **blocking**: the host calls `runBoard`, the
drain waits for **all** tasks to complete, and the coordinator then decides what to do next
— close to today's behavior. There is **no background/detached execution and no outer
controller loop in this epic**. Everything durable, detached, background, or cross-request
has moved **wholesale out** to **FIX-939** (a related tracking epic, not a sub-issue).

**But the contract is deliberately detach-ready — the epic's explicit forward-compat
stance.** The task board / task-collection this epic hardens is **already the durable-job
primitive**: tasks are leased (`leaseUntil` + CAS claim + `reclaim`), mutable across a full
lifecycle API, and observable mid-flight (`TaskHandle.items()`). So this epic treats the
in-request drain as **one claimer against that durable board** — not as a bespoke
in-memory runner. Designing to that shape means **FIX-939 can later add an out-of-request
executor (a second claimer) without breaking callers**: the board contract does not change,
only *who* drains it and *when*. Keeping delegation in-request now while keeping the task
contract detach-ready is the deliberate call, and it is why FIX-939 exists as a sibling
rather than a rewrite.

**Outcome (approved, narrowed to in-request).** A *coherent* in-request delegation
substrate built on a shipped foundation, with its keystone decision landed:

- the **delegation foundation is already shipped** — FIX-918 delivered the
  board-commanded agent-team delegation surface (skills declare `agents:`; the host plans
  with `addTask` and drains with `runBoard`; pattern-mode and fork-mode removed). It is
  **Done**; no spec-approval gate and no implementation under this epic. It is included so
  the sequencing story is complete and the set is navigable from one issue, and its surface
  gets a small polish pass (FIX-928);
- the **host model is decided (FIX-923, Done).** The keystone research spike landed. Its
  decided shape:
  - the **host is a coordinator + synthesizer** — it plans and synthesizes results; there
    is **no host-as-worker / host-as-IC slot** (the host does not take a worker turn on the
    board);
  - the host is a **suspend/resume-transparent controller** — within a request, a
    `runBoard` drain suspends and resumes with the same semantics as any generator turn;
  - **durable state lives at the controller / session level** (a session-scoped task board
    keyed per agent id), **not at block scope**. In this in-request epic that keeps state
    off the block, and it is exactly the property that makes the board detach-ready for
    FIX-939 later — so there is **no hard FIX-917 dependency**;
  - **on-demand delegation ships as a uniform *default-worker floor*** — an undeclared
    `assignee` **materializes a default worker instead of erroring**. This is a **named,
    first-class option**, not implicit magic. **Caveat retained — the floor is *not*
    zero-code:** today the router `select` **throws before it reaches `fallback`**
    (`worker-step.ts:213`), and persona wiring is missing (`TaskInit.context` / `metadata`
    are **not injected** into the worker prompt), so the floor needs the router-fallback
    path wired **plus** prompt/context injection before it works;
  - **on top of the floor, per-task class+identity specialization is owned by FIX-641** —
    the two are **sequenced floor-first** (this resolves the old Decision-5 fork — it is
    **both**, in order, not either/or; see §4 Q1). **Still open (owner call): whether FIX-641
    is rescoped to build the floor itself, or the floor becomes its own issue** distinct from
    641's class+identity layer — this gates 924 / 641 / 931 / 932 (see §4 Q4);
- **assignment and dispatch validation is now mode-based** — FIX-924's `validateAssignee`
  rule is **finalized by 923's two-mode decision**: strict-roster **rejects** an unknown
  assignee; validate-but-allow-fallback **accepts** an explicit ad-hoc one and routes it to
  the default-worker floor. The `blocked-by FIX-923` relation that held FIX-924 (spec PR
  #865, `spec approved`) is **satisfied now that 923 has landed**; the one remaining gate on
  it is the floor-home decision (Q4). The dispatch surface also grows an enqueue-count cap so
  on-demand can't over-spawn **within a request** (FIX-931);
- **the host's packaging is the remaining design work — and its verdict is now settled in
  the FIX-929 spec (in review).** FIX-929's outcome: **no new primitive, no `AgentController`
  wrapper.** The around-the-loop capabilities the host needs are **carried by capabilities**
  on the generator, not by a bespoke controller block. The one net-new piece is an
  **optional, installable activation-utility sequencer** that runs `createSkillActivator`
  **before** the generator and **shares the generator's `activeState` field**, giving
  deterministic **up-front skill activation** (e.g. a `/skill-name` check that loads the
  skill before the turn). The **background-execution drain and the enclosing controller
  sequencer are explicitly OUT** — they belong to **FIX-939**. FIX-929's spec is being
  finalized on `spec/FIX-929` (PR #901) and is **awaiting approval**;
- **workers can receive the right context** — inherit the parent conversation when they
  need it, **bounded by default** (FIX-920, **Done**), and expose shared task resources / a
  blackboard so workers can hand results back (FIX-921, the output half). Proactive
  ambient-context pruning is a *related neighbor outside this epic* (FIX-482, `relates-to`):
  920's bounded-by-default inheritance removes the hard dependency;
- **the delegation plumbing bugs underneath are closed** — `agent-ref` agents can fan out
  mid-drain (FIX-927); the delegation-surface helpers get a memoize/dedup polish (FIX-928);
- **the surface is documented** — one authoring guide plus a canonical worked example once
  the shape settles (FIX-932).

This is **mostly rewiring plus a now-decided keystone, a settled packaging spike (FIX-929,
spec in review), and a docs pass**, not a new subsystem. Every primitive already exists on
`main`; the work is threading fields through a few layers, wiring an
already-present-but-unused router `fallback`, drawing clean lines between overlapping
context seams, and writing it down.

**What ramps (the objective is approved).** Per the objective gate (`orchestration.md`
§Gates), `epic approved` has released the epic's sub-issues from NEEDS_SPEC. Two
predecessors — FIX-482 (`utility.contextSelector`) and FIX-917 (block-state 4-key
consolidation) — were moved **out** to related neighbors. Since approval, two sub-issues
were **canceled** (FIX-925, FIX-901 — see below) and all detached/background execution was
**spun out to FIX-939**. What paces the remaining work is the **sequencing spine**. With
**FIX-923 decided**, the aligned issues no longer wait on a *decision* — they align to a
**known shape**: FIX-924's rule is decided (mode-based) and its `blocked-by 923` is
satisfied; FIX-641 (class+identity, sequenced after the floor) and FIX-931 (in-request
enqueue cap) build against the decided on-demand-as-floor model; FIX-929's packaging verdict
is settled in its spec (in review). FIX-927 / FIX-928 move independently; FIX-921 is late /
low-priority and FIX-932 (docs) lands last. FIX-933 (spend cap) is filed but **deferred to
backlog**.

**Two sub-issues canceled since approval:**

- **FIX-925 (assign a task to a tool) — CANCELED.** Nice-to-have, not needed now. A
  coordinator can rely on a **sub-agent to make a deterministic tool call** (a cheap model
  turn) instead of dispatching a task straight to a tool, and *agent-as-a-tool* reads oddly
  on the dispatch surface. Dropped from the active roster.
- **FIX-901 (durable / background work pool) — CANCELED, superseded by FIX-939.** Its whole
  concern — draining a board outside a single request — is exactly what moved out to the new
  detached-substrate epic. FIX-939 carries it forward; FIX-901 is closed as superseded.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **FIX-918 is the shipped foundation, folded in as a completed member.** **Done** (impl PR
  #854 merged 2026-07-22); no gate, no implementation under this epic. It is in the epic so
  the surface and its follow-ons live under one parent. Approving the objective does not
  re-open it.
- **The load is honest about build vs. decision/design.** FIX-923 was the **decision spike**
  (host-model recommendation; now **Done** — its deliverable was a decision, not code).
  **FIX-929** is the **packaging design spike**; its verdict is now settled in a spec under
  review (no new primitive; capabilities + an optional activation-utility sequencer). FIX-932
  is **docs**. The actual *build* issues are FIX-920 (Done), FIX-927, FIX-641, FIX-924,
  FIX-928, and FIX-931. They share the same files (`worker-materializer.ts`, `worker-step.ts`,
  the `TaskInit` / `keyedRouter` dispatch, the delegation-surface helpers) and carry hard
  sequencing dependencies (923's decision gates the *shape* of 641 / 931 and finalizes 924's
  rule; 927 is a one-field threading fix on the same materializer path). Rolling them up is
  correct and does **not** overbuild *as delegation* — no issue adds surface another makes
  redundant once the host model is fixed.
- **Detached/background execution is deliberately NOT in this set — it is FIX-939.** By
  scoping the epic in-request and spinning the durable/background substrate out, the set no
  longer carries the heaviest, least-proven surface (out-of-request executor,
  lease-reclaim sweeper, request-emitter decoupling). The epic's only obligation to that
  future is to keep the **task contract detach-ready**, which costs nothing extra because the
  board is already the durable-job primitive.
- **FIX-921 is deliberately late and low-priority.** It is the *output* half of worker
  context supply (skills define resources / a task blackboard) and has a workaround today, so
  it is sequenced after the load-bearing work rather than cut.
- **Predecessors and cancellations shrink the set.** FIX-482 and FIX-917 are `relates-to`
  neighbors, not sub-issues; FIX-925 and FIX-901 are canceled; FIX-939 owns everything
  detached. FIX-933 (spend cap) is filed as a sibling guard to FIX-931 but **deferred to
  backlog**, explicitly out of the first pass.

  Net: the set is one shipped foundation, a now-decided keystone plus a settled
  packaging spike, a small cluster of in-request build issues on one surface, a late
  output-side issue, a docs pass, and one deferred spend guard — coherent as *in-request
  delegation substrate*, with the general/adjacent predecessors (482, 917) moved out, two
  members canceled (925, 901), and all detached execution handed to FIX-939.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-918 shipped; FIX-923 keystone DECIDED

FIX-918 is **already shipped** (impl PR #854 merged) — the delegation surface every issue
below builds on. FIX-923 was the **research/decision spike whose deliverable was a
recommendation, not a build**, and it has **landed (Done; spec PR #864 closed, approved)**.
Its decision is the shape the rest of the set aligns to:

- **host = coordinator + synthesizer** (plans and synthesizes; **no host-as-worker slot**);
  a **suspend/resume-transparent controller** within a request; **durable state at the
  controller / session scope, per agent id — not block scope**;
- **on-demand = a uniform default-worker floor** (undeclared `assignee` → default worker, a
  *named* first-class option — not zero-code: `select` throws before `fallback` at
  `worker-step.ts:213`, and `TaskInit.context`/`metadata` aren't injected today) **plus**
  **class+identity specialization owned by FIX-641**, sequenced **floor-first**;
- **two board modes** — strict-roster vs. validate-but-allow-fallback — which makes
  **FIX-924's validation rule mode-based**.

With 923 decided, the rest of the work aligns to a known shape:

- **FIX-641** — the concrete implementation of 923's on-demand path: the **class+identity
  specialization layer that sequences *after* the default-worker floor**. Its **issue-text
  refresh and its build** both happen now that 923 is solid. **Open owner call (Q4): does
  641 also build the floor, or does the floor get its own issue?**
- **FIX-924** — its `validateAssignee` rule is **decided as mode-based** (strict-roster
  rejects; validate-but-allow-fallback accepts + routes to the floor). The `blocked-by
  FIX-923` relation that held it is **satisfied**; it now waits only on the floor-home call;
- **FIX-929** — the host-*packaging* design spike (§2e); its verdict is settled in a spec
  under review (no new primitive; capabilities + optional activation-utility sequencer);
- **FIX-931** — the **in-request** enqueue-count cap, load-bearing specifically *because*
  on-demand delegation can over-spawn; its default and shape align to the decided on-demand
  floor.

Spine: **918 (shipped foundation) → FIX-923 keystone (DECIDED) → { FIX-641 refresh+build
(class+identity, floor-first), FIX-924 rule (mode-based), FIX-929 packaging (spec in review),
FIX-931 in-request enqueue cap }**. Building on 918's surface **independently of 923**:
**FIX-920** (context inherit, **Done**), **FIX-927** (mid-drain fan-out bug), **FIX-928**
(surface polish). **FIX-921** (task blackboard / resources) is late and low-priority.
**FIX-932** (docs) lands last, once the surface settles. **FIX-933** (spend cap) is a
deferred backlog sibling to FIX-931, not sequenced into the first pass.

### 2b. The shared assignee / identity / dispatch gate (923 ↔ 924 ↔ 641 ↔ 927 ↔ 931)

The single source of truth for "who is a valid participant, and can it take this task" is
the board's worker registry and the dispatch surface around it. Several issues touch it and
must not disagree:

- **FIX-924 centralizes validation in one `validateAssignee` gate** (the roster text is
  assembled inline in `buildDelegationGuidance` near `agentPurpose`, at
  `packages/orchestration/src/skills/delegation-surface.ts:434-446` — there is no
  `buildWorkerRoster`; FIX-924 either extracts a helper there or hooks that assembly) so
  context, validation, and dispatch cannot drift. Its rule is **decided as mode-based** by
  FIX-923: **strict-roster** rejects an unknown assignee; **validate-but-allow-fallback**
  accepts an explicit ad-hoc one and routes it to the default-worker floor. So 924 is a
  *mode-parameterized widening* of a single gate, not a scatter of edits.
- **FIX-641's runtime identity** — the **class+identity specialization layer** 923 chose,
  **sequenced after the default-worker floor**. It rides on a **known class** (`assignee`
  stays the routing key; `identity` is orthogonal to roster validation).
- **FIX-927 closes a plumbing bug on the same surface** — `agent-ref` agents that carry
  `taskTools` don't get the board-scoped capability, so mid-drain fan-out returns
  `no_delegation_board`. A **one-field threading fix**: carry `boardTaskTools` through
  `MaterializeAgentOptions` (in core) so the materializer reads it
  (`worker-materializer.ts:125-133`) instead of the current inline handling. Self-contained
  wiring — **not gated on 923 or 641** — natural to *review* alongside the identity work
  because it lives in the file FIX-641 rewires.
- **FIX-931 caps the enqueue count (in-request).** `BOARD_CONCURRENCY=4` bounds parallel
  *execution*, not the *total tasks enqueued*: a host can `addTask` 50 times and the board
  drains them four at a time, so on-demand delegation's token-blow-up failure mode is not
  bounded at enqueue. 931 adds a `maxPendingTasks`-style **rejection at `addTask`**, enforced
  in the same `validateAssignee` gate, bounding the **in-request** drain. Its **spend-based
  sibling is FIX-933** (931 caps *count*, 933 caps *spend*) — filed but deferred to backlog
  (see §4 Q3). (Cross-request/cross-wake accumulation of either cap is **not** an epic
  concern — it belongs to FIX-939's detached executor when that arrives.)

Note: the **task→tool assignment axis (FIX-925) is canceled** — a coordinator uses a
sub-agent to make a deterministic tool call instead, and agent-as-a-tool read oddly on this
surface. So the dispatch surface stays agent-only.

Net: one dispatch surface, one validation gate, a couple of axes (valid vs. ad-hoc, under vs.
over the in-request enqueue cap) — all resolved by 923's decided host-model choice.

### 2c. Context flow to workers — input (920, Done), output (921); pruning moved out (482)

Two complementary directions on the worker context window, kept on clean lines so we do not
grow two overlapping selectors:

- **FIX-920 adds an input source — bounded by default. (Done.)** A `conversation`
  context-supply mode wires the worker's generator `history` slot to the parent conversation
  up to the dispatch point, while `itemVisibility: { history: false }` keeps the
  sub-execution out of host history (fork-like: inherit everything, hand back only the
  result). It **ships bounded by default** using the real `ItemQuery.limit` shape,
  `history: { limit: { turns: N } }` (**not** `history: { turns: N }`). This resolved the old
  "bounded vs. wait-on-482 vs. accept-the-token-risk" question. 920 builds on FIX-918's
  decoupled **`agents:` parser** (the frontmatter key is `agents:`, not the pre-918
  `workers:`; the parser now *throws* on legacy `workers:` —
  `packages/orchestration/src/skills/skill-md.ts`).
- **FIX-921 adds the output half** — skills define shared **resources / a task blackboard**
  so workers can publish results and read each other's, the write-side counterpart to 920's
  read-side inheritance. It has a workaround today, so it is **sequenced late / low-priority**.
- **Pruning is out of scope.** FIX-482 (`utility.contextSelector`, proactive goal-aware
  trimming) is a general utility for *any* LLM block, now a `relates-to` neighbor. Because
  920 ships bounded by default, the epic does not depend on it. The **LLM-summarization
  single-owner** concern (482's `strategy: "llm"` vs. the flow-policy `compact` stub)
  **travels out with 482**.

### 2d. FIX-918 — the shipped foundation this substrate builds on (+ FIX-928 polish)

FIX-918 landed the board-commanded delegation model — skills declare a roster under
`agents:`, the host plans with `addTask` and drains with `runBoard`, and the old
`context: pattern` / `context: fork` skill execution modes were removed. It is **Done**
(spec PRs #850/#855, impl PR #854 merged 2026-07-22). It is **in this epic as the completed
foundation** — parented under FIX-930 so the surface and its follow-ons are discoverable from
one place — and needs no approval gate or implementation here.

**FIX-928** is a small polish pass on that surface — memoize / dedup the delegation-surface
helpers (`delegation-surface.ts`, `library.ts`). Pure cleanup of what 918 shipped;
independent of the host-model work.

### 2e. Host packaging (FIX-929) — settled: capabilities, not a new primitive

FIX-923 decided *what* the delegation host is; **FIX-929** decides how it is *packaged*, and
that verdict is now settled in the FIX-929 spec (on `spec/FIX-929`, PR #901, **awaiting
approval**):

- **No new primitive, no `AgentController` wrapper.** The capabilities a host needs *around*
  the tool loop — skill install / auto-load, delegation, lifecycle — are **carried as
  capabilities** on the generator, not bundled into a bespoke controller block. This keeps
  the host a plain generator-plus-capabilities rather than a new abstraction.
- **One net-new piece: an optional, installable activation-utility sequencer.** It runs
  `createSkillActivator` **before** the generator and **shares the generator's `activeState`
  field**, so a skill can be activated **deterministically up front** (e.g. a `/skill-name`
  check that loads the skill before the turn) rather than relying on the model to call for it
  mid-turn. It is **opt-in** — installed when a skill wants deterministic activation.
- **Explicitly OUT of FIX-929 (→ FIX-939):** the **background-execution drain** and the
  **enclosing controller sequencer** that would own an out-of-request loop. Those are the
  detached-substrate concern, not host packaging. This is what keeps FIX-929 — and the whole
  epic — in-request.

So the old "Agent vs. AgentController" fork resolves to *neither as a new primitive*:
capabilities carry the behavior, and the only new block is the small, optional activation
sequencer.

### 2f. Detached / durable execution is FIX-939, not this epic

Everything that would let delegated work **outlive its request** — an out-of-request
executor draining a leased board, a lease-reclaim / heartbeat sweeper, request-emitter
decoupling, a blocking-vs-background task flag, reactive dispatch off `task-change` — is
tracked by **FIX-939 (Durable jobs & detached-task substrate)**, a **related tracking epic**
(Backlog, `relates-to` FIX-930), **not a sub-issue**. FIX-939 is not to be specced or built
yet; it exists so this epic designs a task contract that survives its arrival.

The linkage is deliberate and cheap: the task board is **already** the durable-job primitive
(leased, mutable, observable), so this epic simply treats its in-request drain as **one
claimer** against that durable board. FIX-939 later adds a **second claimer** — the
out-of-request executor — **without changing the board contract or breaking callers**. This
epic's only obligation to FIX-939 is to keep the task/board contract detach-ready; it does
not build any of FIX-939's mechanism. FIX-901's former "background work pool" framing is
**superseded** by FIX-939, and FIX-825 (topic notification subscribers) reparents under it.

### 2g. Delegation authoring docs (FIX-932) — lands last

A delegation **authoring guide plus a canonical worked example**. **Blocked-by
923 / 641 / 920 / 924** — it documents the settled surface, so it lands **late**, once the
host model (decided), identities, context inheritance, and the validation rule have all
stopped moving.

---

## 3. Running index

The durable audit log of every issue under this epic. FIX-930 has **14 sub-issues**; **12
are active/complete** and **2 are canceled** (FIX-925, FIX-901). FIX-482 / FIX-917 / FIX-939
are `relates-to` neighbors, not sub-issues. Refreshed from the fleet's status table (a
projection, not a second live source).

| Issue | Title | Role in epic | Status | Spec PR | Impl PR |
|---|---|---|---|---|---|
| FIX-918 | Remove skill pattern/fork modes; board-commanded delegation | **Shipped foundation** — the surface the set builds on · no gates | **Done** | [#850](https://github.com/fixpoint-labs/flow-state-dev/pull/850), [#855](https://github.com/fixpoint-labs/flow-state-dev/pull/855) (merged) | [#854](https://github.com/fixpoint-labs/flow-state-dev/pull/854) (merged) |
| FIX-923 | Research: delegation host model (manager/IC + on-demand vs pre-defined) | **Keystone — DECIDED** · host = coordinator+synthesizer (no host-as-worker); suspend/resume-transparent; durable state at controller/session scope; on-demand = default-worker *floor* + FIX-641 class+identity (floor-first); two board modes | **Done** | [#864](https://github.com/fixpoint-labs/flow-state-dev/pull/864) (closed, approved) | — (deliverable was the decision) |
| FIX-924 | Roster-aware task assignment: validate assignee at creation | Validation gate — rule **DECIDED mode-based** by 923; `blocked-by FIX-923` **satisfied**; remaining gate is the floor-home call (§4 Q4) | **Spec Approved** | [#865](https://github.com/fixpoint-labs/flow-state-dev/pull/865) (`spec approved`) | — |
| FIX-641 | Dynamic worker identities — runtime-bound personas of a worker class | 923's on-demand build — the **class+identity specialization layer, sequenced *after* the floor**; issue-text refresh + build now 923 is solid; **may absorb the floor build (Q4)** | **Todo** | — | — |
| FIX-929 | Agent vs AgentController — host packaging (design) | **Design spike — verdict settled in spec:** no new primitive; capabilities carry the controller + an **optional activation-utility sequencer** (`createSkillActivator` before the generator, shares `activeState`); background-drain + controller sequencer **OUT → FIX-939** | **In Spec Review** | [#901](https://github.com/fixpoint-labs/flow-state-dev/pull/901) (awaiting approval) | — |
| FIX-931 | Over-spawning guard: cap total ENQUEUED tasks (`maxPendingTasks` at `addTask`) | Owns the concurrency-cap question; enforced in 924's `validateAssignee` gate · **in-request** cap · task-count sibling of FIX-933 | **In Spec Dev** | — | — |
| FIX-920 | Re-introduce fork-like sub-execution via a task context-supply mode | Context source (inherit) — **ships bounded by default** (`history: { limit: { turns: N } }`); builds on 918's `agents:` parser, not gated on 923 | **Done** | [#853](https://github.com/fixpoint-labs/flow-state-dev/pull/853) | — |
| FIX-927 | agent-ref agents can't carry board-scoped taskTools for mid-drain fan-out | Delegation plumbing bug — one-field `boardTaskTools` threading; sequences independently | **In Spec Review** | — | — |
| FIX-928 | Memoize / dedup the delegation-surface helpers | Polish of 918's surface (`delegation-surface.ts`, `library.ts`); independent, anytime after 918 | **In Spec Review** | — | — |
| FIX-921 | Skills define resources / task blackboard | **Output half** of worker context supply (920 = input/inherit); has a workaround → **late / low-priority** | **Backlog** | — | — |
| FIX-932 | Delegation authoring guide + canonical worked example (docs) | **Blocked-by 923 / 641 / 920 / 924** — documents the settled surface; **lands last** | **Backlog** | — | — |
| FIX-933 | Cost/budget ceiling for delegated work — spend cap | **Deferred (Backlog / Low)** — spend-based sibling to FIX-931 (931 caps *count*, 933 caps *spend*); `relates-to` FIX-931; **not in the first pass** | **Backlog** | — | — |
| ~~FIX-925~~ | ~~Assign a task board task directly to a tool~~ | **CANCELED** — a coordinator uses a sub-agent to make a deterministic tool call instead; agent-as-a-tool reads oddly on the dispatch surface | **Canceled** | — | — |
| ~~FIX-901~~ | ~~Durable / background work pool~~ | **CANCELED — superseded by FIX-939.** Draining a board outside a single request moved wholesale to the detached-substrate epic | **Canceled** | — | — |

FIX-918 leads the index as the **already-shipped foundation**; FIX-923 is the **now-decided
keystone** the middle rows align to; the middle rows are the in-request follow-on work;
FIX-933 trails as a **deferred backlog guard**. The two struck rows are **canceled** and kept
for the audit trail only.

**Related, outside the epic (`relates-to` FIX-930, not sub-issues):**

- **FIX-939 — Durable jobs & detached-task substrate (tracking epic, Backlog).** Owns
  **all** detached / background / durable-job / cross-request execution moved out of this
  epic: out-of-request executor, lease-reclaim sweeper, request-emitter decoupling,
  blocking-vs-background task flag, reactive dispatch. Parent of **FIX-825**; supersedes
  FIX-901's former framing. This epic hands its detached-work concerns to FIX-939 and keeps
  the task contract detach-ready for it. Not to be specced or built yet.
- **FIX-482 — `utility.contextSelector`.** General goal-aware context-pruning for *any* LLM
  block. Moved out: not delegation-specific, and 920's bounded-by-default inheritance removes
  the hard dependency. Stays a related neighbor because it composes with 920's inherited
  context (inherit → prune). The **LLM-summarization single-owner** concern is parked with it.
- **FIX-917 — block-state 4-key consolidation.** A block-state ergonomic fast-follow to
  FIX-914 — consolidate the four top-level state-schema keys into one `state` key and warn on
  silent suspend-reset. Adjacent to the block-based worker surface but **not part of the
  delegation substrate**, and lower priority. Its spec PR #866 rides with the FIX-914
  block-state work, not this set. (923 keeps a host's durable state at controller/session
  scope, **not** block scope, so the epic has **no hard FIX-917 dependency**.)

**Index note.**

- **FIX-641 issue text** carries pre-918 vocabulary (`packages/skills`, `WorkerSpec`,
  `agent-ref`/FIX-450); refresh it now 923 has landed, so the refreshed shape matches 923's
  decided class+identity-over-a-floor model. (FIX-920's stale-vocabulary flag is closed — it
  is Done.)

---

## 4. Open cross-cutting questions

Questions above any one issue, for the human / raised by review. None block the epic
*direction*; they are decisions landed at the objective gate and the per-issue approval
gates. Q1 is **resolved** by 923's decision; Q2 is **resolved** now 923 landed; Q3 is
deferred; **Q4 (floor implementation home) is the one live owner decision**; Q5 is
housekeeping; Q6 is **resolved** — background execution spun out to FIX-939.

1. **FIX-923 Decision-5 fork — RESOLVED: floor now, class+identity via FIX-641.** Decided as
   **both, sequenced**:
   - **the default-worker floor ships first** — wire the existing but **unwired
     `keyedRouter.fallback`** so an undeclared/explicit-ad-hoc `assignee` routes to a default
     worker. **Caveat — not free:** today the router `select` **throws before `fallback`**
     (`worker-step.ts:213`), and `TaskInit.context` / `metadata` are **not injected into the
     worker prompt** (`workerInputSchema` omits `context`; persona resolves from the static
     `Agent.persona`), so the floor needs **the fallback path wired plus explicit
     prompt/context injection**;
   - **then FIX-641 adds class+identity runtime personas** — a parallel `identity` dimension
     layered on a known worker class, the fuller specialization surface, **on top of the
     floor**.

   Not either/or: the uniform floor is the baseline, 641's class+identity is the layer above.
   *Where the floor is built is still open — see Q4.*

2. **FIX-924 blocked-by — RESOLVED now that 923 landed.** #865 carries `spec approved`; the
   Linear `blocked-by FIX-923` relation held it because its `validateAssignee` rule was only
   finalized once 923 landed. **923 has landed** and the rule is decided (**mode-based**), so
   the blocked-by is **satisfied**. Its one remaining gate is the floor-home call (Q4).

3. **Total cost / budget cap — filed as FIX-933 (deferred, Backlog / Low).** A configurable
   spend ceiling, distinct from and **broader than** FIX-931's enqueue cap (931 caps the
   *count* of pending tasks; 933 caps cumulative *spend*). In-request in this epic;
   cross-request accumulation is a FIX-939 concern. `relates-to` FIX-931. **Deferred** —
   captured so it isn't lost, not scheduled into the first pass.

4. **On-demand FLOOR implementation home — OPEN (the one live owner decision).** 923 decided
   the uniform default-worker floor (no host-as-IC slot to wire — the host is
   coordinator+synthesizer). What remains is *where the floor is built* — the
   `keyedRouter.fallback` wiring plus prompt/context injection (the not-zero-code caveat in
   Q1). **Decide whether to rescope FIX-641 to cover the floor, or file a new issue** for the
   floor distinct from 641's class+identity layer. **This gates FIX-924 / FIX-641 / FIX-931 /
   FIX-932** — they all build against whichever issue owns the floor. *For the human to
   decide.*

5. **Stale pre-918 vocabulary — FIX-641's text.** Carries `workers:` / `WorkerSpec`
   vocabulary that predates the `agents:` rename. **Refresh at 641's own review**, not in this
   epic-spec — this doc does not edit issue/spec text. (FIX-920's copy of this flag is closed
   — 920 is Done.)

6. **Background / detached execution vs. FIX-923 — RESOLVED: spun out to FIX-939.** The old
   open question (whether a controller-owns-its-loop / background-drain model must block the
   dependent build work) is **closed** by narrowing the epic to **in-request only**. All
   detached, durable, cross-request, and background-drain concerns moved **wholesale** to
   **FIX-939**; the FIX-929 packaging spike explicitly excludes the background drain and the
   enclosing controller sequencer. This epic's obligation is only to keep the task/board
   contract **detach-ready** so FIX-939 can add an out-of-request executor without breaking
   callers (see §2f). No sequencing question remains here.
