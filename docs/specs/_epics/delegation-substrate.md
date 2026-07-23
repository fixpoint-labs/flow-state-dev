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
`worker-materializer.ts`, `task-tools-capability.ts`, the substrate `TaskInit`, and the
`keyedRouter` dispatch. Decided in isolation they would contradict each other: the most
concrete example is that FIX-924 wants to **reject** an unknown assignee at creation while
FIX-923's on-demand direction wants to **accept** an explicitly ad-hoc one. This epic
exists so those cross-cutting calls are made together rather than in a vacuum — and it
**includes FIX-918 itself as the shipped foundation** (parented under the epic), so the
delegation surface and everything built on it are discoverable from one place and the
sequencing story reads end-to-end.

**Outcome we are signing off on.** A *coherent* delegation substrate built on a foundation
that is already in place:

- the **delegation foundation is already shipped** — FIX-918 delivered the
  board-commanded agent-team delegation surface (skills declare `agents:`; the host plans
  with `addTask` and drains with `runBoard`; pattern-mode and fork-mode removed). It is
  **Done**; it carries no spec-approval gate and no implementation under this epic. It is
  included so the sequencing story is complete and the set is navigable from one issue;
- the **host model** is decided once (manager-plus-synthesizer; on-demand fallback worker
  as a floor; per-task runtime identities as the specialization layer) — FIX-923, the
  keystone research spike;
- **assignment validation** agrees with that host model — one `validateAssignee` gate that
  is strict today and widens by one function when on-demand lands (FIX-924), with runtime
  identities layered on a known class (FIX-641);
- **workers can receive the right context** — inherit the parent conversation when they
  need it (FIX-920) and prune ambient context proactively (FIX-482);
- **the delegation plumbing bugs and substrate underneath are closed** — `agent-ref`
  agents can fan out mid-drain (FIX-927), and the block-state declaration surface the
  block-based workers sit on is consolidated (FIX-917).

This is **mostly rewiring plus one decision spike**, not a new subsystem. Every primitive
already exists on `main`; the work is threading fields through a few layers, wiring an
already-present-but-unused router `fallback`, and drawing clean lines between overlapping
context seams.

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **FIX-918 is the shipped foundation, folded into the set as a completed member.** It is
  **Done** (impl PR #854 merged 2026-07-22); it carries no spec-approval gate and no
  implementation under this epic. It is in the epic so the delegation surface and the
  follow-ons that build on it live under one parent and the sequencing story reads
  end-to-end (918 shipped → the build/decision issues below). Approving the objective does
  not re-open it.
- The **five core delegation issues — FIX-923, FIX-920, FIX-927, FIX-641, FIX-924 — are
  genuinely one body of work.** They share the same files, and they carry hard sequencing
  dependencies (923 gates 641 and narrows 924; 927 is a one-file bug on the very same
  materializer). Rolling them up is correct, and it does **not** overbuild *as delegation*
  — no issue adds surface another makes redundant once the host model is fixed.
- **Two issues are only loosely coupled and are called out honestly:**
  - **FIX-917 (block-state 4-key consolidation + suspend-reset warning)** is a *fast-follow
    of FIX-914*, not delegation-specific. It rides along because it is adjacent substrate
    the block-based workers sit on and the same authors are touching it — but it would
    stand alone as its own change. Includable or separable; the human should decide with
    eyes open.
  - **FIX-482 (`utility.contextSelector`)** is a general context-pruning utility for *any*
    LLM block. It has **one real delegation touchpoint** — it composes with FIX-920's
    inherited conversation context (inherit → prune) — but it is not delegation machinery.
    Same includable-or-separable status.

  The recommendation is to keep 917 and 482 in the epic for coherence (they touch the same
  reviewers and the same context/state seams), while being explicit that neither is load-
  bearing for the delegation objective. Approving the epic does not commit to building
  them inside it.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-918 shipped; FIX-923 is the keystone

FIX-918 is **already shipped** (impl PR #854 merged) — the delegation surface every issue
below builds on, not a step left to sequence. From there, FIX-923 is a
**research/decision spike whose deliverable is a recommendation, not a build** (spec PR
#864, Part I drafted; Part II in the doc). Sequence it **first among the remaining work**
because its outcome:

- **gates FIX-641** — 641 (dynamic worker identities) is the concrete implementation of
  923's Q2 "on-demand" path. 641 is `blocked-by` 923 in Linear and must not build until
  923's shape (class+identity vs. pure-ad-hoc vs. uniform-only) is chosen. 923's current
  recommendation is exactly 641's class+identity shape.
- **narrows FIX-924's validation rule** — 923 Decision 5 reconciles the contradiction: the
  rule becomes "reject a *typo'd named-agent reference*, allow an *explicit ad-hoc /
  general* dispatch," not "reject every undeclared assignee."

Spine: **918 (shipped foundation) → 923 → { 641 build, 924 rule-widening }**, with 920/927
building on 918's surface in parallel and 917/482 independent.

### 2b. The shared assignee / identity validation gate (923 ↔ 924 ↔ 641)

The single source of truth for "who is a valid assignee" is the board's worker registry.
FIX-924 centralizes the check in **one `validateAssignee` gate** so that context,
validation, and dispatch cannot disagree, and so 923's on-demand outcome is a *one-function
widening* rather than a scatter of edits. FIX-641's runtime identity rides on a **known
class** (`assignee` is still the routing key; `identity` is orthogonal to roster
validation). Net: three issues, one gate.

### 2c. Context flow to workers (920 `contextSupply` ↔ 482 `contextSelector`)

Two complementary directions on the same worker context window — keep the lines clean so
we do not build two overlapping selectors:

- **FIX-920 adds a source** — a `conversation` context-supply mode wires the worker's
  generator `history` slot to the parent conversation up to the dispatch point, while
  `itemVisibility: { history: false }` keeps the sub-execution out of host history
  (fork-like: inherit everything, hand back only the result).
- **FIX-482 prunes ambient sources** — proactive, goal-aware trimming of working-memory
  facts, semantic-memory results, MCP output, and history for any LLM block.
- **They compose: inherit → prune.** The boundary lines (from 482's own re-scope):
  `TaskFlowPolicy` owns **inter-worker observations**; `contextSelector` owns **ambient
  sources**; FIX-920's `conversation` mode is a **third source** (the parent turn). No two
  of these should grow a second overlapping selector, and LLM-summarization must have a
  single home (482's `strategy: "llm"` vs. flow-policy's `compact` stub — decide, don't
  grow both).

### 2d. FIX-918 — the shipped foundation this substrate builds on

FIX-918 landed the board-commanded delegation model — skills declare a roster under
`agents:`, the host plans with `addTask` and drains with `runBoard`, and the old
`context: pattern` / `context: fork` skill execution modes were removed. It is **Done**
(spec PRs #850/#855, impl PR #854 merged 2026-07-22). FIX-920 builds directly on its
decoupled `workers:` parser + delegation preset that make a declared worker callable, and
the whole set assumes its surface as already landed. It is **in this epic as the completed
foundation** — parented under FIX-930 so the surface and its follow-ons are discoverable
from one place — and needs no approval gate or implementation here.

### 2e. Block-state substrate (FIX-917) — adjacent, supporting

Consolidate the four top-level state-schema keys (`stateSchema`, `parentStateSchema`,
`sequencerStateSchema`, `targetStateSchemas`) into one `state` key with sub-keys
(`own`/`parent`/`sequencer`/`targets`), and warn on silent suspend-reset of a
non-sequencer block's own state. Substrate the block-based workers sit on; a fast-follow of
FIX-914, not delegation-specific (see §1 holistic check).

### 2f. Delegation plumbing bug (FIX-927) — same file as the identity work

`agent-ref` agents that carry `taskTools` don't get the board-scoped capability, so
mid-drain fan-out returns `no_delegation_board`. Narrow, but it lives in the same
`worker-materializer.ts` / `materialize-agent.ts` surface FIX-641 rewires — natural to
sequence alongside the identity work rather than in isolation.

---

## 3. Running index

The durable audit log of every issue PR under this epic. Refreshed from the fleet's status
table (a projection, not a second live source).

| Issue | Title | Role in epic | Spec PR | Impl PR |
|---|---|---|---|---|
| FIX-918 | Remove skill pattern/fork modes; board-commanded agent-team delegation | **Shipped foundation** — the surface the set builds on · **Done, no pending gates** | [#850](https://github.com/fixpoint-labs/flow-state-dev/pull/850), [#855](https://github.com/fixpoint-labs/flow-state-dev/pull/855) (merged) | [#854](https://github.com/fixpoint-labs/flow-state-dev/pull/854) (merged) |
| FIX-923 | Research: delegation host model (manager/IC + on-demand vs pre-defined) | **Keystone** — gates 641, narrows 924 | [#864](https://github.com/fixpoint-labs/flow-state-dev/pull/864) (draft — Part I) | — |
| FIX-924 | Roster-aware task assignment: validate assignee at creation | Validation gate (923 widens it) | [#865](https://github.com/fixpoint-labs/flow-state-dev/pull/865) (closed unmerged · `spec approved`) | — |
| FIX-920 | Re-introduce fork-like sub-execution via a task context-supply mode | Context source (inherit) | [#853](https://github.com/fixpoint-labs/flow-state-dev/pull/853) (ready) | — |
| FIX-641 | Dynamic worker identities — runtime-bound personas of a worker class | 923's on-demand build (class+identity) | — | — |
| FIX-927 | agent-ref agents can't carry board-scoped taskTools for mid-drain fan-out | Delegation plumbing bug | — | — |
| FIX-917 | Block state fast-follows: consolidate 4-key schema, warn on suspend-reset | Adjacent substrate (loosely coupled) | [#866](https://github.com/fixpoint-labs/flow-state-dev/pull/866) (ready) | — |
| FIX-482 | `utility.contextSelector` — composable goal-aware context pruning | Context pruning (composes w/ 920; loosely coupled) | — | — |

FIX-918 leads the index as the **already-shipped foundation** (Done, both spec PRs and the
impl PR merged — no pending gates); the remaining rows are the follow-on work that builds
on its surface.

---

## 4. Open cross-cutting questions

Questions above any one issue, for the human / raised by review. None of these block the
epic *direction*; they are decisions to land at the per-issue approval gates.

1. **FIX-924 — ship strict now vs. hold for FIX-923.** 924's spec recommended shipping the
   strict "declared-worker-only" rule now and letting 923 relax it. That recommendation
   appears **accepted**: PR #865 carries the `spec approved` label and FIX-924 is in
   *Spec Approved*. The **residual cross-cutting obligation** is that when 923's on-demand
   outcome lands, the single `validateAssignee` gate must widen by one function to allow an
   explicit ad-hoc / general dispatch (a bare unknown string stays invalid — the typo
   case). This widening must be folded into the FIX-641 / FIX-924 implementation, not
   forgotten. *Needs a human to confirm the ship-now decision is final and owns the
   follow-up widening.*

2. **FIX-641 issue-text refresh vs. 923's chosen shape.** FIX-923's spec and issue both
   flag that 641's framing predated FIX-918 (referenced the removed `packages/skills`,
   `WorkerSpec`, `agent-ref`/FIX-450 surface). **Current state:** 641's issue text now
   carries a "Refreshed onto the FIX-918 / PR #854 architecture" note — the refresh appears
   already done since 923 wrote its blocking note. The **residual open question** is
   confirming 641's refreshed shape matches 923's *recommended* class+identity shape once
   923 is approved (not pure-ad-hoc, not uniform-only). *This epic does not edit 641's text
   — surfaced for the fleet / human to reconcile at 923's approval gate.*

3. **Over-spawning / concurrency cap — deferred by 923 to 641/924.** 923 Decision 6 holds
   that defaults for an undescribed worker (model/toolset) and an **over-spawning guard**
   (roster-size / concurrency cap on the drain) are load-bearing, not incidental — the
   documented failure mode of on-demand delegation is token blow-up. 923 explicitly
   **defers the exact cap shape to FIX-641 / FIX-924.** *A human needs to decide where the
   cap lives and its shape before on-demand delegation ships — it is currently owned by no
   single issue.*

4. **Scope of the epic itself — do FIX-917 and FIX-482 build inside it or ship
   independently?** Both are only loosely coupled (§1). They can stay in the epic for
   coherence or be split out as standalone changes. *A human should make this call at
   objective sign-off; approving the epic's purpose does not commit to building 917/482
   inside it.*
