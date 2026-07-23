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

**Why this body of work.** FIX-918 (spec PRs #850/#855, impl PR #854 — **shipped**,
merged 2026-07-22) landed the board-commanded delegation model: a skill declares a roster
under `agents:`, the coordinating host plans work with
`addTask({ goal, assignee, deps, input })`, and drains it with `runBoard` (the old
`context: pattern` / `context: fork` skill execution modes were removed). That landing was
deliberately kept focused, and it left a *cluster* of tightly-coupled follow-ons and open
design decisions all sitting on the **same delegation surface** —
`worker-materializer.ts`, `task-tools-capability.ts`, `worker-step.ts`, the substrate
`TaskInit`, and the `keyedRouter` dispatch. Decided in isolation they would contradict each
other: the most concrete example is that FIX-924 wants to **reject** an unknown assignee at
creation while FIX-923's on-demand direction wants to **accept** an explicitly ad-hoc one.
This epic exists so those cross-cutting calls are made together rather than in a vacuum —
and it **includes FIX-918 itself as the shipped foundation** (parented under the epic), so
the delegation surface and everything built on it are discoverable from one place and the
sequencing story reads end-to-end.

**Outcome we are signing off on.** A *coherent* delegation substrate built on a foundation
that is already in place:

- the **delegation foundation is already shipped** — FIX-918 delivered the
  board-commanded agent-team delegation surface (skills declare `agents:`; the host plans
  with `addTask` and drains with `runBoard`; pattern-mode and fork-mode removed). It is
  **Done**; it carries no spec-approval gate and no implementation under this epic. It is
  included so the sequencing story is complete and the set is navigable from one issue, and
  its surface gets a small polish pass (FIX-928);
- the **host model is decided once — but that decision is not yet made.** FIX-923 is the
  keystone, and it is a **draft research spike the human is actively reviewing now** (spec
  PR #864, Part I only). Its *candidate* outcome — a manager-plus-synthesizer host, an
  on-demand fallback worker as a floor, and per-task runtime identities as the
  specialization layer — is a **recommendation pending FIX-923 approval, not a settled
  decision.** The gate on #864 is what turns that candidate into the substrate's shape;
  until then, everything that "agrees with the host model" below is contingent on it. How
  the chosen host is *packaged* (an `Agent` wrapper or not) is a second design question that
  sequences behind 923 (FIX-929);
- **assignment and dispatch validation agrees with whatever host model 923 lands** — one
  `validateAssignee` gate whose rule is **finalized by 923's outcome** (FIX-924, held until
  923 decides — no longer "ship strict now"); runtime identities layer on a known class
  *only if* 923 chooses the class+identity shape (FIX-641); the dispatch surface also grows a
  task→tool assignment axis (FIX-925) and an enqueue-count cap so on-demand can't over-spawn
  (FIX-931);
- **workers can receive the right context** — inherit the parent conversation when they
  need it, **bounded by default** (FIX-920), and expose shared task resources / a blackboard
  so workers can hand results back (FIX-921, the output half). Proactive ambient-context
  pruning is a *related neighbor outside this epic* (FIX-482, `relates-to`): 920's
  bounded-by-default inheritance removes the hard dependency, so the epic does not need it
  in-scope;
- **the delegation plumbing bugs and substrate underneath are closed** — `agent-ref`
  agents can fan out mid-drain (FIX-927), and the block-state declaration surface the
  block-based workers sit on is consolidated (FIX-917, a **core member** of the substrate);
- **the surface is documented** — one authoring guide plus a canonical worked example once
  the shape settles (FIX-932).

This is **mostly rewiring plus two decision/design spikes and a docs pass**, not a new
subsystem. Every primitive already exists on `main`; the work is threading fields through a
few layers, wiring an already-present-but-unused router `fallback`, drawing clean lines
between overlapping context seams, and writing it down.

**What ramps when the objective is approved.** Per the objective gate
(`orchestration.md` §Gates), applying `epic approved` releases the epic's sub-issues from
NEEDS_SPEC so they can ramp. There is **no adjacent-optional carve-out** — with FIX-482
moved out to a related neighbor and FIX-917 confirmed as a core member of the substrate,
every remaining sub-issue is in-scope. What actually paces the work is not the gate but the
**sequencing spine**: even after `epic approved`, most of the set holds behind **FIX-923**,
the keystone. FIX-924 / FIX-641 / FIX-929 / FIX-931 wait on 923's decision; FIX-920 /
FIX-927 / FIX-928 / FIX-925 / FIX-917 can move independently; FIX-921 is late / low-priority
and FIX-932 (docs) lands last. Approving the objective authorizes the set; 923 unblocks the
part of it that depends on the host model.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **FIX-918 is the shipped foundation, folded into the set as a completed member.** It is
  **Done** (impl PR #854 merged 2026-07-22); it carries no spec-approval gate and no
  implementation under this epic. It is in the epic so the delegation surface and the
  follow-ons that build on it live under one parent and the sequencing story reads
  end-to-end. Approving the objective does not re-open it.
- **The build load is honest about what is a build vs. a recommendation.** FIX-923 and
  FIX-929 are **spikes** — 923 produces a host-model recommendation, 929 a host-packaging
  design; neither ships code as its deliverable. FIX-932 is **docs**. The actual *build*
  issues are FIX-920, FIX-927, FIX-641, FIX-924, FIX-917, FIX-925, FIX-928, FIX-931, and
  FIX-921. They share the same files (`worker-materializer.ts`, `worker-step.ts`, the
  `TaskInit` / `keyedRouter` dispatch, the delegation-surface helpers) and carry hard
  sequencing dependencies (923 gates 641 / 929 / 931 and finalizes 924; 927 and 925 are
  one-surface changes on the same materializer / dispatch path). Rolling them up is correct,
  and it does **not** overbuild *as delegation* — no issue adds surface another makes
  redundant once the host model is fixed.
- **FIX-917 (block-state 4-key consolidation) is a core member, not a ride-along.** It
  predates the epic, but the human confirmed it is part of the substrate the block-based
  workers sit on — so it is treated as core, with no "includable-or-separable" caveat. It
  sequences independently of 923 (it touches the state-schema surface, not the delegation
  dispatch), but it is in-scope and ramps with the set.
- **FIX-921 is deliberately late and low-priority.** It is the *output* half of worker
  context supply (skills define resources / a task blackboard) and it has a workaround
  today, so it is sequenced after the load-bearing work rather than cut — real, but not on
  the critical path.
- **FIX-482 was pulled out, shrinking the set.** `utility.contextSelector` is general
  context-pruning infrastructure for *any* LLM block, not delegation machinery; 920's
  bounded-by-default inheritance removes the one hard dependency, so 482 is now a
  `relates-to` neighbor, not a sub-issue. The LLM-summarization single-owner reconciliation
  (482's `strategy: "llm"` vs. the flow-policy `compact` stub) **travels out with it** — it
  is parked as a related concern on 482, and 920's bounded default means the epic does not
  need it resolved in-scope.

  Net: the set is one shipped foundation, a keystone decision spike plus a host-packaging
  design spike, a cluster of build issues on one surface, a late output-side issue, and a
  docs pass — coherent as *delegation substrate*, with the one genuinely general utility
  (482) moved out.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-918 shipped; FIX-923 is the keystone (in review now)

FIX-918 is **already shipped** (impl PR #854 merged) — the delegation surface every issue
below builds on, not a step left to sequence. From there, FIX-923 is a
**research/decision spike whose deliverable is a recommendation, not a build** (spec PR
#864, **draft — Part I only; the human is actively reviewing it now**). Sequence it **first
among the remaining work** because its outcome:

- **gates FIX-641** — 641 (dynamic worker identities) is the concrete implementation of
  923's on-demand path; both its **issue-text refresh and its build happen after 923 is
  solid**, so it aligns to 923's chosen shape (class+identity vs. fallback-first — see Q1 in
  §4) rather than pre-committing;
- **finalizes FIX-924's validation rule** — 924 is **held until 923 is decided** (no longer
  "ship strict now and relax later"). Its `validateAssignee` rule is whatever 923 lands: if
  on-demand wins, the rule becomes "reject a *typo'd named-agent reference*, allow an
  *explicit ad-hoc / general* dispatch"; if pre-defined-only wins, it stays strict;
- **gates FIX-929** — the host-*packaging* design spike (Agent vs. AgentController) can only
  decide how to wrap the host once 923 has decided what the host *is*;
- **gates FIX-931** — the enqueue-count cap is load-bearing specifically *because* on-demand
  delegation can over-spawn; its default and shape wait on 923's on-demand decision.

Spine: **918 (shipped foundation) → FIX-923 keystone (in review) → { FIX-641 refresh+build,
FIX-924 rule-widening, FIX-929 host-packaging design, FIX-931 enqueue cap }**. Building on
918's surface **largely independently of 923** (they can progress in parallel): **FIX-920**
(context inherit), **FIX-927** (mid-drain fan-out bug), **FIX-928** (surface polish),
**FIX-925** (task→tool assignment). **FIX-917** (block-state) is independent of the
delegation dispatch entirely. **FIX-921** (task blackboard / resources) is late and
low-priority. **FIX-932** (docs) lands last, once the surface settles.

### 2b. The shared assignee / identity / dispatch gate (923 ↔ 924 ↔ 641 ↔ 925 ↔ 927 ↔ 931)

The single source of truth for "who is a valid participant, and can it take this task" is
the board's worker registry and the dispatch surface around it. Several issues touch it and
must not disagree:

- **FIX-924 centralizes validation in one `validateAssignee` gate** (the roster is assembled
  in `buildWorkerRoster`, near `agentPurpose`) so context, validation, and dispatch cannot
  drift. Its rule is **finalized by FIX-923** (held until 923 decides), so 923's outcome is
  a *one-function widening* of a single gate rather than a scatter of edits.
- **FIX-641's runtime identity** — *if* 923 chooses the class+identity shape — rides on a
  **known class** (`assignee` stays the routing key; `identity` is orthogonal to roster
  validation).
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
  **gated on 923's on-demand decision** (a cap only matters once the host can spawn freely).

Net: one dispatch surface, one validation gate, several axes (agent vs. tool, valid vs.
ad-hoc, under vs. over the enqueue cap) — all finalized by 923's host-model choice.

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

### 2e. Block-state substrate (FIX-917) — a core member

Consolidate the four top-level state-schema keys (`stateSchema`, `parentStateSchema`,
`sequencerStateSchema`, `targetStateSchemas`) into one `state` key with sub-keys
(`own`/`parent`/`sequencer`/`targets`), and warn on silent suspend-reset of a
non-sequencer block's own state. This is the substrate the block-based workers sit on; the
human confirmed it is **part of the delegation substrate** even though it predates the epic,
so it is a **core member** (no adjacent-optional caveat). It sequences **independently of
FIX-923** — it touches the state-schema surface, not the delegation dispatch — but it is
in-scope and ramps with the set.

### 2f. Host-model packaging design (FIX-929) — sequences after 923

Once FIX-923 decides *what* the delegation host is, FIX-929 is a **design spike** on how to
*package* it: **Agent vs. AgentController (`skillController`)** — does the delegation host
need an `Agent` wrapper, or does the controller suffice? **Scope it tightly to the
delegation host**, not a general agent-abstraction redesign: the broader agent-abstraction
question spills into FIX-901 and FIX-817, both of which are **out of this epic**. 929's
question is specifically "does the delegation host need an Agent wrapper," bounded to the
host 923 lands. It **sequences after 923** (you cannot package a host whose shape is
undecided).

### 2g. Delegation authoring docs (FIX-932) — lands last

A delegation **authoring guide plus a canonical worked example**. **Blocked-by
923 / 641 / 920 / 924** — it documents the settled surface, so it lands **late**, once the
host model, identities, context inheritance, and validation rule have all stopped moving.

---

## 3. Running index

The durable audit log of every issue under this epic (**13 sub-issues under FIX-930**).
Refreshed from the fleet's status table (a projection, not a second live source). With
FIX-482 moved out and FIX-917 confirmed core, there is **no adjacent-optional class** —
every row below is a sub-issue in-scope; the **Role** column carries the sequencing story.

| Issue | Title | Role in epic | Spec PR | Impl PR |
|---|---|---|---|---|
| FIX-918 | Remove skill pattern/fork modes; board-commanded agent-team delegation | **Shipped foundation** — the surface the set builds on · **Done, no pending gates** | [#850](https://github.com/fixpoint-labs/flow-state-dev/pull/850), [#855](https://github.com/fixpoint-labs/flow-state-dev/pull/855) (merged) | [#854](https://github.com/fixpoint-labs/flow-state-dev/pull/854) (merged) |
| FIX-923 | Research: delegation host model (manager/IC + on-demand vs pre-defined) | **Keystone (decision spike)** — its gate decides the host model; gates 641 / 924 / 929 / 931 · **human reviewing now** | [#864](https://github.com/fixpoint-labs/flow-state-dev/pull/864) (draft — Part I) | — (no build; deliverable is a recommendation) |
| FIX-924 | Roster-aware task assignment: validate assignee at creation | Validation gate — **held until 923 decides** its rule (strict vs. widen-for-ad-hoc) | [#865](https://github.com/fixpoint-labs/flow-state-dev/pull/865) (`spec approved`) | — |
| FIX-641 | Dynamic worker identities — runtime-bound personas of a worker class | 923's on-demand build — **issue-text refresh + build both after 923 is solid** | — | — |
| FIX-929 | Agent vs AgentController (skillController) — host-packaging design | **Design spike** — how to package the host 923 lands; scoped to the delegation host only · **sequences after 923** | — | — |
| FIX-931 | Over-spawning guard: cap total ENQUEUED tasks (`maxPendingTasks` at `addTask`) | Owns the concurrency-cap question; enforced in 924's `validateAssignee` gate · **gated on 923's on-demand decision** | — | — |
| FIX-920 | Re-introduce fork-like sub-execution via a task context-supply mode | Context source (inherit) — **ships bounded by default** (`history: { limit: { turns: N } }`); builds on 918's `agents:` parser, **not gated on 923** | [#853](https://github.com/fixpoint-labs/flow-state-dev/pull/853) (ready) | — |
| FIX-927 | agent-ref agents can't carry board-scoped taskTools for mid-drain fan-out | Delegation plumbing bug — one-field `boardTaskTools` threading; **sequences independently** | — | — |
| FIX-928 | Memoize / dedup the delegation-surface helpers | Polish of 918's surface (`delegation-surface.ts`, `library.ts`); independent, anytime after 918 · Medium | — | — |
| FIX-925 | Assign a task board task directly to a tool | Extends the dispatch surface (agent-vs-tool participant kind in `worker-step.ts`) 924 / 927 touch — a task-assignment axis | — | — |
| FIX-917 | Block state fast-follows: consolidate 4-key schema, warn on suspend-reset | **Core substrate member** — block-based workers sit on it; sequences independently of 923 | [#866](https://github.com/fixpoint-labs/flow-state-dev/pull/866) (ready) | — |
| FIX-921 | Skills define resources / task blackboard | **Output half** of worker context supply (920 = input/inherit); has a workaround → **late / low-priority** | — | — |
| FIX-932 | Delegation authoring guide + canonical worked example (docs) | **Blocked-by 923 / 641 / 920 / 924** — documents the settled surface; **lands last** | — | — |

FIX-918 leads the index as the **already-shipped foundation** (Done, both spec PRs and the
impl PR merged — no pending gates); the remaining rows are the follow-on work that builds on
its surface.

**Related, outside the epic (`relates-to` FIX-930, not a sub-issue):**

- **FIX-482 — `utility.contextSelector`.** General goal-aware context-pruning for *any* LLM
  block. Moved out: not delegation-specific, and 920's bounded-by-default inheritance
  removes the hard dependency. It stays a related neighbor because it composes with 920's
  inherited context (inherit → prune). The **LLM-summarization single-owner** concern
  (482's `strategy: "llm"` vs. flow-policy's `compact` stub) is parked with 482 as a related
  concern — the epic does not need it resolved in-scope.

**Index notes.**

- **FIX-920 spec (#853) carries pre-918 vocabulary.** Its text still references `workers:` /
  `WorkerSpec`, which predate FIX-918's rename to `agents:`. Same class of stale-text flag as
  FIX-641's issue text (see §4 Q4) — the spec needs a post-918 vocabulary refresh at its own
  review; the code dependency it points at is the `agents:` parser, not a `workers:` parser.
- **FIX-641 issue text** carries pre-918 vocabulary (`packages/skills`, `WorkerSpec`,
  `agent-ref`/FIX-450); refresh it when 641 is picked up after 923, so the refreshed shape
  matches whatever 923 lands.

---

## 4. Open cross-cutting questions

Questions above any one issue, for the human / raised by review. None block the epic
*direction*; they are decisions to land at the objective gate and the per-issue approval
gates. The set is deliberately small now: the live decision (Q1) sits with the keystone
spike, two are explicitly deferred (Q2, Q3), and one is housekeeping (Q4).

1. **FIX-923 Decision-5 fork — the live decision the human is reviewing now:
   fallback-first vs. class+identity personas.**
   - **(a) fallback-first (the smaller path).** Wire the existing but **unwired
     `keyedRouter.fallback`** — route an explicit ad-hoc / general assignee to a fallback
     worker, and carry any persona via the existing `TaskInit.context` / `metadata`.
     **Caveat — this path is *not* free:** today `TaskInit.context` / `metadata` are **not
     injected into the worker prompt** (`workerInputSchema` omits `context`; persona resolves
     from the static `Agent.persona`), so the fallback path needs **explicit prompt/context
     wiring** before it works.
   - **(b) FIX-641 class+identity runtime personas.** A parallel `identity` dimension layered
     on a known worker class — the fuller specialization surface.

   923 weighs the **smaller-but-needs-wiring** path (a) against the **fuller identity
   dimension** (b). FIX-924's rule and FIX-641's build both hinge on which wins.
   *Needs the human at 923's approval gate — do not pre-decide here.*

2. **Total cost / budget cap (deferred, human-flagged).** Distinct from and **broader than**
   FIX-931's enqueue cap: a **spend ceiling** so a runaway epic can't blow a budget, not just
   a count of pending tasks. Explicitly **"later"** — captured here as a future cross-cutting
   concern **related to FIX-931**, not yet an issue. Recorded so it is not lost.

3. **On-demand FLOOR (GAP B, deferred).** *If* 923 chooses on-demand, the
   uniform-fallback / accept-explicit-ad-hoc path **plus host-as-IC wiring** have **no
   implementation issue yet**. Decide *then* whether to rescope FIX-641 to cover it or file a
   new issue. **Deferred until 923 lands** — there is nothing to decide until the host model
   is chosen.

4. **Stale pre-918 vocabulary — FIX-920 spec (#853) and FIX-641's text.** Both carry
   `workers:` / `WorkerSpec` vocabulary that predates the `agents:` rename. **Refresh at each
   issue's own review**, not in this epic-spec — this doc does not edit issue/spec text;
   surfaced so the fleet / human reconcile it at the respective gates.
