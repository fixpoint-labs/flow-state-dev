# Skills / GoalSeek / Delegation — design notes

**Status:** Working design notes (not a spec, not a PR yet). Purpose is to steer
in-flight work on FIX-910 (strategies / `goalSeekLoop`) and FIX-911 (per-generator
skill binding) — and to decide whether some of that work should be reshaped or
new work defined. Captured from a long collaborative design thread so the
reasoning isn't lost.

**Authors:** Jake + Claude (design pairing).

---

## 1. Problem we're actually solving

The skills system overloads one concept (`context: inline | fork | pattern`)
across three *unrelated* execution shapes:

- **inline** — instructions injected into the host generator's context. This is
  the only mode that "teaches" the generator anything.
- **fork** — a child generator with an isolated, near-empty context (today it
  gets only `{ body, allowedToolNames }` — no inherited history).
- **pattern** — materializes a task board + workers from SKILL.md frontmatter,
  dispatched via the `runSkill` router (PatternRegistry, worker-materializer,
  pattern-run).

Only inline is context; fork/pattern are dispatches that happen to require a
`runSkill` tool call. FIX-911's PR (#836) fixed the real session-global bleed for
inline (per-generator binding via capability config) but left fork/pattern on the
separate session-global `runSkill` router — so the fragmentation got sharper, not
smaller.

Pre-release: we have full freedom to refactor. Goal is to get the model *right*,
not to preserve the current surface.

---

## 2. Durable decisions (hold across every direction below)

These survived the whole discussion and we treat them as settled:

- **Split the taxonomy by what a skill *is*, not how it runs.**
  - **Context skills** — instructions + which tools are live + optional
    memory/resource access. Multiple can be active at once and compose (this is
    how Claude's own skills work — no one-at-a-time mutex).
  - **Delegation / loop-owning skills** — the renamed "pattern skill." At most
    one owns loop structure at a time (see §4/§5 for how this changes per
    direction).

- **The generator's ReAct loop stays pure.** Its job is to complete *its* task,
  terminating when the model stops calling tools. **A judge does NOT go inside the
  ReAct loop** — that conflates "am I done with this step" and "was the overall
  goal met," and adds overhead to every step. Convergence evaluation lives
  *outside* the generation, in a sequencer. This is what sequencers are for.

- **GoalSeek is one strategy parameterized by its producer.** Same skeleton at
  every scale — **produce → evaluate goals → replan until met**:
  - producer = generator  → single-agent convergence
  - producer = board-drain → supervised delegation
  - producer = team        → "workstream" (team-level goal seeking)
  A **workstream collapses into a skill** — that's confirmation GoalSeek is at the
  right (scale-invariant) altitude, not a missing primitive.

- **Goals are first-class records — higher-order tasks, not tasks.**
  - Record: `{ id, definition, view, evaluator, status }`.
  - **Evaluator is any block → Verdict** (`{ met, feedback? }`). LLM judge, code
    predicate, schema check, test run — all uniform behind `Block<view, Verdict>`.
  - `view` = the declared slice of "work so far" the evaluator sees (a resource,
    the board result, the final message). Keeps judges cheap and focused.
    **(Open: exact `view` contract — see §6.)**
  - Multiple goals in one evaluation sweep: exit when **all** pass; feedback is
    **scoped to the unmet set**; **re-evaluate all each pass** (refining B can
    regress A). No combinator problem because there is one loop, N goal records.

- **Goals are collection-shaped but NOT a task board.** A task is *dispatched to a
  worker*; a goal is *evaluated by a judge*. Reuse the generic collection
  substrate (CAS/status/listing) if/when goals need to be dynamic, shared, or
  persisted — do **not** bake goals into the task board. Task board stays
  goal-free; GoalSeek wraps it.

- **Enforcement is tiered; a goal is only as enforced as the active tier.**
  - Tier 0 — generator context (self-managed, narrated). No independent check.
  - Tier 1 — GoalSeek loop (verified + re-driven).
  - Tier 2 — delegation / supervised board.
  - Tier 3 — workstream (cross-turn/agent, promotion).
  - A `setGoal` tool has a **stable contract, tier-dependent behavior** (mirrors
    how `taskTools` resolves the active board or no-ops). **Promotion = moving a
    goal record up a tier.** Contributing a goal doesn't conjure a judge — it
    needs a tier that runs one.

- **Layer 1 vs Layer 2.**
  - **Layer 1 = mechanism** — blocks, generator, sequencer, task board, GoalSeek,
    the goal record + evaluator contract, capabilities. This refactor is Layer-1
    work.
  - **Layer 2 = config** — skills, agents, teams (workforce). File/convention
    driven, compiles down to Layer 1, drops into Layer 1 only to tune/extend.
  - So a **skill is Layer-2 config that assembles Layer-1 primitives.** FIX-911 is
    the Layer-1 mechanism; SKILL.md is the Layer-2 skin.

- **Capabilities act at their own level** (on the block that uses them), not
  strictly "downward." Power ladder:
  1. contribute blind (today),
  2. contribute *aware* of the host's resolved config (enables a self-cloning fork
     tool; but forces `uses`-resolves-last / two-phase resolution — tricky),
  3. own the host's control flow (the loop).
  Fork needs rung 2; enforced convergence needs rung 3. **Which rungs we actually
  need depends on the direction chosen below.**

---

## 3. Fork — corrected model (holds across directions)

Current fork is misnamed: it starts a child with an empty context. A **fork should
inherit history up to the fork point, then diverge** — the point is to spend a lot
of work and return only the result, *preserving the parent's context window*.

The engine already supports this: `SessionItemViews.history()` walks prior turns +
live in-flight items, filtered by `itemVisibility.history`. Fork just doesn't use
it. Whichever direction we pick, fork = "run a child seeded from history-to-here,
return only its result." As a tool call, the return-only-the-result property is
free (that's what a tool result *is*).

---

## 4. Direction A — SkillHarness owns the loop (upward-facing)

A `skillHarness` block wraps the generator, owns the outer GoalSeek loop, holds
active-skill state, injects tools, and **at runtime decides whether to enable a
GoalSeek loop** based on the active loop-owning skill. Generator publishes a goal;
the harness collects it and manages the loop around it.

- **Rule:** ≤1 loop-owning skill + N context skills. The loop is singular; goals
  are plural contributions into it.
- **Needs:** rung-3 capability power *or* the harness (we chose the harness, so no
  framework change to the generator). Fork also lands here (the harness holds the
  generator config, so it can clone it — avoids rung-2).
- **Buys:** enforced, inescapable, whole-turn multi-goal convergence; runtime
  mode-switching; a single merged eval sweep across all active skills' goals.
- **Costs:** "a skilled agent" becomes a harness, not a generator (new top-level
  type); loop-around-a-loop with context re-threading across outer iterations; the
  harness is a third thing that tries to do both delegation and output-gating from
  inside the skill layer.

---

## 5. Direction B — pattern-as-tool, stay downward-facing  *(currently leading)*

Reframe: **don't wrap the generator in a loop — give the generator the loop as a
tool.** The generator is the executive (non-deterministic host); it decides *what*
work is needed and calls a tool that runs a rigorous deterministic flow. That tool
*is* a `goalSeekLoop` block (exactly what the FIX-910 agent is already building):

```ts
export const deepResearch = goalSeekLoop({
  name: "deep-research",
  inputSchema: z.object({ question: z.string() }),
  board,
  seed: planQuestions,
  judge: assessCoverage,       // block → { decision, reason, tasks? }
  replanner: proposeFollowups,
  maxIterations: 4,
  finalize: synthesizeAnswer,
  onError: "fail",
});
```

A skill contributes this block **as a tool** (plus instructions on when to use it).
The LLM decides *what/when*; the flow decides *how*, deterministically.

- **Blocks referenced, not embedded.** Do NOT put executable block code inside
  user-editable skill folders (code-injection surface for dynamic/edited skills).
  Keep flows in a **code-defined library** and have skills *reference them by key*
  (like `blockRef` / `allowed-tools` already do). This IS the Layer-1/Layer-2
  boundary in action: reviewed code blocks (L1) wired by skill config (L2). The
  skill is still where you say *which* flow and *how it's configured* (own board
  vs shared board = a capability-config/scope decision, à la FIX-915).
- **"Pattern mode" as a skill concept probably dies.** No PatternRegistry-from-
  frontmatter, no worker-materializer parsing YAML into generators, no pattern-run
  router. A delegation skill = "contributes a delegation/goalSeek tool + when-to-
  use instructions." Large machinery deleted (BP-038).
- **Fork = a tool** that runs a child seeded from history-to-here and returns only
  its result. Context preservation is free.
- **Two real topologies, no harness in either:**
  1. generator-as-root calls flows as tools (chat agent + skills),
  2. flow-as-root (`goalSeekLoop`) has a generator as a step (e.g. a deepResearch
     endpoint — already how FIX-910 works).

- **What B gives up vs A:** the ability to *force* convergence on the generator's
  *own top-level output*. Convergence becomes opt-in (the model chooses to call
  the tool and to respect its result). Assessment: this is likely **YAGNI** for
  the chat-agent case, and where genuinely needed it's better served by:
  - **rigorous delegation** → goalSeek-as-tool (enforcement lives *inside* the
    called flow), and
  - **enforced output gating** → an action/flow-level output guard — the existing
    `response-auditor` pattern — not a skill harness.
  The harness's two justifications decompose into two things we already have.

- **Multi-skill goals in B:** each skill contributes its own tool → the generator
  orchestrates them, OR one skill contributes a `goalSeek` tool whose goal *set*
  is the multiple bars (determinism lives inside that one tool). We lose the
  automatic cross-skill merged sweep from A; we gain "no loop to own, no ≤1 rule,
  no runtime loop-structure install."

---

## 6. Open questions

- **Evaluator `view` contract** — what exactly does a judge get handed, and how
  does a goal declare it? Sizes the whole goal record.
- **`replanner` shape** — code, block, or both? (Lean: block, so a re-planner can
  be a generator; with a code default for "just reinject the unmet feedback".)
- **Goal-collection graduation** — set-on-the-strategy now; full collection when a
  tier needs dynamic/shared/persisted goals. When does that line get crossed?
- **A vs B final call** — see §7. Leaning B.
- **Naming** — "Converge" → **GoalSeek / `goalSeekLoop`** (settled). "pattern
  skill" → "delegation skill" (or drop the concept entirely under B).

---

## 7. Steering implications for FIX-910 / FIX-911

- **FIX-910 (`goalSeekLoop` / strategies):** the block-shaped `goalSeekLoop` in
  the example is *right* and survives under both directions. Under B it becomes
  the centerpiece (invoked as a tool or used as a root), not something a harness
  installs. Keep building it; make sure it's cleanly callable as a tool and
  usable as a root block. The goal record + `evaluator: Block → Verdict` contract
  from §2 should land here.
- **FIX-911 (per-generator binding):** keep the per-generator capability binding
  for **context skills** (that part of #836 is correct). Reconsider: (a) do NOT
  build the session-global fork/pattern router as the long-term home; (b) under B,
  **drop pattern-mode skills** in favor of skills contributing referenced flow
  tools; (c) fix fork to inherit history-to-here.
- **Harness (Direction A):** shelve unless a concrete "must enforce the whole
  turn" case appears that response-auditor + goalSeek-as-tool can't cover.
- These are notes to inform PR comments on the in-flight 910/911 work, not
  necessarily a new PR of their own.
