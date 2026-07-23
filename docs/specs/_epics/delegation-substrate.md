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
- the **host model is decided once — but that decision is not yet made.** FIX-923 is the
  keystone, and it is a **draft research spike** (spec PR #864, Part I only). Its *candidate*
  outcome — a manager-plus-synthesizer host, an on-demand fallback worker as a floor, and
  per-task runtime identities as the specialization layer — is a **recommendation pending
  FIX-923 approval, not a settled decision.** The gate on #864 is what turns that candidate
  into the substrate's shape; until then, everything that "agrees with the host model"
  below is contingent on it;
- **assignment validation agrees with whatever host model 923 lands** — one
  `validateAssignee` gate that is strict today and widens by one function *if* on-demand
  lands (FIX-924); runtime identities layer on a known class *only if* 923 chooses the
  class+identity shape (FIX-641);
- **workers can receive the right context** — inherit the parent conversation when they
  need it (FIX-920) and prune ambient context proactively (FIX-482);
- **the delegation plumbing bugs and substrate underneath are closed** — `agent-ref`
  agents can fan out mid-drain (FIX-927), and the block-state declaration surface the
  block-based workers sit on is consolidated (FIX-917).

This is **mostly rewiring plus one decision spike**, not a new subsystem. Every primitive
already exists on `main`; the work is threading fields through a few layers, wiring an
already-present-but-unused router `fallback`, and drawing clean lines between overlapping
context seams.

**What ramps when the objective is approved — and what does not.** Per the objective gate
(`orchestration.md` §Gates), applying `epic approved` releases the epic's **core** members
from NEEDS_SPEC so they can ramp. It does **not** auto-ramp the two **adjacent-optional**
members (FIX-917, FIX-482): they are includable-or-separable by design, and they hold until
an explicit human opt-in per issue. Approving the epic's *purpose* is not a commitment to
build 917/482 inside it. (Without this carve-out the objective gate would accidentally ramp
adjacent substrate the human hasn't decided to fund here — hence the explicit rule.)

**Holistic-necessity check (does the *set* overbuild even if each issue earns its place?).**

- **FIX-918 is the shipped foundation, folded into the set as a completed member.** It is
  **Done** (impl PR #854 merged 2026-07-22); it carries no spec-approval gate and no
  implementation under this epic. It is in the epic so the delegation surface and the
  follow-ons that build on it live under one parent and the sequencing story reads
  end-to-end (918 shipped → the build/decision issues below). Approving the objective does
  not re-open it.
- **The core is four implementation issues plus one decision spike — FIX-920, FIX-927,
  FIX-641, FIX-924 (builds) and FIX-923 (a research/decision spike, not an implementation).**
  Describing the delivery load honestly matters: FIX-923's deliverable is a recommendation,
  so the epic's actual *build* load is four issues, not five. They share the same files and
  carry hard sequencing dependencies (923 gates 641 and narrows 924; 927 is a one-file bug
  on the very same materializer). Rolling them up is correct, and it does **not** overbuild
  *as delegation* — no issue adds surface another makes redundant once the host model is
  fixed.
- **Two issues are only loosely coupled — `adjacent-optional`, called out honestly:**
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
  bearing for the delegation objective and neither ramps on `epic approved` without an
  explicit opt-in.

---

## 2. Themes & long-horizon direction

### 2a. The sequencing spine — FIX-918 shipped; FIX-923 is the keystone (still open)

FIX-918 is **already shipped** (impl PR #854 merged) — the delegation surface every issue
below builds on, not a step left to sequence. From there, FIX-923 is a
**research/decision spike whose deliverable is a recommendation, not a build** (spec PR
#864, **draft — Part I only**; the decision is not yet made). Sequence it **first among the
remaining work** because its outcome:

- **gates FIX-641** — 641 (dynamic worker identities) is the concrete implementation of
  923's on-demand path. 641 is `blocked-by` 923 in Linear and must not build until 923's
  shape (class+identity vs. fallback-first vs. uniform-only — see Q1 in §4) is chosen. 923's
  *current recommendation* leans class+identity, but that is a candidate, not a settled
  outcome; 641 aligns to whatever 923's gate lands.
- **narrows FIX-924's validation rule** — 923 Decision 5 reconciles the contradiction: *if*
  on-demand lands, the rule becomes "reject a *typo'd named-agent reference*, allow an
  *explicit ad-hoc / general* dispatch," not "reject every undeclared assignee."

Spine: **918 (shipped foundation) → 923 → { 641 build, 924 rule-widening }**, with 920 and
927 building on 918's surface **in parallel and independently** (neither is gated on 923),
and 917/482 independent.

### 2b. The shared assignee / identity validation gate (923 ↔ 924 ↔ 641)

The single source of truth for "who is a valid assignee" is the board's worker registry.
FIX-924 centralizes the check in **one `validateAssignee` gate** (the roster is assembled in
`buildWorkerRoster`, near `agentPurpose`) so that context, validation, and dispatch cannot
disagree, and so 923's on-demand outcome is a *one-function widening* rather than a scatter
of edits. FIX-641's runtime identity — *if* 923 chooses the class+identity shape — rides on
a **known class** (`assignee` is still the routing key; `identity` is orthogonal to roster
validation). Net: three issues, one gate. Whether that gate ever widens at all depends on
923's Q1 fork (§4).

### 2c. Context flow to workers (920 `contextSupply` ↔ 482 `contextSelector`)

Two complementary directions on the same worker context window — keep the lines clean so
we do not build two overlapping selectors:

- **FIX-920 adds a source** — a `conversation` context-supply mode wires the worker's
  generator `history` slot to the parent conversation up to the dispatch point, while
  `itemVisibility: { history: false }` keeps the sub-execution out of host history
  (fork-like: inherit everything, hand back only the result). It builds directly on
  FIX-918's decoupled **`agents:` parser** and delegation preset that make a declared worker
  callable (the frontmatter key is `agents:`, not the pre-918 `workers:`; the parser now
  *throws* on legacy `workers:` — `packages/orchestration/src/skills/skill-md.ts`).
- **FIX-482 prunes ambient sources** — proactive, goal-aware trimming of working-memory
  facts, semantic-memory results, MCP output, and history for any LLM block.
- **They compose: inherit → prune.** The boundary lines (from 482's own re-scope):
  `TaskFlowPolicy` owns **inter-worker observations**; `contextSelector` owns **ambient
  sources**; FIX-920's `conversation` mode is a **third source** (the parent turn). No two
  of these should grow a second overlapping selector, and LLM-summarization must have a
  single home (482's `strategy: "llm"` vs. flow-policy's `compact` stub — decide, don't
  grow both; see Q4 in §4).

### 2d. FIX-918 — the shipped foundation this substrate builds on

FIX-918 landed the board-commanded delegation model — skills declare a roster under
`agents:`, the host plans with `addTask` and drains with `runBoard`, and the old
`context: pattern` / `context: fork` skill execution modes were removed. It is **Done**
(spec PRs #850/#855, impl PR #854 merged 2026-07-22). FIX-920 builds directly on its
decoupled **`agents:` parser** + delegation preset that make a declared worker callable, and
the whole set assumes its surface as already landed. It is **in this epic as the completed
foundation** — parented under FIX-930 so the surface and its follow-ons are discoverable
from one place — and needs no approval gate or implementation here.

### 2e. Block-state substrate (FIX-917) — adjacent-optional, supporting

Consolidate the four top-level state-schema keys (`stateSchema`, `parentStateSchema`,
`sequencerStateSchema`, `targetStateSchemas`) into one `state` key with sub-keys
(`own`/`parent`/`sequencer`/`targets`), and warn on silent suspend-reset of a
non-sequencer block's own state. Substrate the block-based workers sit on; a fast-follow of
FIX-914, not delegation-specific (see §1 holistic check). **Adjacent-optional: it does not
ramp on `epic approved` without an explicit opt-in.**

### 2f. Delegation plumbing bug (FIX-927) — same file, sequences independently

`agent-ref` agents that carry `taskTools` don't get the board-scoped capability, so
mid-drain fan-out returns `no_delegation_board`. It is a **one-field threading fix** —
carry `boardTaskTools` through `MaterializeAgentOptions` (in core) so the materializer
receives it, rather than the current inline handling
(`worker-materializer.ts:145-146` vs. the option it should read at `:125-133`). Because it
is a self-contained wiring fix, **it is not gated on 923 or 641 and can land in parallel** —
it lives in the same `worker-materializer.ts` / `materialize-agent.ts` surface FIX-641
rewires, so it is natural to *review* alongside the identity work, but it does not wait on
it.

---

## 3. Running index

The durable audit log of every issue PR under this epic. Refreshed from the fleet's status
table (a projection, not a second live source). **Class** distinguishes the shipped
foundation, the `core` set (ramps on `epic approved`), and the `adjacent-optional` members
(hold for explicit human opt-in — see §1).

| Issue | Title | Class | Role in epic | Spec PR | Impl PR |
|---|---|---|---|---|---|
| FIX-918 | Remove skill pattern/fork modes; board-commanded agent-team delegation | shipped-foundation | The surface the set builds on · **Done, no pending gates** | [#850](https://github.com/fixpoint-labs/flow-state-dev/pull/850), [#855](https://github.com/fixpoint-labs/flow-state-dev/pull/855) (merged) | [#854](https://github.com/fixpoint-labs/flow-state-dev/pull/854) (merged) |
| FIX-923 | Research: delegation host model (manager/IC + on-demand vs pre-defined) | core (decision spike) | **Keystone** — its gate decides the host model; gates 641, narrows 924 | [#864](https://github.com/fixpoint-labs/flow-state-dev/pull/864) (draft — Part I) | — (no build; deliverable is a recommendation) |
| FIX-924 | Roster-aware task assignment: validate assignee at creation | core | Validation gate (923 widens it *if* on-demand lands) · proposed owner of the concurrency cap (Q2) | [#865](https://github.com/fixpoint-labs/flow-state-dev/pull/865) (closed unmerged · `spec approved`) | — |
| FIX-920 | Re-introduce fork-like sub-execution via a task context-supply mode | core | Context source (inherit); builds on 918's `agents:` parser, **not gated on 923** | [#853](https://github.com/fixpoint-labs/flow-state-dev/pull/853) (ready) | — |
| FIX-641 | Dynamic worker identities — runtime-bound personas of a worker class | core | 923's on-demand build (class+identity *if* 923 chooses it) | — | — |
| FIX-927 | agent-ref agents can't carry board-scoped taskTools for mid-drain fan-out | core | Delegation plumbing bug — one-field `boardTaskTools` threading; **sequences independently** | — | — |
| FIX-917 | Block state fast-follows: consolidate 4-key schema, warn on suspend-reset | adjacent-optional | Adjacent substrate; holds for explicit opt-in | [#866](https://github.com/fixpoint-labs/flow-state-dev/pull/866) (ready) | — |
| FIX-482 | `utility.contextSelector` — composable goal-aware context pruning | adjacent-optional | Context pruning (composes w/ 920); holds for explicit opt-in | — | — |

FIX-918 leads the index as the **already-shipped foundation** (Done, both spec PRs and the
impl PR merged — no pending gates); the remaining rows are the follow-on work that builds
on its surface.

**Index notes.**

- **FIX-920 spec (#853) carries pre-918 vocabulary.** Its text still references `workers:` /
  `WorkerSpec`, which predate FIX-918's rename to `agents:`. This is the **same class of
  stale-text flag as FIX-641's** (§4 Q… below) — the spec needs a post-918 vocabulary
  refresh at its review; the code dependency it points at is the `agents:` parser, not a
  `workers:` parser.
- **FIX-641 issue text** carries a "Refreshed onto the FIX-918 / PR #854 architecture" note;
  the residual is confirming the refreshed shape matches whatever 923 lands (§4).

---

## 4. Open cross-cutting questions

Questions above any one issue, for the human / raised by review. None of these block the
epic *direction*; they are decisions to land at the objective gate and the per-issue
approval gates. Several were sharpened by the automated review of the epic PR — the fork in
Q1 and the ownership gaps in Q2/Q3 are the substantive ones.

1. **The host-model fork FIX-923's Decision 5 must resolve — fallback-first vs.
   class+identity.** This is the load-bearing open decision the keystone spike owns; it is
   **not pre-decided here.** Two candidate shapes:
   - **(a) fallback-first (the smaller path).** Wire the existing **`keyedRouter.fallback`**
     — already present in core but currently unwired (`worker-step.ts`, ~`:208`; a
     second registry-miss throw also lives in `dispatch-and-execute.ts`). Route an explicit
     ad-hoc / general assignee to that fallback worker, and carry any persona via the
     existing `TaskInit.context` / `metadata`. Minimal new surface — no parallel identity
     dimension.
   - **(b) FIX-641 class+identity runtime personas.** A parallel `identity` dimension layered
     on a known worker class. Warranted **only if** per-class model/toolset defaults are a
     hard requirement; otherwise it is surface the fallback path already covers.

   923 should weigh (a) explicitly as the smaller path against (b) before recommending. The
   validation-gate widening (Q… below) and 641's build both hinge on which shape wins.
   *Needs the human at 923's approval gate.*

2. **Over-spawning / concurrency cap — proposed owner FIX-924.** `BOARD_CONCURRENCY=4` caps
   parallel *execution*, not the *total tasks enqueued* — a host can `addTask` 50 times and
   the board will drain them four at a time, so the documented token-blow-up failure mode of
   on-demand delegation is not currently bounded at enqueue. Proposed shape: a
   `maxPendingTasks`-style **rejection at `addTask`**, enforced in the same `validateAssignee`
   gate FIX-924 owns. A default must be chosen **before any on-demand path ships**. Framed as
   an open question with a **proposed owner (FIX-924)**, not a decision — the human confirms
   the owner and the default at sign-off. (923 Decision 6 flags the cap as load-bearing and
   defers its exact shape; this names where it should live.)

3. **FIX-920 context-inheritance default — align 920 / 482 / 923.** How much of the parent
   conversation does 920's `conversation` mode inherit by default?
   - **(a) bounded by default** — ship with `history: { turns: N }`, reusing the existing
     `ItemQuery` already available on the generator's `history` slot; predictable token cost
     out of the box.
   - **(b) 920 waits on 482** — don't ship inheritance until the pruning utility exists to
     trim it.
   - **(c) accept the token risk** — an unpruned `conversation` inherits the session default
     (~50 turns), which can be large.

   Related and unresolved: **LLM-summarization needs a single owner** before multiple issues
   spec context behavior — 482's `strategy: "llm"` vs. the flow-policy `compact` stub. Decide
   one home; don't grow both. *Needs alignment across 920/482/923 at their gates.*

4. **FIX-924 — ship strict now vs. hold for FIX-923.** 924's spec recommended shipping the
   strict "declared-worker-only" rule now and letting 923 relax it. That recommendation
   appears **accepted**: PR #865 carries the `spec approved` label and FIX-924 is in
   *Spec Approved*. The **residual cross-cutting obligation** is that *if* 923's on-demand
   outcome lands (Q1), the single `validateAssignee` gate must widen by one function to allow
   an explicit ad-hoc / general dispatch (a bare unknown string stays invalid — the typo
   case). This widening must be folded into the FIX-641 / FIX-924 implementation, not
   forgotten. *Needs a human to confirm the ship-now decision is final and owns the
   follow-up widening.*

5. **Stale pre-918 vocabulary in issue/spec text — 641 and 920.** FIX-641's framing predated
   FIX-918 (referenced the removed `packages/skills`, `WorkerSpec`, `agent-ref`/FIX-450
   surface); its issue text now carries a "Refreshed onto the FIX-918 / PR #854 architecture"
   note, so the residual is only confirming the refreshed shape matches 923's chosen shape
   (Q1) at 923's approval gate. **FIX-920's spec (#853) is the same class of flag** — it
   still uses `workers:` / `WorkerSpec` vocabulary that predates the `agents:` rename and
   needs a post-918 refresh at its review. *This epic does not edit either issue's text —
   surfaced for the fleet / human to reconcile at the respective review gates.*

6. **Scope of the epic itself — do FIX-917 and FIX-482 build inside it or ship
   independently?** Both are `adjacent-optional` (§1). They can stay in the epic for
   coherence or be split out as standalone changes, and — per the objective-gate carve-out in
   §1 — **`epic approved` does not ramp them**; they hold for an explicit per-issue opt-in.
   *A human should make this call at objective sign-off; approving the epic's purpose does
   not commit to building 917/482 inside it.*
