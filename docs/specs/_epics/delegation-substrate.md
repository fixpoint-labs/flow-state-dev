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
> epic PR #873 and FIX-930 is **In Development** (2026-07-23). The set is authorized. What
> now paces the work is the **sequencing spine**, not the gate — see "What ramps" below.
> The keystone decision that the rest aligns to (**FIX-923**) has since **landed**: its
> host-model recommendation is decided and FIX-923 is **Done** (spec PR #864 closed,
> approved). This objective is updated to state that decided shape rather than a candidate.

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

**Outcome (approved).** A *coherent* delegation substrate built on a foundation that is
already in place, now with its keystone decision landed:

- the **delegation foundation is already shipped** — FIX-918 delivered the
  board-commanded agent-team delegation surface (skills declare `agents:`; the host plans
  with `addTask` and drains with `runBoard`; pattern-mode and fork-mode removed). It is
  **Done**; it carries no spec-approval gate and no implementation under this epic. It is
  included so the sequencing story is complete and the set is navigable from one issue, and
  its surface gets a small polish pass (FIX-928);
- the **host model is decided (FIX-923, Done).** The keystone research spike landed. Its
  decided shape:
  - the **host is a coordinator + synthesizer** — it plans and synthesizes results; there
    is **no host-as-worker / host-as-IC slot** (the host does not take a worker turn on the
    board);
  - **on-demand delegation ships as a uniform *default-worker floor*** — an undeclared
    `assignee` **materializes a default worker instead of erroring**. This is a **named,
    first-class option**, not implicit magic. **Caveat retained — the floor is *not*
    zero-code:** today the router `select` **throws before it reaches `fallback`**
    (`worker-step.ts:213`), and persona wiring is missing (`TaskInit.context` / `metadata`
    are **not injected** into the worker prompt), so the floor needs the router-fallback
    path wired **plus** prompt/context injection before it works;
  - **on top of the floor, per-task class+identity specialization is owned by FIX-641** —
    the two are **sequenced floor-first**: ship the uniform floor, then add the
    class+identity specialization layer. (This is what resolves the old Decision-5 fork —
    it is **both**, in order, not either/or; see §4 Q1);
- **assignment and dispatch validation is now mode-based** — FIX-924's `validateAssignee`
  rule is **finalized by 923's two-mode decision**: strict-roster **rejects** an unknown
  assignee; validate-but-allow-fallback **accepts** an explicit ad-hoc one and routes it to
  the default-worker floor. The `blocked-by FIX-923` relation that held FIX-924 (spec PR
  #865, `spec approved`) is **satisfied now that 923 has landed** — the rule it was waiting
  on is decided. The dispatch surface also grows a task→tool assignment axis (FIX-925) and
  an enqueue-count cap so on-demand can't over-spawn (FIX-931; caps **accumulate across
  host wakes**, see below);
- **the host's packaging and its background execution are the remaining design work** —
  **FIX-929** is now framed as a general **agent/skill controller** that wraps a generator
  (skill install / auto-load **plus** delegation **plus** lifecycle **plus** a
  background-execution loop), not merely a delegation-host wrapper (see §2e). 923 **does not
  foreclose** the controller-loop background model: to the generator a `runBoard` tool call
  is one loop iteration with the **same suspend/resume semantics**, and durable state for a
  woken host lives at the **controller / session** level (a durable, session-scoped task
  board keyed per agent id), **not** at block scope — so it is **not a hard FIX-917
  dependency**. The exact mechanism (block-state-at-agent-level vs. a session resource) is
  deferred but must support either. **FIX-901 (durable / background work pool)** is the
  background-execution capability that the packaged controller would own;
- **workers can receive the right context** — inherit the parent conversation when they
  need it, **bounded by default** (FIX-920), and expose shared task resources / a blackboard
  so workers can hand results back (FIX-921, the output half). Proactive ambient-context
  pruning is a *related neighbor outside this epic* (FIX-482, `relates-to`): 920's
  bounded-by-default inheritance removes the hard dependency, so the epic does not need it
  in-scope;
- **the delegation plumbing bugs underneath are closed** — `agent-ref` agents can fan out
  mid-drain (FIX-927); the delegation-surface helpers get a memoize/dedup polish (FIX-928);
- **the surface is documented** — one authoring guide plus a canonical worked example once
  the shape settles (FIX-932).

This is **mostly rewiring plus a now-decided keystone, one remaining design spike
(FIX-929), and a docs pass**, not a new subsystem. Every primitive already exists on `main`;
the work is threading fields through a few layers, wiring an already-present-but-unused
router `fallback`, drawing clean lines between overlapping context seams, and writing it
down.

**What ramps (the objective is approved).** Per the objective gate (`orchestration.md`
§Gates), `epic approved` has released the epic's sub-issues from NEEDS_SPEC. Two issues that
predate the epic — FIX-482 (`utility.contextSelector`) and FIX-917 (block-state 4-key
consolidation) — were moved **out** to related neighbors, so they are not in this set; every
remaining sub-issue is in-scope. What actually paces the work is not the gate but the
**sequencing spine**. With **FIX-923 now decided**, the issues that aligned to it no longer
wait on a *decision* — they align to a **known shape**: FIX-924's rule is decided
(mode-based) and its `blocked-by 923` is satisfied; FIX-641 (class+identity, sequenced after
the floor) and FIX-931 (enqueue cap) build against the decided on-demand-as-floor model;
FIX-929 remains the open **design** spike (host packaging + controller loop), and **FIX-901**
(background work pool) sequences with it — 929's controller-loop outcome may still reframe
901's shape. FIX-920 / FIX-927 / FIX-928 / FIX-925 move independently; FIX-921 is late /
low-priority and FIX-932 (docs) lands last. FIX-933 (spend cap) is filed but **deferred to
backlog** — not part of the first pass.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **FIX-918 is the shipped foundation, folded into the set as a completed member.** It is
  **Done** (impl PR #854 merged 2026-07-22); it carries no spec-approval gate and no
  implementation under this epic. It is in the epic so the delegation surface and the
  follow-ons that build on it live under one parent and the sequencing story reads
  end-to-end. Approving the objective does not re-open it.
- **The build load is honest about what is a build vs. a decision/design spike.** FIX-923
  was the **decision spike** — it produced the host-model recommendation and is now **Done**
  (its deliverable was a decision, not code). **FIX-929** is the one **remaining design
  spike** — host packaging + controller loop; its deliverable is a design, not a build.
  FIX-932 is **docs**. The actual *build* issues are FIX-920, FIX-927, FIX-641, FIX-924,
  FIX-925, FIX-928, FIX-931, and **FIX-901** (whose *shape* is held open by FIX-929 — see
  below). They share the same files (`worker-materializer.ts`, `worker-step.ts`, the
  `TaskInit` / `keyedRouter` dispatch, the delegation-surface helpers) and carry hard
  sequencing dependencies (923's decision gates the *shape* of 641 / 931 and finalizes 924's
  rule; 927 and 925 are one-surface changes on the same materializer / dispatch path).
  Rolling them up is correct, and it does **not** overbuild *as delegation* — no issue adds
  surface another makes redundant once the host model is fixed. **FIX-901 (durable /
  background work pool)'s *shape* is held open by FIX-929**: the host-packaging spike may
  show its background drain is a property of the controller loop rather than a separate
  event/listener subsystem, so it is folded in as a member but its design is not committed
  until 929 lands (Backlog / Medium). FIX-933 (spend cap) is filed as a sibling guard to
  FIX-931 but is **deferred to backlog**, explicitly out of the first pass, so it does not
  load the build now.
- **FIX-921 is deliberately late and low-priority.** It is the *output* half of worker
  context supply (skills define resources / a task blackboard) and it has a workaround
  today, so it is sequenced after the load-bearing work rather than cut — real, but not on
  the critical path.
- **Two predecessors were pulled out, shrinking the set.** FIX-482
  (`utility.contextSelector`) is general context-pruning infrastructure for *any* LLM block,
  not delegation machinery; 920's bounded-by-default inheritance removes the one hard
  dependency, so it is a `relates-to` neighbor, not a sub-issue. FIX-917 (block-state 4-key
  consolidation) is a block-state ergonomic fast-follow to FIX-914 — adjacent to the
  block-based worker surface but not itself delegation substrate, and lower priority — so it
  too moved out to a related neighbor. The LLM-summarization single-owner reconciliation
  (482's `strategy: "llm"` vs. the flow-policy `compact` stub) **travels out with 482** — it
  is parked as a related concern there, and 920's bounded default means the epic does not
  need it resolved in-scope.

  Net: the set is one shipped foundation, a now-decided keystone plus a host-packaging
  design spike, a cluster of build issues on one surface (including the background work pool
  whose shape 929 may reframe), a late output-side issue, a docs pass, and one
  deferred-to-backlog spend guard — coherent as *delegation substrate*, with the two
  general/adjacent predecessors (482, 917) moved out.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-918 shipped; FIX-923 keystone DECIDED

FIX-918 is **already shipped** (impl PR #854 merged) — the delegation surface every issue
below builds on, not a step left to sequence. From there, FIX-923 was the
**research/decision spike whose deliverable was a recommendation, not a build**, and it has
now **landed (Done; spec PR #864 closed, approved)**. Its decision is the shape the rest of
the set aligns to:

- **host = coordinator + synthesizer** (plans and synthesizes; **no host-as-worker slot**);
- **on-demand = a uniform default-worker floor** (undeclared `assignee` → default worker, a
  *named* first-class option — not zero-code: `select` throws before `fallback` at
  `worker-step.ts:213`, and `TaskInit.context`/`metadata` aren't injected today) **plus**
  **class+identity specialization owned by FIX-641**, sequenced **floor-first**;
- **two board modes** — strict-roster vs. validate-but-allow-fallback — which makes
  **FIX-924's validation rule mode-based**;
- **background execution is not foreclosed** — the controller-loop model (923's framing:
  `runBoard` as a loop iteration with the same suspend/resume semantics; durable state at
  controller/session scope, per agent id) is left open for **FIX-929** to settle, and
  **caps accumulate across wakes** (FIX-931 count, FIX-933 spend).

With 923 decided, the rest of the work no longer waits on a *decision* — it aligns to a
known shape:

- **FIX-641** — the concrete implementation of 923's on-demand path. It is the
  **class+identity specialization layer that sequences *after* the default-worker floor**;
  both its **issue-text refresh and its build** happen now that 923 is solid, so it aligns to
  the decided class+identity shape (see §4 Q1) rather than pre-committing;
- **FIX-924** — its `validateAssignee` rule is **decided as mode-based** (strict-roster
  rejects; validate-but-allow-fallback accepts + routes to the floor). The `blocked-by
  FIX-923` relation that held it (independent of its `spec approved` label on #865) is
  **satisfied now that 923 landed**;
- **FIX-929** — the host-*packaging* design spike (now a general agent/skill controller, §2e)
  can proceed against a known host; it **owns the open controller-loop-vs-event/listener
  question** (§4 Q6) and holds FIX-901's shape open;
- **FIX-931** — the enqueue-count cap, load-bearing specifically *because* on-demand
  delegation can over-spawn; its default and shape align to the decided on-demand floor, and
  its count **accumulates across host wakes** (not per-invocation).

Spine: **918 (shipped foundation) → FIX-923 keystone (DECIDED) → { FIX-641 refresh+build
(class+identity, floor-first), FIX-924 rule (mode-based), FIX-929 host-packaging /
controller-loop design, FIX-931 enqueue cap }**, with **FIX-901** (background work pool)
sequenced with FIX-929 — its packaging outcome may reframe 901's shape (see §2e). Building on
918's surface **independently of 923**: **FIX-920** (context inherit), **FIX-927** (mid-drain
fan-out bug), **FIX-928** (surface polish), **FIX-925** (task→tool assignment). **FIX-921**
(task blackboard / resources) is late and low-priority. **FIX-932** (docs) lands last, once
the surface settles. **FIX-933** (spend cap) is a deferred backlog sibling to FIX-931, not
sequenced into the first pass.

### 2b. The shared assignee / identity / dispatch gate (923 ↔ 924 ↔ 641 ↔ 925 ↔ 927 ↔ 931)

The single source of truth for "who is a valid participant, and can it take this task" is
the board's worker registry and the dispatch surface around it. Several issues touch it and
must not disagree:

- **FIX-924 centralizes validation in one `validateAssignee` gate** (the roster text is
  assembled inline in `buildDelegationGuidance` near `agentPurpose`, at
  `packages/orchestration/src/skills/delegation-surface.ts:434-446` — there is no
  `buildWorkerRoster`; FIX-924 either extracts a helper there or hooks that assembly) so
  context, validation, and dispatch cannot drift. Its rule is now **decided as mode-based**
  by FIX-923: **strict-roster** rejects an unknown assignee; **validate-but-allow-fallback**
  accepts an explicit ad-hoc one and routes it to the default-worker floor. The `blocked-by
  FIX-923` relation that held #865 (independent of its `spec approved` label) is **satisfied
  now that 923 landed** — the rule it waited on is decided, so 924 is a *mode-parameterized
  widening* of a single gate rather than a scatter of edits.
- **FIX-641's runtime identity** — the **class+identity specialization layer** 923 chose,
  **sequenced after the default-worker floor**. It rides on a **known class** (`assignee`
  stays the routing key; `identity` is orthogonal to roster validation).
- **FIX-925 adds a task→tool assignment axis** — a task board task can be assigned directly
  to a *tool*, not only an agent (an agent-vs-tool participant kind in `worker-step.ts`). It
  extends the same dispatch surface FIX-924 and FIX-927 touch; keep the participant-kind
  switch in one place so tool-assignment and agent-assignment share validation.
- **FIX-927 closes a plumbing bug on the same surface** — `agent-ref` agents that carry
  `taskTools` don't get the board-scoped capability, so mid-drain fan-out returns
  `no_delegation_board`. It is a **one-field threading fix**: carry `boardTaskTools` through
  `MaterializeAgentOptions` (in core) so the materializer reads it
  (`worker-materializer.ts:125-133`) instead of the current inline handling. Self-contained
  wiring — **not gated on 923 or 641**, and can land in parallel; it is natural to *review*
  alongside the identity work because it lives in the same file FIX-641 rewires.
- **FIX-931 caps the enqueue count** — `BOARD_CONCURRENCY=4` bounds parallel *execution*,
  not the *total tasks enqueued*: a host can `addTask` 50 times and the board drains them
  four at a time, so on-demand delegation's documented token-blow-up failure mode is not
  bounded at enqueue. 931 adds a `maxPendingTasks`-style **rejection at `addTask`**, enforced
  in the same `validateAssignee` gate. It **owns the old "concurrency cap" open question**;
  it aligns to 923's decided on-demand floor (a cap matters precisely because the floor lets
  the host spawn freely). **Its count must ACCUMULATE across host wakes, not reset per
  invocation** — a background/controller-loop host that wakes repeatedly must not get a fresh
  budget each wake. Its **spend-based sibling is FIX-933** — 931 caps the task *count*, 933
  caps cumulative *spend* (also accumulating across wakes) — filed but deferred to backlog
  (see §4 Q3).

Net: one dispatch surface, one validation gate, several axes (agent vs. tool, valid vs.
ad-hoc, under vs. over the enqueue cap) — all resolved by 923's decided host-model choice.

### 2c. Context flow to workers — input (920), output (921); pruning moved out (482)

Two complementary directions on the worker context window, kept on clean lines so we do not
grow two overlapping selectors:

- **FIX-920 adds an input source — bounded by default.** A `conversation` context-supply
  mode wires the worker's generator `history` slot to the parent conversation up to the
  dispatch point, while `itemVisibility: { history: false }` keeps the sub-execution out of
  host history (fork-like: inherit everything, hand back only the result). **Decision: it
  ships bounded by default** — inherit with a bounded history window using the real
  `ItemQuery.limit` shape, `history: { limit: { turns: N } }` (**not** `history: { turns: N }`).
  The governing philosophy: go with the most sensible default and revisit only when that
  default becomes a real problem. This resolves the old "bounded vs. wait-on-482 vs.
  accept-the-token-risk" question — we ship bounded and move on. 920 builds directly on
  FIX-918's decoupled **`agents:` parser** and delegation preset that make a declared worker
  callable (the frontmatter key is `agents:`, not the pre-918 `workers:`; the parser now
  *throws* on legacy `workers:` — `packages/orchestration/src/skills/skill-md.ts`).
- **FIX-921 adds the output half** — skills define shared **resources / a task blackboard**
  so workers can publish results and read each other's, the write-side counterpart to 920's
  read-side inheritance. It has a workaround today, so it is **sequenced late / low-priority**.
- **Pruning is out of scope.** FIX-482 (`utility.contextSelector`, proactive goal-aware
  trimming of ambient sources) is a general utility for *any* LLM block, now a `relates-to`
  neighbor rather than a sub-issue. Because 920 ships bounded by default, the epic no longer
  depends on it. The **LLM-summarization single-owner** concern (482's `strategy: "llm"`
  vs. the flow-policy `compact` stub — decide one home, don't grow both) **travels out with
  482** and is parked there as a related concern; 920's bounded default means the epic does
  not need it resolved in-scope.

### 2d. FIX-918 — the shipped foundation this substrate builds on (+ FIX-928 polish)

FIX-918 landed the board-commanded delegation model — skills declare a roster under
`agents:`, the host plans with `addTask` and drains with `runBoard`, and the old
`context: pattern` / `context: fork` skill execution modes were removed. It is **Done**
(spec PRs #850/#855, impl PR #854 merged 2026-07-22). FIX-920 builds directly on its
decoupled **`agents:` parser** + delegation preset that make a declared worker callable, and
the whole set assumes its surface as already landed. It is **in this epic as the completed
foundation** — parented under FIX-930 so the surface and its follow-ons are discoverable
from one place — and needs no approval gate or implementation here.

**FIX-928** is a small polish pass on that surface — memoize / dedup the delegation-surface
helpers (`delegation-surface.ts`, `library.ts`). Pure cleanup of what 918 shipped;
independent of the host-model work and can land anytime now that 918 is merged.

### 2e. Agent/skill controller packaging & background execution (FIX-929 + FIX-901)

Now that FIX-923 has decided *what* the delegation host is, two coupled questions decide how
it is *packaged* and *run*.

**FIX-929 — a general agent/skill controller (design spike).** The scope is broader than a
delegation-host wrapper: it is the **agent/skill controller that wraps a generator** with the
capabilities that live *around* the tool loop. The human surfaced that if skills install via
this same parent-block mechanism, the controller also owns **skill installation /
auto-loading** — e.g. deterministic `/skill-name` checks that load the skill — **plus**
lifecycle, **plus** delegation, **plus** a **background-execution loop**. So FIX-929 is a
general **agent/skill controller** (skill install/auto-load + delegation + lifecycle +
background-execution loop), not just a delegation-host wrapper. The design question — does the
host need an `Agent` wrapper, or does an `AgentController` (`skillController`) suffice? — is
really *which around-the-loop capabilities the controller owns* rather than leaving them
threaded in ad hoc. Keep it **bounded to the delegation host** 923 landed plus this skill-
controller role; it is **not** a general agent-abstraction redesign (the wider
agent-abstraction question still spills into FIX-817, which stays **out of this epic**).

**Background execution — 923 does not foreclose the controller loop.** 923's framing: to the
generator, a `runBoard` tool call is **one loop iteration with the same suspend/resume
semantics**. If the controller owns its **own loop**, delegated work can run in the
**background without a full notification system**: the generator calls `runBoard` and then
simply **ends** its turn (it may do other work, but does not wait to handle results *that*
turn); the **controller loop wakes** the generator when tasks complete — per-completion or
once all are done, the generator declaring which via `runBoard` config. **Durable state for a
woken host lives at the controller / session level** — a **durable, session-scoped task board
keyed per agent id** — **not at block scope**, so this is **not a hard FIX-917 dependency**.
The exact mechanism (block-state-at-agent-level vs. a session resource) is **deferred but must
support either**. And any caps (FIX-931 count, FIX-933 spend) **accumulate across wakes**.

**FIX-901 — durable / background work pool (a sub-issue).** Drain a task board outside a
single request. It was an adjacent neighbor from the audit; it is pulled **into the epic**
because it is the background-execution capability the packaged controller would own. **Wiring
the relationship: FIX-929 (packaging) + FIX-901 (background drain) relate to FIX-923's decided
host model; their sequencing vs. 923 is OPEN (§4 Q6)** — 923 decided manager/synthesizer and
left the controller loop open, 929 decides the wrapper, and 901 is the background-execution
capability that wrapper would own. Whether 901 keeps its current event/listener direction or
becomes a controller-loop property is what the 929 spike settles; its viability is unproven
until then.

### 2f. Delegation authoring docs (FIX-932) — lands last

A delegation **authoring guide plus a canonical worked example**. **Blocked-by
923 / 641 / 920 / 924** — it documents the settled surface, so it lands **late**, once the
host model (now decided), identities, context inheritance, and validation rule have all
stopped moving.

---

## 3. Running index

The durable audit log of every issue under this epic (**14 sub-issues under FIX-930**).
Refreshed from the fleet's status table (a projection, not a second live source). With
FIX-482 and FIX-917 both moved out to related neighbors, there is **no adjacent-optional
class** — every row below is a sub-issue in-scope; the **Role** column carries the
sequencing story (and marks FIX-933 as a deferred backlog guard).

| Issue | Title | Role in epic | Spec PR | Impl PR |
|---|---|---|---|---|
| FIX-918 | Remove skill pattern/fork modes; board-commanded agent-team delegation | **Shipped foundation** — the surface the set builds on · **Done, no pending gates** | [#850](https://github.com/fixpoint-labs/flow-state-dev/pull/850), [#855](https://github.com/fixpoint-labs/flow-state-dev/pull/855) (merged) | [#854](https://github.com/fixpoint-labs/flow-state-dev/pull/854) (merged) |
| FIX-923 | Research: delegation host model (manager/IC + on-demand vs pre-defined) | **Keystone — DECIDED (spec approved)** · host = coordinator+synthesizer (no host-as-worker); on-demand = default-worker *floor* + FIX-641 class+identity (floor-first); two board modes; controller-loop not foreclosed · **Done** | [#864](https://github.com/fixpoint-labs/flow-state-dev/pull/864) (closed, approved) | — (no build; deliverable was the decision) |
| FIX-924 | Roster-aware task assignment: validate assignee at creation | Validation gate — rule **DECIDED as mode-based** by 923 (strict-roster rejects / validate-but-allow-fallback accepts→floor); `blocked-by FIX-923` **satisfied now 923 landed** (#865 also has `spec approved`) | [#865](https://github.com/fixpoint-labs/flow-state-dev/pull/865) (`spec approved`) | — |
| FIX-641 | Dynamic worker identities — runtime-bound personas of a worker class | 923's on-demand build — the **class+identity specialization layer, sequenced *after* the default-worker floor**; issue-text refresh + build now 923 is solid | — | — |
| FIX-929 | Agent/skill controller — packaging + background-execution loop (design) | **Design spike** — general agent/skill controller wrapping a generator (skill install/auto-load + delegation + lifecycle + background loop); owns the controller-loop-vs-event/listener call (§4 Q6); holds FIX-901's shape open | — | — |
| FIX-901 | Durable / background work pool — drain a task board outside a single request | **Background-execution capability** the packaged controller would own; relates to 923's host model, sequenced with 929 (may reframe it: event/listener vs. loop property, §2e); durable state at controller/session scope (per agent id) · **Backlog / Medium** | — | — |
| FIX-931 | Over-spawning guard: cap total ENQUEUED tasks (`maxPendingTasks` at `addTask`) | Owns the concurrency-cap question; enforced in 924's `validateAssignee` gate · aligns to 923's on-demand floor · **count ACCUMULATES across host wakes** · task-count sibling of FIX-933 | — | — |
| FIX-920 | Re-introduce fork-like sub-execution via a task context-supply mode | Context source (inherit) — **ships bounded by default** (`history: { limit: { turns: N } }`); builds on 918's `agents:` parser, **not gated on 923** | [#853](https://github.com/fixpoint-labs/flow-state-dev/pull/853) (ready) | — |
| FIX-927 | agent-ref agents can't carry board-scoped taskTools for mid-drain fan-out | Delegation plumbing bug — one-field `boardTaskTools` threading; **sequences independently** | — | — |
| FIX-928 | Memoize / dedup the delegation-surface helpers | Polish of 918's surface (`delegation-surface.ts`, `library.ts`); independent, anytime after 918 · Medium | — | — |
| FIX-925 | Assign a task board task directly to a tool | Extends the dispatch surface (agent-vs-tool participant kind in `worker-step.ts`) 924 / 927 touch — a task-assignment axis | — | — |
| FIX-921 | Skills define resources / task blackboard | **Output half** of worker context supply (920 = input/inherit); has a workaround → **late / low-priority** | — | — |
| FIX-932 | Delegation authoring guide + canonical worked example (docs) | **Blocked-by 923 / 641 / 920 / 924** — documents the settled surface; **lands last** | — | — |
| FIX-933 | Cost/budget ceiling for delegated work — spend cap to bound runaway delegation | **Deferred (Backlog / Low)** — spend-based sibling guard to FIX-931 (931 caps task *count*, 933 caps *spend*; both **accumulate across wakes**); `relates-to` FIX-931; **not in the epic's first pass** | — | — |

FIX-918 leads the index as the **already-shipped foundation** (Done, both spec PRs and the
impl PR merged — no pending gates); FIX-923 is the **now-decided keystone** the middle rows
align to; those middle rows are the follow-on work that builds on the surface; FIX-933 trails
as a **deferred backlog guard**, filed so it isn't lost but not scheduled into the first pass.

**Related, outside the epic (`relates-to` FIX-930, not sub-issues):**

- **FIX-482 — `utility.contextSelector`.** General goal-aware context-pruning for *any* LLM
  block. Moved out: not delegation-specific, and 920's bounded-by-default inheritance
  removes the hard dependency. It stays a related neighbor because it composes with 920's
  inherited context (inherit → prune). The **LLM-summarization single-owner** concern
  (482's `strategy: "llm"` vs. flow-policy's `compact` stub) is parked with 482 as a related
  concern — the epic does not need it resolved in-scope.
- **FIX-917 — block-state 4-key consolidation.** A block-state ergonomic fast-follow to
  FIX-914 — consolidate the four top-level state-schema keys into one `state` key and warn on
  silent suspend-reset. Adjacent to the block-based worker surface but **not part of the
  delegation substrate**, and lower priority; the human reviewed it and moved it out. Its
  spec PR #866 is **not an epic concern** — it rides with the FIX-914 block-state work, not
  this set. (Note: 923's decision keeps a woken host's durable state at controller/session
  scope, **not** block scope, so the epic has **no hard FIX-917 dependency**.)

**Index notes.**

- **FIX-920 spec (#853) carries pre-918 vocabulary.** Its text still references `workers:` /
  `WorkerSpec`, which predate FIX-918's rename to `agents:`. Same class of stale-text flag as
  FIX-641's issue text (see §4 Q5) — the spec needs a post-918 vocabulary refresh at its own
  review; the code dependency it points at is the `agents:` parser, not a `workers:` parser.
- **FIX-641 issue text** carries pre-918 vocabulary (`packages/skills`, `WorkerSpec`,
  `agent-ref`/FIX-450); refresh it now 923 has landed, so the refreshed shape matches 923's
  decided class+identity-over-a-floor model.

---

## 4. Open cross-cutting questions

Questions above any one issue, for the human / raised by review. None block the epic
*direction*; they are decisions landed at the objective gate and the per-issue approval
gates. Q1 is now **resolved** by 923's decision; Q2 is **resolved** now 923 landed; Q3 and
Q4 are deferred (Q4 recast to the decided floor); Q5 is housekeeping; **Q6 stays OPEN** with
the two remaining design spikes.

1. **FIX-923 Decision-5 fork — RESOLVED: floor now, class+identity via FIX-641.** The old
   fork (fallback-first *vs.* class+identity personas) was decided as **both, sequenced**:
   - **the default-worker floor ships first** — wire the existing but **unwired
     `keyedRouter.fallback`** so an undeclared/explicit-ad-hoc `assignee` routes to a default
     worker. **Caveat — this path is *not* free:** today the router `select` **throws before
     `fallback`** (`worker-step.ts:213`), and `TaskInit.context` / `metadata` are **not
     injected into the worker prompt** (`workerInputSchema` omits `context`; persona resolves
     from the static `Agent.persona`), so the floor needs **the fallback path wired plus
     explicit prompt/context injection** before it works;
   - **then FIX-641 adds class+identity runtime personas** — a parallel `identity` dimension
     layered on a known worker class, the fuller specialization surface, **on top of the
     floor**.

   So it is not either/or: the uniform floor is the baseline, and 641's class+identity is the
   specialization layer above it. FIX-924's rule (mode-based) and FIX-641's build both align
   to this decided shape.

2. **FIX-924 blocked-by — RESOLVED now that 923 landed.** #865 carries `spec approved`; a
   Linear **`blocked-by FIX-923`** relation held it so it would not ramp off the label alone,
   because its `validateAssignee` rule was only finalized once 923's host-model decision
   landed. **923 has landed** and the rule is decided (**mode-based**: strict-roster rejects /
   validate-but-allow-fallback accepts→floor), so the blocked-by is **satisfied** — 924 can
   ramp against the decided rule.

3. **Total cost / budget cap — filed as FIX-933 (deferred, Backlog / Low).** A configurable
   budget ceiling so a runaway delegated run can't blow a spend budget, distinct from and
   **broader than** FIX-931's enqueue cap (931 caps the *count* of pending tasks; 933 caps
   cumulative *spend*). **Both caps must ACCUMULATE across host wakes, not reset per
   invocation** — a background/controller-loop host that wakes repeatedly must not get a fresh
   budget each wake. `relates-to` FIX-931. Explicitly **deferred** — captured so it isn't
   lost, not scheduled into the epic's first pass.

4. **On-demand FLOOR — DECIDED (the floor), impl home still to assign.** 923 chose the
   uniform default-worker floor (there is **no host-as-IC slot** to wire — the host is
   coordinator+synthesizer). What remains is *where the floor is built*: the `keyedRouter.fallback`
   wiring plus prompt/context injection (the not-zero-code caveat in Q1) need an implementation
   home — **decide whether to rescope FIX-641 to cover the floor or file a new issue** for the
   floor distinct from 641's class+identity layer. A concrete follow-up now that 923 has landed.

5. **Stale pre-918 vocabulary — FIX-920 spec (#853) and FIX-641's text.** Both carry
   `workers:` / `WorkerSpec` vocabulary that predates the `agents:` rename. **Refresh at each
   issue's own review**, not in this epic-spec — this doc does not edit issue/spec text;
   surfaced so the fleet / human reconcile it at the respective gates.

6. **Sequencing of controller-loop background execution (FIX-929 / FIX-901) vs. FIX-923 —
   OPEN.** 923 decided the host model **without foreclosing** the controller-owns-its-loop /
   background-drain model (923's framing: `runBoard` as a loop iteration with the same
   suspend/resume semantics; durable state at controller/session scope per agent id). The
   human flagged that model as highly relevant to the host but was **explicitly unsure whether
   it must block the rest** — it may need to be settled before, alongside, or after the
   dependent build work. *For the human to decide — the sequencing is not pre-decided here.*
   Coupled reconciliation the **FIX-929 spike owes**: the **controller-loop wake model** (the
   generator ends its turn after `runBoard`; the loop wakes it on task completion,
   per-completion or all-done per `runBoard` config) vs. **FIX-901's current
   event/listener/notification direction** — 929 picks one home. The controller-loop model's
   **viability is unproven**; the FIX-929 spike is what sorts it.
