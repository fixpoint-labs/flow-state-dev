---
name: issue-implement
description: Use when implementing a Linear issue. Fetches the issue and spec, creates a fix branch, auto-routes by Linear category (Bug vs Feature/Enhancement) to the right implementation discipline, dispatches sub-agents for complex work, runs a comprehensive review, opens a PR, and then stays on the PR — acknowledging new review comments with an eyes reaction and responding to every code-related comment with either a fix or a justification. Handles "Fix bug for FIX-N" and "Implement FEAT-N" the same way — the routing happens inside.
argument-hint: "<Linear issue ID, e.g. FIX-123>"
---

You are an implementation agent. Given a Linear issue ID, your job is to pull the issue and its spec, set up a branch, implement the work using the right discipline for the issue's category, dispatching sub-agents for anything non-trivial, and run a thorough review before presenting the result.

## Core Principles

**The retained spec is the design authority, not the issue description.** Read `specs/issues/<ISSUE-ID>/` on `main`: `SPEC.md`, `DECISIONS.md`, `BUSINESS-RULES.md`, `PLAN.md`, `DOCS.md`, and applicable `EVOLUTION.md`, with owned artifacts. Build from its rules and plan, reconcile its documentation draft with real behavior, and honor retained versus superseded predecessor decisions. Approved intent is not proof of shipped behavior; current code and published docs establish that. Linear holds status and links, not a competing full spec. Spec-backed implementation starts only after confirmed spec merge; bugs and brief-backed work keep their existing direct route.

**Bugs and features follow different disciplines.** Step 4 reads the Linear category label and routes:

- **Bug** → implementer sub-agents follow **`diagnose`** (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup). For flow-execution bugs specifically, Phase 1 of diagnose hands off to **`debug-flow`** for the NDJSON trace reader.
- **Feature / Enhancement** → implementer sub-agents follow **`tdd`** (red-green-refactor with vertical tracer-bullet slices). One test → minimal code → repeat. No horizontal slicing.

Both disciplines are embedded into the implementer sub-agent prompt at dispatch time. The implementer doesn't choose — this skill picks based on the label and gives them the right shape.

**One exception comes before the label: an epic's closure issue.** Its title starts `Closure:`, and its epic's `SPEC.md` set table marks it `closure · required`. It carries the Improvement label but is never `tdd`: its implementation is a **QA run** (Step 4.1).

**Red is a gate, not a suggestion.** For any change with observable behaviour, the discipline is not satisfied by writing the test after the code, or writing the test and the fix together and only confirming green. The flow is always: write ONE behavioural test → run it → observe it fail for the intended reason (not a typo, import error, or missing fixture) → write the minimal code → observe it pass. Both the failing output and the passing output are evidence (BP-003) — "tests pass" alone proves nothing if the test was never seen to fail. This applies everywhere this skill drives a code change: Step 5A/5B implementation (tracer-bullet loop, red-before-green per slice) and Step 10.4 fixes made in response to PR review (every regression test shown failing against the un-fixed code first). Step 6's completeness review checks for this evidence, not just green tests.

**A check with no before-state owes a blast radius instead.** Some checks are green before the change and green after — a **negative** assertion (`not.toMatch`, "nothing was hired"), a **cardinality** claim ("exactly three"), a **control or goal-check leg** that grades a run, an **equivalence** between two artifacts — so the flow above is satisfiable in full while the check cannot fail at all. Break **the property the check claims**, not the implementation, and report what you broke, which checks went red, and **that nothing else did**. The third part carries the weight: where a fixture is too clean to contain the failure, perturbing the subject fails *nothing*, and only the blast radius makes that visible. A check you cannot write that report for is not evidence yet. **The unit is the assertion, not the leg:** every outcome the leg claims maps to an assertion, and each assertion is shown able to fail — a control that reddens its leg proves neither, and an assertion that passes on an absence, on an empty loop, or on a state it never waited for stays green beside it.

**Exceptions.** (a) Pure characterization/parity work — swapping an implementation while holding pre-existing tests green (see `tdd` → "When NOT to use TDD") — has no red-green cycle by design; the discipline there is that the parity tests already existed *before* the change and continue to pass, not that anything was ever red. This exception covers holding **pre-existing** tests green; it does not reach a *new* assertion you add over existing behaviour, which owes the red state and blast radius above. (b) Trivial, mechanical edits with no behavioural surface — config values, docs, renames — don't need a test at all. Anything with observable behaviour (an item emitted, a return value, a state change, a symptom that's now fixed) gets the red gate; when in doubt, treat it as observable.

**Challenge genuine spec blind spots.** Use `./challenger-prompt.md` where real code contradicts the approved design, not to re-litigate settled choices. Report the evidence and affected decision. A post-merge correction belongs in a new amendment PR from `main`, never a push to or reopening of the original spec PR; material direction changes require fresh human approval before implementing that direction. Flag deviations visibly in the implementation PR and link them from Linear. This is prime `distill-lessons` signal.

## Workflow

**OMP:** apply the [native dispatch adapter](#5b2-dispatch-implementer-sub-agents)
to every implementation and verification step below, including simple work and PR
feedback re-entry. Checks run in verification leaves, not in the lifecycle coordinator.

**Re-entry on an in-flight PR.** Before running Step 1 from scratch, check if this issue already has an open **implementation** PR (`gh pr list --search "FIX-N in:title,body" --state open`, or the URL recorded on the Linear issue). **Ignore the docs-only spec PR** (`spec(FIX-N)` title / `spec/FIX-N` branch from `issue-spec`, open or closed) — that's the spec artifact, not the implementation; matching it would wrongly jump to PR-feedback mode and skip the build. If an implementation PR exists, the implementation phase is done — jump directly to **Step 10 (Respond to PR Feedback)**. Do not branch, re-implement, or re-review.

### Step 1: Pull the Linear Issue

Fetch everything about the issue:

1. `get_issue` with `includeRelations: true` — get the full issue: description, labels, priority, relations
2. `list_comments` — read any discussion or decisions
3. **Read the repository spec and its review history.** For direct-route bugs, first perform the spec-PR lookup below; if none exists, the issue, comments, and reproduction are the contract.
   1. Locate the original and amendment spec PRs across all states and read their merge status, head SHA, and review provenance. A closed-unmerged PR is not a merged spec.
   2. Read the retained set from fresh `origin/main`, including `DOCS.md`, applicable `EVOLUTION.md`, and its exact predecessor anchors. Read current code/docs to distinguish approved intent from shipped behavior. Historical designs lacking retained files may be researched through their actual PR/Linear artifacts; do not invent paths or backfill them.
   3. Read the spec-PR discussion on all three surfaces (inline, top-level comments, reviews). Apply the canonical spec-review bar: direction findings require decisions; below-the-bar notes are implementer input, not instructions.
   4. Read `PLAN.md → Notes from review`; adopt, adapt, or discard against the code. Linear supplies status and links only. Never overwrite retained content with an old Linear mirror.
4. If the issue has sub-tasks, fetch those too — they may represent the intended PR breakdown

If $ARGUMENTS doesn't look like a Linear issue ID, search with `list_issues` using it as a query.

**After reading, capture these details (you'll need them for sub-agents):**
- Issue ID, title, and description
- Full spec content (every section)
- Blocking/blocked-by relations and their status
- Any decisions from comments
- Labels and priority — in particular, the **category label** (Bug vs Feature/Enhancement/Improvement) which determines the implementation discipline at Step 4

### Step 2: Validate Readiness

Before starting work, check:

1. **Spec exists?** The routing rule is canonical in [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Which issues get a spec".
   - **Issue labeled "Bug"** → **a bug takes the direct route: proceed without a spec, and don't ask for one.** This is the norm, not an exception you're granting. Bugs follow `diagnose`, which builds a feedback loop and reproduces the failure before any code changes — that *is* the analysis a spec would have guessed at, and it happens here. The fix is reviewed on its PR.
     - **Three things override the Bug label. One is already true or not before you look, and two are yours to decide** — the split matters because you can only act on the ones you can see:
       1. **A spec PR already exists.** Search all states before declaring the issue direct. A merged, approved retained spec puts it on the spec route. An open or closed-unmerged spec cannot be bypassed by a Bug label: return `specRequired` with the actual approval/check/merge blocker. Resolve a superseding spec through its recorded provenance, not a guess from PR closure.
       2. **No reproduction and an ambiguous symptom** — there's nothing to diagnose against, so working out what is even happening is real research.
       3. **It isn't really a bug** — the fix is a new capability or changes a contract other code depends on, which must not reach `main` through the one route with no gate.
     - For 2 and 3, decide *before* you start building. Standalone, say so and offer `/issue-spec {ID}`. Under a lifecycle, return `specRequired` with the reason and stop; the coordinator re-routes the issue.
     - **A design decision found mid-diagnosis is not one of those cases.** Once you have the repro and the cause, a fix that turns on a judgment call — two defensible places for the guard, a behavior change users could notice — is **implemented on best judgment and surfaced on the PR** with the alternative named (Step 9's Key Decisions, and a comment on the thread if it's contested). Don't stall, and don't detour into a spec. Escalate as an ordinary blocker only when the call genuinely isn't yours: it reverses a shipped contract, or it belongs to the epic.
   - **Issue labeled "Feature" / "Enhancement" / "Improvement" with no spec** → tell the user: *"This issue has no spec attached. Should I proceed based on the description alone, or create a spec first with `/issue-spec {ID}`?"* For non-trivial feature work, no-spec is usually a mistake.
   - **Either category with a one-screen agent-brief** (per `docs/contributing/agent-brief-template.md`) → proceed; that brief is the contract.

2. **Full spec approved and merged?** Require the five documents under `specs/issues/<ISSUE-ID>/`, applicable evolution, human approval bound to the reviewed head, and confirmed merge after required checks and review-thread policy. A merged spec PR satisfies both: the owner's merge is the approval. Follow [`orchestration.md`](../../../docs/contributing/orchestration.md#merging-and-amending-a-spec) → "Merging and amending a spec". A standing label does not approve a changed head; invoking this skill is not a merge bypass. If approval exists but merge is pending, only an explicitly authorized `implement` backstop may execute that canonical merge contract before creating the implementation branch, then continue and return the matching `specMerge` receipt. Otherwise return the exact merge wait for the coordinator to dispatch `issue-worker` **MERGE-ONLY**; do not start implementation. Bugs and brief-backed issues with no spec PR skip this gate.

3. **Dependencies resolved?** Check blocking issues:
   - **Read the direction, don't infer it.** On the GraphQL channel, this issue's blockers are its `inverseRelations` of type `blocks` (the node's `issue` is the blocker); its own `relations` of type `blocks` are issues *it* blocks. Reading `relations` as blocked-by inverts the dependency — the prerequisite parks and its dependents run first.
   - If blockers are still "In Progress" or "Todo" → tell the user what's blocking and stop
   - If blockers are "Done" but code isn't on main → check if there's a merged PR. If not, flag it

4. **Open direction questions?** Surface unresolved spec-level decisions using [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md). Resolve them in a follow-up spec PR from `main`, with renewed human approval for material changes and required checks before merge. Then build from the merged amendment; never silently edit a Linear mirror or the original merged PR.

   **A claim marked `(POC in flight)` is not an open question either.** It's a question already being answered, by a settlement that is non-blocking by design — waiting on it here would reintroduce the block the whole mechanism avoids. Implement on the spec's stated premise; if the verdict comes back `REFUTED`, the orchestrator routes it to you as a spec blind spot (see [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed claim"), which is the same path the challenger already uses. A claim recorded as **settled** with evidence is likewise closed — don't reopen it.

   **Below-the-bar spec comments are not open questions.** A naming preference, a local-structure suggestion, or a line-level nit left unresolved on the spec PR does **not** block implementation and does not go to the user — it's yours to settle in the code, same as a review note. Blocking on those is the failure this rule exists to prevent: the spec converged with threads deliberately open

If all clear, move to Step 3.

### Step 3: Set Up Branch

1. **Create the branch on fresh `origin/main`** (worktree-safe — see
   [`orchestration.md`](../../../docs/contributing/orchestration.md) → Worktree branching):
   `git fetch origin main && git checkout -B fix/{ISSUE-ID} origin/main` — lowercase the ID.
   The `-B ... origin/main` form works identically in the coordinator's checkout or a worker's
   worktree and never occupies the shared `main` ref (which parallel workers would collide on).
   This runs only when *creating* the branch — the re-entry guard above sends an in-flight impl
   PR straight to Step 10, so you never reset a branch that already carries pushed commits.
   - **Sub-PR of a multi-PR plan?** (Invoked by `issue-lifecycle` for one node of the spec's
     PR plan.) Use branch `fix/{ISSUE-ID}-{sub-PR id}`, implement **only that sub-PR's
     deliverables** (not the whole issue), and base it on the dependency's branch if it has one
     (`git fetch origin {dep branch} && git checkout -B fix/{ISSUE-ID}-{sub-PR id} origin/{dep branch}`)
     — else on `origin/main` as above. The branch must include the merged spec; do not repeat its merge per sub-PR.
2. **Confirm the implementation base contains the retained spec and approved amendments.** If merge is still pending, return the exact gate blocker rather than starting code. A disclosed in-flight POC does not waive spec merge; later evidence is folded through a new amendment PR.
3. Update the Linear issue state to "In Development" using `save_issue`

### Step 4: Determine Category and Complexity

#### 4.1: Pick the discipline (by Linear category label)

- **An epic's closure issue** (title `Closure:`; see Core Principles) → discipline = **QA run**. Check this **first**: it overrides the Improvement label and the "default toward TDD" rule below. Skip Steps 4.2–5C and do this instead: run the approved QA plan on one `main` commit, per [`orchestration.md`](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa). A run that fails files each finding through `issue-manager` as a child of the epic that blocks this issue, opens **no PR**, and returns the row at `NEEDS_IMPLEMENTATION` with the findings listed. Only a clean run continues to Step 6: its PR carries the committed end-to-end checks and the QA report as the goal verdict.
- **Bug** → discipline = **`diagnose`**. Implementer sub-agent must build a feedback loop and reproduce the bug *before* changing code. The discipline's six phases (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup) get embedded in the implementer prompt. For flow-execution bugs specifically, point the implementer at `debug-flow` for Phase 1 mechanics (NDJSON event types, failure-pattern table).
- **Feature / Enhancement / Improvement** → discipline = **`tdd`**. Implementer sub-agent follows red-green-refactor with vertical tracer-bullet slices: write one behavioural test for the first slice → minimal code to pass → repeat. No "write all the specs first" — that produces tests insensitive to real bugs.
- **Mixed** (e.g. a "bug" issue that actually requires building new infrastructure to fix, or a "feature" issue that resurfaces a known bug) → flag to the user and pick one explicitly. Default toward TDD if uncertain; the bug regression test still gets written, just inside the TDD loop.

Record the discipline; you'll inject it into the implementer prompt at Step 5.

#### 4.2: Assess complexity

Read the spec's "Implementation Sequence" section (or equivalent) to determine scope:

**Simple** (implement directly — no sub-agents):
- Single file change or tightly coupled changes in 2-3 files
- No architectural decisions to make
- Clear, unambiguous spec with < 3 implementation steps
- Bugs where the feedback loop is trivial (single vitest spec) and the fix is local

**Complex** (dispatch sub-agents):
- 3+ implementation steps in the spec
- Multiple packages or subsystems touched
- New APIs, types, or abstractions to create
- Integration work across package boundaries
- Bugs where the feedback loop construction is non-trivial (cross-package reproduction, non-deterministic, requires instrumentation)

If simple → go to Step 5A.
If complex → go to Step 5B.

#### 4.3: Familiarity check

If the area being touched is unfamiliar to you (whether running this skill directly or dispatching sub-agents), get a map first via `zoom-out` shape — package / flow / actions / block kinds / capabilities / scopes / items / boundaries / callers. A 30-second orientation prevents an hour of misdirected work.

### Step 5A: Simple Implementation

Follow the discipline picked at Step 4.1. As you work, at any boundary that resists the spec's plan or sits on a decision card, run the challenger (Core Principles → Meta-awareness; `./challenger-prompt.md`) before committing to that direction. Skip it at trivial boundaries.

**For bugs (`diagnose` discipline):**

1. Read relevant code to understand the area (use `zoom-out` shape if unfamiliar)
2. **Build a feedback loop FIRST** (Phase 1 of diagnose). Don't touch code until you have a reproduction:
   - Default: vitest filter at the package level — fastest, sharpest
   - For block-level isolation: `fsdev block <path> -i '<json>'`
   - For flow-level reproduction: `fsdev run` with NDJSON capture (hand off to `debug-flow` for trace reading)
   - For type-only regressions: `pnpm --filter <pkg> typecheck`
3. Reproduce the bug through the loop. Confirm the failure mode matches what the user described.
4. Hypothesise: 3–5 ranked falsifiable hypotheses before testing any.
5. Instrument with `[DEBUG-<short-hash>]` tags so cleanup is a single grep at the end.
6. **Write the regression test before the fix** (Phase 5 of diagnose), at the correct seam — the seam the spec named in Testing Strategy, or the spec's substitute if one was not provided. Run it and confirm it fails for the bug's actual reason, not a typo or setup error. Capture the failing output — you'll need it for the report.
7. Apply the fix.
8. Run the regression test again and capture the passing output. Run the loop again; verify the original repro no longer reproduces. If the bug was user-visible behaviour (not a pure type/unit regression), confirm the fix through the **real path** too — `fsdev run` against a real model — not only the mocked regression spec, so you've proven the symptom is actually gone. This is the bug's goal proof and is required verification: same anti-cost-skip rule as step 8 of the feature path (real API credits by design — don't skip on cost; the credential is normally in the env, so attempt the run).
   - **UI-layer bugs** (item renderers, streaming display, the DevTool embed, prompt input): the real-path check above runs *below* the UI. If the fix touches the browser-rendered surface, decide per `apps/docs/docs/testing/end-to-end-tests.md` whether a kitchen-sink Playwright scenario should be added/updated to lock it; otherwise note why browser verification isn't needed.
9. Cleanup: grep `[DEBUG-` and remove all instrumentation. Delete throwaway harnesses.
10. Run typechecks and tests: `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
11. Commit with a conventional commit message referencing the issue ID. The commit message names which hypothesis turned out correct, so the next debugger learns.
12. Skip to Step 5C (Document the change), then Step 6 (Review)

**For features/enhancements (`tdd` discipline):**

1. Read relevant code to understand the area (use `zoom-out` shape if unfamiliar)
2. List the behaviours to test from the spec's Testing Strategy — observable outcomes through the public surface (items emitted, state changes, return values), not implementation steps
3. **Tracer bullet**: write ONE test for the first behaviour through `@flow-state-dev/testing`'s mock context. Run it — confirm it fails for the intended reason (the behaviour doesn't exist yet, not a typo or import error) — and capture the failing output. Only then write the minimal code to make it pass, run it again, and capture the passing output.
4. **Incremental loop**: for each remaining behaviour, RED (write the test, run it, confirm it fails for the intended reason, capture the output) → GREEN (minimal code, run it, capture the passing output). One test at a time. Do not write all tests first, and do not write a test and its implementation together without running the test red first.
5. After all tests pass, refactor while green: extract duplication, deepen modules, follow BP-011–BP-016. Never refactor while red.
6. For generators specifically: assert schema strictness with `makeSchemaStrict` per BP-016.
7. Run typechecks and tests: `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
8. **Run the goal check** that `SPEC.md` → *The goal, and how we'll know it's met* names (a spec retained before that section existed names it in `PLAN.md`'s checks or its testing strategy; use that, and treat an unnamed control as one to construct per `goals/README.md` → Proving a check can fail) (real model, real path — see `tdd` → "Two kinds of test"). **Run its control first** and confirm it FAILS on the leg the spec says; a PASS from a check you never saw fail proves nothing. Then run it for real, and check the result against the spec's *not done if* list, not just the PASS line. Green specs are mocked; they don't prove the goal. This is required verification. For a **model-backed** goal, running it spends real API credits, which is the point, so don't defer or push back on cost grounds; the inference credential is normally in the env (e.g. `AI_GATEWAY_API_KEY`), so attempt the run rather than assume it's absent. (A model-free goal — `Model: n/a` — just runs its real path, no credential.) Full guidance: `goals/README.md` → Running. Run `fsdev run` against a real model or `pnpm tsx goals/<describe>/<it>/run.mts` and confirm PASS on the actual outcome. If it fails, the work isn't done — return to the loop. Record the command and verdict. If the spec documented that no goal check applies (docs/refactor/config work with no observable outcome), skip this and note the documented justification.
   - **A check that needs a browser:** run it yourself first (Chromium via `goals/lib/playwright.mts`). Only when that attempt fails, or the check needs something this environment can't have, hand it to `fsd-qa` over the mailbox and wait for its verdict on your pushed SHA ([`agent-mailbox`](../agent-mailbox/SKILL.md) → "Hand a browser check to `fsd-qa`"). Until it answers, the goal is blocked, not passed.
   - **UI-layer changes** (item renderers, streaming display, the DevTool embed, prompt input): the goal check above runs *below* the UI. If the change touches the browser-rendered surface, decide per `apps/docs/docs/testing/end-to-end-tests.md` whether to add/update a kitchen-sink Playwright scenario; otherwise note why browser verification isn't needed.
9. Commit with a conventional commit message referencing the issue ID
10. Skip to Step 5C (Document the change), then Step 6 (Review)

### Step 5B: Complex Implementation (Sub-agent Team)

#### 5B.1: Extract Tasks from Spec

Parse the spec's "Implementation Sequence" into discrete, ordered tasks. The spec is directional — it names the modules/layers and behaviors, not exact files and signatures — so the exact targets are the implementer's to settle. For each task, note:
- What to build (the modules/layers involved and the behavior to land — the exact files, functions, and types are the implementer's to settle in the code)
- What it depends on (which prior tasks must complete first)
- How to test it (acceptance criteria from spec)
- What NOT to build (scope boundaries)

Create a TodoWrite with all tasks.

#### 5B.2: Dispatch Implementer Sub-agents

**OMP dispatch adapter.** The coordinator owns this lifecycle; `fsd-implementer` is
only a bounded leaf, not a substitute for the whole skill. This boundary also applies
to Step 5A and Step 10 feedback fixes: the coordinator schedules implementation and
verification, reads evidence, and never executes checks in its shared checkout.
Dispatch approved slices with native `task` items
(`agent: "fsd-implementer", isolated: true`) or Eval
`agent(prompt, { agent: "fsd-implementer", isolated: true, apply: false, merge: false })`;
its `@fsd_implement` alias replaces Claude's execution-model selection. Supply the
same spec context and chosen discipline, but omit template instructions to commit,
publish, or spawn. Keep unresolved design judgment in the coordinator.

Independent owned slices may share one task batch; dependent slices stay ordered.
Writing assignments skip all validation, builds, tests, linters, formatters, and
runtime probes. Patches require explicit coordinator inspection and integration;
completion alone does not apply or accept them.

Use separate bounded, isolated `fsd-implementer` leaves with an explicit
**verification-only, no source mutations** assignment for RED/reproduction and
GREEN/final checks, including reviewer-requested reproductions. Supply the exact
commands/scenarios, acceptance criteria, and frozen input snapshot (base revision
plus all relevant integrated patches and dirty files); require the snapshot identity,
commands, exit outcomes, and captured logs in the return. A failed or unavailable
check returns evidence or a blocker, never an opportunistic fix.

- **Before the corresponding fix is dispatched:** if RED/reproduction evidence is
  missing, obtain a test/probe-only patch from a writing leaf first and deliberately
  integrate it without changing the implementation. Dispatch a verification-only
  leaf on that unchanged implementation plus the test/probe patch. Read the failing
  output and establish that it fails for the intended reason before releasing the fix.
- **After writers settle:** deliberately integrate accepted patches, freeze the
  resulting snapshot, then dispatch a verification-only leaf for GREEN and final
  checks. Read its evidence before review/acceptance. Any subsequent source change
  requires a new frozen snapshot and the affected checks; never label stale evidence
  as verification of the new state.

The coordinator also dispatches the challenger, per-task compliance review, and
Step 6's review directly, never through an implementer's recursive spawn. For native
review roles, frozen inputs, schema, and synthesis use
[`review` → OMP native dispatch](../review/SKILL.md#omp-native-dispatch).
This adapter does not authorize leaf ticket/PR publication or mailbox subscription;
external communication stays with the coordinator. Claude's path below is unchanged.

For each task, sequentially dispatch an implementer sub-agent using the template in `./implementer-prompt.md`. The template has a `[Discipline]` slot — fill it based on Step 4.1:

- **Bug** → fill with the `diagnose` discipline block (see template). Sub-agent must build a feedback loop and reproduce before changing code; produces a regression test at the spec's named seam; runs the cleanup pass before reporting.
- **Feature/Enhancement** → fill with the `tdd` discipline block (see template). Sub-agent runs red-green-refactor with tracer bullets, one test → one impl, no horizontal slicing.

Provide:

- **Full task text** from the spec (don't make the sub-agent read files)
- **Scene-setting context**: where this fits in the overall implementation, what prior tasks produced, architectural constraints. If the sub-agent is landing in unfamiliar code, include a `zoom-out` shape map up front
- **The relevant spec sections** that inform this task (Technical Design, Edge Cases, Testing Strategy — Testing Strategy is especially load-bearing because it names the discipline's seam)
- **Codebase conventions** from AGENTS.md and best-practices.md — universal rules + index inline; situational rule text (e.g. BP-010 react, BP-011–BP-016 blocks/generators/resources) in `docs/contributing/best-practices/<category>.md`
- **The chosen discipline block** filled into the `[Discipline]` slot

**Model selection (per the AGENTS.md model-tiering policy — "Opus judges, Sonnet executes decided work, Haiku fetches"):**
- **Decided execution** — a well-specified task whose architecture the spec already settled (mechanical or integration) → dispatch the **`spec-implementer`** agent (Sonnet). It escalates any un-decided fork as a blocker rather than inventing it, so judgment stays upstream.
- **Architecture / design tasks** (a new abstraction, a genuinely open shape the spec left to the implementer) → keep on the **default (Opus)** model; the judgment isn't settled yet.
- **Bugs with non-trivial reproduction** → **default (Opus)**; the diagnose loop benefits from careful reading (cheaper models often skip Phase 1). Once the repro and fix approach are clear, the mechanical fix itself can go to `spec-implementer`.
- **Read-only orientation** before a task (a `zoom-out` map, locating callers) → the **`scout`** agent (Haiku).

**Handle implementer status:**
- **DONE** → proceed to spec review
- **DONE_WITH_CONCERNS** → read concerns, address if about correctness, note if observational
- **NEEDS_CONTEXT** → provide missing context and re-dispatch
- **BLOCKED** → assess and either provide more context, use a more capable model, break the task smaller, or escalate to user

#### 5B.3: Spec Compliance Review (per task)

For a task on a high-risk boundary (it resisted the spec's plan, exposed a checkable assumption, or sits on a decision card), **run the challenger first** (`./challenger-prompt.md`) — catch a spec blind spot before the compliance check, since compliance assumes the spec is right. Skip the challenger for mechanical tasks.

After each task, dispatch a spec reviewer sub-agent using `./spec-reviewer-prompt.md`:
- Provide the spec requirements for this task
- Provide the implementer's report
- Reviewer verifies code matches spec — nothing missing, nothing extra

If issues found → implementer fixes → re-review until clean.

#### 5B.4: Continue Until All Tasks Complete

Repeat 5B.2–5B.3 for each task in order. After all tasks:
- Run full typecheck: `pnpm typecheck`
- Run full test suite: `pnpm test`
- Fix any cross-task integration issues
- **Prove the goal on the assembled work** (real model, real path — see `tdd` → "Two kinds of test"). The per-task specs are mocked and only prove the pieces; this step proves the whole achieves the outcome. Same required-goal rule as step 5A.8 (real API credits by design — don't skip on cost; the credential is normally in the env, so attempt the run), applied here to the **assembled** work after integration rather than per-task. Confirm PASS before moving to review and record the command and verdict.
  - **Feature/Enhancement:** run the goal check the spec names. If the spec documented that no goal check applies, skip and note the documented justification.
  - **Bug** (complex bugs route through 5B, not 5A): if the original symptom was user-visible, re-run the **original repro through the real path** (`fsdev run` against a real model) on the assembled fix and confirm it's gone — this is the bug's goal verdict Step 6 expects. For a pure type/unit regression, note "N/A — type/unit-only" with the regression test as the proof.

### Step 5C: Document the change (both paths)

Runs after 5A or 5B, before review. Applies whenever the change touched anything a user of the
framework can observe — a public API, a returned shape, a tool result, a documented contract.

**You do not write the user-facing prose. Dispatch `docs-writer`, then `docs-editor`.** By this point
you are holding the spec, the diff, the review argument, and the defect, and that context leaks into
published pages in a predictable way — before/after framing, design defense, the bug report retold as
docs. Knowing the rules doesn't prevent it; not having the context does. The standard both agents
work to is [`docs/contributing/user-docs.md`](../../../docs/contributing/user-docs.md).

1. **Write the surface brief.** This is your only job here, and the brief is deliberately
   shape-constrained so it can't carry narrative:

   - **Surface** — the symbols a user touches, with signatures.
   - **Behavior** — what a caller sees, including failure results and their exact shapes.
   - **Limits** — what it won't do, where a reader would assume otherwise.
   - **Targets** — pages and READMEs that state the affected contract today.
   - **Draft** — `DOCS.md`'s reader-facing prose/examples and target create/update/remove
     operations, including shared epic ownership; no other spec narrative.

   No design *why*, defect story, or alternatives considered. A labelled migration
   section may carry only the actions readers need to move from the old public contract.

2. **Dispatch `docs-writer`** with the brief and that narrow draft. It reconciles the
   proposed content with public behavior and current docs, performs the target operations,
   and publishes to the actual docs. Honor justified no-impact outcomes; don't duplicate
   unchanged pages or shared epic prose. Report unfulfilled draft operations explicitly.

3. **Dispatch `docs-editor`** on the result. Send its findings back to the same writer and re-check.
   **Three rounds**, then bring it to the user rather than looping — prose that hasn't converged by
   then usually means the brief was wrong, not the writing.

4. **Reconcile the writer's report.** Two returns are yours to act on, not the writer's: a fact where
   **the code contradicted your brief** (check whether the brief or the code is wrong — this
   sometimes surfaces a real bug), and a behavior it **couldn't find an observable surface for**
   (either it isn't user-facing, or it isn't reachable and that's a gap).

5. **Re-run this step whenever observable behavior changes again.** Step 5C runs before review, so
   anything that moves the public surface afterwards — a Step 6 review finding, a Step 8 change
   request, a Step 10 PR-feedback round — leaves the pages describing a surface that no longer
   exists. Rebuild the brief for what changed and dispatch the pair again. It is a small,
   well-scoped pass, not a repeat of the whole step: the brief covers the delta, not the feature.
   **Never hand-patch the published prose to save the round trip** — that is the leak arriving by
   the back door, at the point in the process where your head is fullest of the review argument.

Architecture docs (`docs/architecture/`), `docs/internal/*`, the changeset, and the PR body are
**yours**, not the writer's. Those are for framework developers and reviewers, where the rationale,
the tradeoffs, and the defect belong. The split is the point: write the internal record fully, and
keep it out of `apps/docs/`.

**When the change narrows a rule stated elsewhere** — a new exception, or a new layer that now
enforces it — the old statement is a superseded claim: before review, run 10.6's word and surface
sweeps on it, put the user-facing hits in the brief's **Targets**, and fix the rest yourself.

### Step 6: Comprehensive Review

This is the critical quality gate. **Invoke `review`** on the change (the implementation branch/PR), passing the spec and the Linear category as context. It is the single definition of how we review — the same skill runs standalone — so there is no separate inline panel here. It composes the review lenses as **parallel sub-agents** and returns one deduped, ranked report:

- **Coherence** (`audit-coherence`) — does the solution cohere with `docs/philosophy.md` and the surrounding patterns? The apex lens: it catches the "directionally-right spec but the design feels off" failure the others structurally can't. A coherence break usually means reshaping the approach, not patching lines.
- **Restraint** (`second-look`) — overbuilt / YAGNI / 80-20 / what can be subtracted (BP-038)?
- **Correctness** — bugs and logic errors + the second-path checklist (BP-035). Changesets (BP-022) are opt-in, so the lens flags a fragment that is present and wrong, never a missing one.
- **Completeness** (a spec is in scope) — every spec requirement built and nothing extra, **red demonstrated** (the failing output captured before the fix — and, for a check with no before-state, the blast radius: what was broken, which checks went red, and that nothing else did — per assertion, with every claimed outcome asserted), and the **goal proven** on a real model (or the documented "no goal check applies" justification; for bugs, diagnose's real-path confirmation).

Depth follow-ups (`improve-codebase-architecture`) come back as non-blocking notes. If the area is unfamiliar or large, `review` may run the depth lens too.

#### Process Review Results

**For each issue found, categorize:**
- **Must fix** — spec gaps, bugs, security issues → fix before presenting
- **Should fix** — over-engineering, unnecessary complexity → fix before presenting
- **Note for user** — observations, follow-up suggestions → include in summary

Fix all must-fix and should-fix items. Re-run affected tests after fixes.

### Step 7: Update Linear

First, **compile the Key Decisions & Ramifications (top 5)** — the most consequential decisions made *during implementation* (not the spec's): a shape the spec left open, a deviation, a tradeoff under a constraint the spec didn't anticipate. For each: the decision, the alternative rejected, and the ramification — what it locks in, what it rules out, what risk it carries. If implementation was purely mechanical with no real decisions, say so rather than padding to five. **Compile it whole; sort it wherever a human is asked to act on it.** The **Linear `## Detail` record carries the full list verbatim** — it is the durable engineering record and nobody scans it to decide something. **Step 8 (presentation) and Step 9 (PR body) both sort it** through [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → §3: what the user owns is what they're asked to approve, everything else is listed separately as engineering calls. Step 8 is an approval gate, so an unfiltered list there spends the user's attention on calls they don't own — the same defect as an unfiltered block 3, one surface earlier. Nothing is dropped anywhere; the full record and the capped ask are two views of one list.

Then update the Linear issue:
- Add a comment, **problem first** per [`writing-for-humans.md`](../../../docs/contributing/writing-for-humans.md) — what was broken and what was done about it, in a sentence or two within the Linear-issue budget, plus **any deviation from the spec or scope that grew**, which is the one thing a reader can't get from the diff and so never gets buried.
- **Linear renders neither `<details>` nor collapsed blocks**, so everything else goes below a `---` under a `## Detail` heading: the **Key Decisions & Ramifications (top 5)** compiled above (the durable record lives on the issue so the decisions are reviewable async, not just in chat), the **goal verdict** (the goal-check command and its PASS verdict; or, when the spec documented no goal check, the justification; or, for bugs, diagnose's real-path confirmation), and the test results — including the red/green evidence (the failing output captured before the fix/implementation, then the passing output after) for each new behavioural or regression test, per the confirm-red gate. "Tests pass" alone is not sufficient.
- Keep state as "In Progress" until user approves

### Step 8: Present for Review

Present the completed work:

1. **Summary**: what was implemented (tied back to the spec)
2. **Decisions for you** (from the Step 7 list, sorted per `pr-reviewer-guidance.md` → §3): the decisions the user owns — at most three, hardest first, each with what a wrong one costs. Then, listed separately below them as **engineering calls made along the way** (no approval needed, there so nothing is hidden): everything the filters dropped, one line each. This lets the user review the decisions, not just the code.
3. **Changes**: files modified/created with brief descriptions
4. **Goal verdict**: when the spec named a goal check, the spec's goal sentence, the check that was run (command/path), that it used a real model, the control's FAIL (command and the leg it named), and its PASS verdict with the evidence it checked, plus a line confirming no *not done if* state holds — the proof the goal was met, distinct from the mocked test suite. When the spec documented that no goal check applies, state that and the one-line justification. For bugs, give diagnose's real-path confirmation instead.
5. **Deviations**: anything that differed from the spec and why
6. **Test results**: full typecheck and test output, plus the red/green evidence (failing output captured before the fix/implementation, passing output after) for each new behavioural or regression test — per the confirm-red gate. A check with no before-state carries its blast radius instead: what was broken, which checks went red, and that nothing else did. "Tests pass" alone is not evidence.
7. **Review findings**: notable findings from `review` across its lenses (coherence, restraint, correctness, completeness — plus alternatives if the change tripped its trigger) and how the must-fix / should-fix items were resolved. Alternatives rows are always notes: carry them into the summary as *"a shape worth weighing next time"*, never as unfinished work on this PR
8. **Restraint & subtraction**: what the restraint lens (`second-look`) flagged as overbuild/YAGNI and what was subtracted (BP-038)
9. **Follow-ups**: any items for future work (not in scope but worth noting)

Ask the user to review. They may:
- **Approve** → commit, push, open PR, update Linear to "Done"
- **Request changes** → make adjustments, re-run tests, present again
- **Reject** → revert changes, update Linear

### Step 9: Ship

Once approved:

1. Ensure all changes are committed with conventional commit messages referencing the issue ID
2. Push: `git push -u origin fix/{ISSUE-ID}`
3. Open PR with `gh pr create`:
   - Title: concise description (under 70 characters)
   - **Body: follow [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → "The layout"** — canonical for the block order, what collapses, when a diagram earns its place, and what never collapses. Don't restate it here. What's specific to an **implementation** PR is the mapping:

     - **Block 1 (the problem)** ← the spec's people table condensed to a sentence on the spec route, or the reported failure on a bug. **Block 3 (what's asked of you)** ← the Key Decisions & Ramifications from Step 7, **sorted and shaped per [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → §3** — it owns the filters, the three-decision ceiling (live forks included), the subheading-and-bullets shape, and where the filtered calls go; don't re-derive them here. Where the spec already settled everything and nothing new was decided, **say exactly that in one line** — its absence reads as an omission.
     - **Block 2 (what this does)** ← on the spec route, the spec's figures under the mechanism sentences, so the reviewer sees the intent the code answers to: the *what changes* figure always, plus any other figure the spec PR's body carried. Embed each as a raw image **pinned to the `main` commit that last touched it**, never the branch or this PR's head; how to find that commit, the form, and the read-back check are [`spec-figures.md`](../../../docs/contributing/spec-figures.md) → "In the PR body". Where the code deliberately departs from a figure, say so in the sentence under it. A spec whose figure is a mermaid pair gets that pair pasted instead. The *how we'll know it's met* fence goes beside the goal verdict, so the PASS and the control's FAIL read against the picture that promised them. No spec, no figure: the bug and brief routes skip this.
     - **Block 4 (parts worth reviewing closely)** is where the audience changes to the code reviewer — open it with a line saying so, and keep it to 1–3 items inside the PR's overall budget (no separate allowance — the implementation-PR row in `writing-for-humans.md` → Budgets covers the whole above-the-fold body), so a product owner knows their job ended at block 3 instead of skimming mechanism for another ask.
     - **Block 5 (links line)** carries `Fixes FIX-{number}`, the retained spec on `main`, original review PR and merged amendments when present, and the goal-check command/verdict or documented justification.
     - **Collapsed, in order:** the implementation-PR contract for this issue's route, pasted **verbatim** (below); the **engineering calls** — every decision the filters kept off block 3, one bullet each with what a wrong one costs (never dropped: filtering is sorting, not hiding); the verification output — full typecheck/test runs and the red/green evidence; then file-by-file changes, if there are enough to be a list rather than a sentence.
     - **Budget:** the implementation-PR row in [`writing-for-humans.md`](../../../docs/contributing/writing-for-humans.md) → Budgets. A small change often has no *detail* worth collapsing beyond the contract — which is never dropped, whatever the size.
     - **Scope that grew beyond the approved spec never collapses.** It is the one piece of news a reviewer of a spec-backed change cannot get from the diff.

     **Pick the contract by what backs this change** — three of the four variants reach this skill's routes, they are not interchangeable, and the wrong one inverts the review you get:
     - **Spec-backed** → review against the human-approved retained decisions and applicable evolution, not a stale predecessor. Link `specs/issues/<ISSUE-ID>/` on `main` and the original review PR. A genuine blind spot returns through a follow-up amendment PR, not an edit to the merged review branch.
     - **A bug (direct route)** → there is **no spec, no decisions doc, and no spec PR**, so claiming otherwise dangles a broken link *and* suppresses exactly the review this route needs. Nothing was signed off: this PR **is** the first and only gate, the approach is in scope, and the diagnosis (repro → cause → fix → regression test) is what a reviewer should check hardest.
     - **Brief-backed** (a one-screen agent brief is the contract, per Step 2) → also no spec and no gate upstream, but **it is not a bug**, so don't paste the bug text and send reviewers looking for a repro that doesn't exist. Point them at whether the change really is as small and local as the brief assumed — one that turns out to touch a contract or add public surface was mis-routed and should have been specced.

     **Name your own weak spot** on any of the three routes, in block 4. The single highest-value line in the description is the one you least want to write — the decision that was a coin flip, the test you're not sure covers the real path. A reviewer cannot tell which of your confident sentences was a guess unless you tell them.
4. Update Linear issue:
   - State: "Done"
   - Attach PR URL
   - Final comment with PR link

After the PR is open, the skill's job is not finished — every re-invocation falls into Step 10.

### Step 10: Respond to PR Feedback

Once the PR is open, this skill owns it until it merges. Whenever the skill is re-invoked with PR activity (new comments, new review, change requests), run this loop. The "never leave a code-related comment unresponded to" rule applies across re-invocations: a comment from yesterday is still a new comment if it doesn't yet have an `eyes` reaction from us.

**The loop is capped at twelve rounds.** One pass over the outstanding batch is one round. At the twelfth, stop auto-handling feedback and ask the human — the full rule, and why the number is what it is, is in [`orchestration.md`](../../../docs/contributing/orchestration.md) → "PR feedback: the round cap" (canonical). Two things are this skill's:

- **Report the round you spent.** Under a coordinator (`issue-lifecycle` standalone, or `epic-wake` under an epic) the count lives in *its* cache, not yours — you are a fresh sub-agent each round, so the prompt tells you the running count and you return `prFeedbackRoundsSpent`: `1` for a normal pass, `0` for a batch that was nothing but acknowledgements and process chatter (no code comment, nothing to fix or answer). If you escalate a blocker mid-round you didn't finish it: report `0`. **Invoked directly** — no coordinator — you own the count across your own re-invocations.
- **Check the cap at 10.7**, before deciding to continue — against the count the prompt gave you, or your own if you're running uncoordinated. If you weren't told a count and aren't tracking one, say so in your return rather than assuming you're at zero: an uncounted loop is the thing the cap exists to catch.

#### 10.1: Enumerate every comment and review on the PR

**First, get onto the PR branch.** Under a coordinator each feedback round runs in a *fresh* worktree, so don't assume you're still on `fix/{ISSUE-ID}`. Run `gh pr view` for the identifiers, extract `headRefName`, then check out the PR head from origin before enumerating (and before any later change or `git push`) — do **not** re-base it on `main`, that would drop the PR's commits:

```bash
# repo identifiers (use jq to extract from the PR URL or run once and cache)
gh pr view {PR} --json url,headRefName,number,reviewDecision,baseRefName
# get onto the PR head in this fresh worktree
git fetch origin {headRefName} && git checkout -B {headRefName} origin/{headRefName}
```

Then read everything attached to the PR. There are three distinct comment surfaces — you must check all three, and always `--paginate` (these endpoints return 30 items per page by default; a busy PR silently loses the rest):

```bash
# 1) inline review comments (attached to specific lines of code)
gh api --paginate repos/{owner}/{repo}/pulls/{PR}/comments

# 2) top-level PR conversation comments
gh api --paginate repos/{owner}/{repo}/issues/{PR}/comments

# 3) review submissions (the wrapper around inline comments + a body)
gh api --paginate repos/{owner}/{repo}/pulls/{PR}/reviews
```

For each comment, fetch its existing reactions so you can identify which ones you've already processed:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions
gh api repos/{owner}/{repo}/issues/comments/{comment_id}/reactions
```

A comment still **needs handling** if either (a) it has no `eyes` reaction from us yet (never seen), **or** (b) it is a *code* comment (actionable or non-actionable) that we have **not yet replied to**. **The reply — not the `eyes` reaction — is the completion marker for a code comment.** `eyes` means "seen, still open"; a threaded reply means "resolved." So a code comment sitting at **eyes-only** (a straggler from a pass that reacted and maybe even acted, but never answered) is **picked up again here**, not treated as done — this is what prevents "the agent read it and acted but never said so." Detect an existing reply to an inline comment by a child comment whose `in_reply_to_id` is that comment and whose author is us. Ignore comments authored by us (our own replies aren't feedback). Non-code conversation is done at just the `eyes` reaction — it needs no reply.

#### 10.2: Mark each new comment as seen with an `eyes` reaction

Before deciding what to do about a comment, add the `eyes` (`:eyes:`) reaction. This is a UX signal to the reviewer that the agent is aware of the comment and is processing it — it should appear *before* any reply lands, so the reviewer doesn't refresh and wonder whether the agent is alive.

```bash
# inline review comment
gh api -X POST repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions -f content=eyes
# top-level issue/PR comment
gh api -X POST repos/{owner}/{repo}/issues/comments/{comment_id}/reactions -f content=eyes
# review body
gh api -X POST repos/{owner}/{repo}/pulls/{PR}/reviews/{review_id}/reactions -f content=eyes
```

React to every new comment first, in a batch, before deciding on actions. The order matters: acknowledge everything, then decide.

#### 10.3: Classify each new comment

For each comment, pick exactly one bucket:

- **Actionable code feedback** — the reviewer is asking for a code change, pointing out a bug, suggesting a refactor in scope, or questioning the correctness of an implementation choice. → *Requires a response, almost always involving a code change.*
- **Non-actionable code feedback** — the reviewer is asking a clarifying question, expressing a preference you disagree with, suggesting work that's out of scope, or proposing something the spec explicitly excluded. → *Requires a response explaining the decision. No code change.*
- **Non-code conversation** — acknowledgments ("thanks", "LGTM, merging Monday"), meta-comments about PR process, off-topic chatter. → *No response needed.*

When in doubt between "non-actionable code feedback" and "non-code conversation", treat it as the former. The bar for skipping a response is high — **never leave a code-related comment unresponded to.**

**A second "why is it shaped like this" on one surface is a model question, not a wording one.** Before classifying it, re-read the section of the unit of intent that decided that shape (the spec or design doc, or the issue itself for a bug). If the code deviates from it, reply per [BP-002](../../../docs/contributing/best-practices/process.md#bp-002-spec-driven-execution): the conflict from the source, the fix toward it — not a defence of the cut you have.

#### 10.4: Take action and reply

Process each comment in its bucket:

**Actionable code feedback (you agree with the change):**

1. Make the change. Any test added to address the feedback — a regression test for a bug the reviewer found, a new behavioural test for a requested capability — must be demonstrated failing against the un-fixed code first: write the test before the fix, or if the fix is already written, temporarily revert it and run the test to confirm it fails for the right reason. Only then make it pass. Capture both the failing output and the passing output; you need both for the reply. This is the same discipline the PR was built under (TDD for features → tracer-bullet the test red before green; diagnose for bugs → reproduce the regression first, same red-then-green order) — PR-review fixes don't get a pass on the gate just because they're small.
2. Run the affected package's typecheck and tests:
   `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
3. Commit with a message that names the feedback being addressed and references the issue:
   `fix: address PR review — {short summary} (FIX-N)`
4. Push to the PR branch: `git push`
5. Reply on the comment thread describing exactly what changed, with concrete file references (path:line), and — for any new test — the red/green evidence (failing output before the fix, passing output after), not just "tests pass." For inline review comments, post as a threaded reply so the conversation stays attached to the code:

   ```bash
   gh api -X POST repos/{owner}/{repo}/pulls/{PR}/comments \
     -f body="Fixed in <sha>: <one-line description of what changed and where>." \
     -F in_reply_to={comment_id}
   ```

   For top-level PR conversation, use `gh pr comment {PR} --body "..."`.

**Non-actionable code feedback (no change is the right call):**

1. Reply on the thread explaining the decision. Be direct and concrete. Cite the spec, a BP rule (BP-007–BP-016), an architecture doc, or a scope boundary that justifies it.
2. If the suggestion is a real follow-up that just isn't this PR's job, dispatch the **`issue-manager`** agent to file a Linear issue for it (related to this one, in the same project; it duplicate-checks and wires relations) and link it in the reply.

**Non-code conversation:**

Leave it alone. The `eyes` reaction is already there, which is acknowledgment enough.

#### 10.5: Reply style

- Short and concrete. No performative agreement ("Great catch!", "Good point!").
- An agent-authored review submission, PR comment, or review comment starts with the agent-mailbox header (`from:` / `session:` / `kind:`, blank line, then the body). Nothing before the header. The grammar and why an unmarked owner-login post is not a gate are in [`orchestration.md`](../../../docs/contributing/orchestration.md#gates-direction-approval-then-confirmed-merge) → Gates.
- Describe *what* changed (or *why* nothing changed), not your reasoning narrative.
- Reference file paths and commit shas when describing a fix.
- One reply per comment thread, not a wall of text.

#### 10.6: Completion gate — no code comment left silent

Before you end this PR-feedback pass, **enumerate every code comment in the batch (actionable *and* non-actionable) and confirm each has a reply from us.** Every reply is one of exactly three outcomes:

1. **Acted** — what changed and where (with the commit sha / `path:line`), per 10.4.
2. **Declining** — the concrete reason no change is being made (a spec/BP/scope citation), per the non-actionable path.
3. **Escalated** — a comment that needs a decision you can't make (a spec-level call, a scope question only the maintainer can settle): reply saying you've surfaced it and are holding on that thread, rather than leaving it silent. Under a coordinator, also return it as a blocker so the coordinator surfaces it — but the thread still gets the reply.

**Reconcile the prose with the diff — search for the old answer, don't re-read the new one.** Before closing a round that changed behavior **or corrected a claim — including a round that touched only documentation, a status tag or an accessibility description**, do three things, and **the first one is not a sweep**.

**Correct the surface the claim was derived *from*, before you converge the copies.** Ask where the wrong sentence came from — the docstring on the function, the store contract, the type — and fix that first. The copies are downstream of something, and a sweep that converges them while the source still says the old thing leaves the next writer to re-derive it from the same place. This is not hypothetical: an agent drafting a doc row reproduced a superseded framing *having derived it from the docstring*, before the correction reached it; and twice in one epic the generator was corrected a round **after** its own copies, both times by the author who had just written those copies. If you cannot name the source, say so — a claim with no upstream surface is a different and easier case.

Then the two sweeps — the **word sweep** and the **surface sweep**. The word sweep: **grep** the superseded claim's distinctive noun repo-wide, treating a hit as a site even in `--help` and error strings, package READMEs and the changeset — the places a match is easiest to wave off. The surface sweep: **go to every surface that states the claim more briefly than the place you just corrected it** — summary tables, matrices, locked-contract bullets, README condensations, diagrams — including ones in the file you are already editing, since a summary restates a claim in its own words, or in an arrow, and no string sweep sees either. **For a surface that paraphrases, enumerate the surface instead of the words** — a figure is three representations that move together (its visible text, its `aria-label`, its caption sentence), a tagged table is its N tags, a status column is its N rows — and resolve each instance against the corrected claim. An empty grep over a paraphrasing surface is not coverage of it. **One label can cover more than one claim, so resolve every claim under it, not the opening subject** — and where those claims differ in status or layer, **split the label** rather than picking the reading that makes it true. **Report both sweeps by name, and say whether enumeration ran and over what** — a surface sweep reported without it is a word sweep twice. Converge every hit in one pass, routing the user-facing ones per the next paragraph rather than editing them here. Re-reading the diff cannot find a stale claim in a file the diff never opened, and that is exactly where these survive. The body was written at Step 9; this loop has been changing the code ever since, and a claim written before the last commit is the one that ships wrong.

**User-facing pages are the exception: don't correct those yourself.** `apps/docs/` and package README API sections go back through **Step 5C** — rebuild the brief for what this round changed and dispatch `docs-writer` + `docs-editor` again. Editing them by hand here is how the review argument reaches published prose, and this is the moment you are least able to tell that it has.

Any code comment with the `eyes` reaction but **no reply is not done**: post its reply now. **Do not end the round, and do not treat the batch as processed, while any actionable comment sits at eyes-only.** The reviewer relies on the reply as the visible outcome — a comment that was silently read, considered, and even acted on, but never answered, is a failure of this gate, not a completed item. (Non-code conversation is exempt — it's done at the `eyes` reaction.)

**Measure the total, not the delta.** Check each changed file against `issue-spec` 6.5.2's triggers; if either trips, re-draft before closing, then repeat 10.4's test/commit/push, re-point every reply whose `path:line` moved, and redo the reconciliation above so nothing cites text that no longer exists.

#### 10.7: Continue until merged — or until the twelfth round

After processing the batch, **check the round count first.**

**If this was the twelfth round**, the loop stops here. Twelve rounds is well past a normal review, so the working assumption is that something structural is wrong — the same objection coming back in different words, or an approach that should be revisited rather than patched. Do three things and then stop:

1. **Post one pause comment on the PR** — the round count, which threads are still open, and that the work is paused pending direction. Every comment in *this* batch still gets its reply first (10.6 is not waived by the cap); the pause comment is in addition to those, not instead of them. Don't push further code after it.
2. **Say what you actually think.** The human is deciding whether to keep going or re-examine the approach, and you have the one thing they don't: you've read every round. State plainly whether this is converging slowly or looping, name the objection that keeps coming back if there is one, and say what you'd change. A bare "12 rounds reached" makes them re-read the thread to recover what you already know.
3. **Surface it and stop.** Standalone, ask the user directly. Under a coordinator, report `prFeedbackRoundsSpent: 1` and let the count do it — **do not report a `blocker` for the cap itself.** An escalating worker is charged zero rounds and keeps its batch unconsumed, so a blocker here would leave the counter one short of the cap and re-deliver this same batch after the human answered, re-posting every reply. The coordinator raises the question from the count. (A blocker for some *other* decision you genuinely can't make is unaffected.) Either way, **handle no further feedback on this PR** — no fixes, no pushes, not even for a comment that looks trivial — until they answer.

When the answer comes back, carry it in as given (implement the decision, don't re-derive it), reset the count to zero, and resume the loop. The reset is what un-parks the issue.

**Otherwise, continue:**

- If reviews requested changes and you've addressed them all, re-request review:
  `gh pr edit {PR} --add-reviewer {handle}`
- If the PR is approved with no open threads **and an automated review (Codex or Cursor) has returned on its current head** (some completed automated review ran against the PR's head sha: a Codex review's `commit_id` from `get_reviews`, or a Cursor check run's `head_sha`, equals it), it's ready to merge — but defer the merge decision to the user unless the workflow explicitly allows auto-merge.
- If new activity arrives later, re-enter at Step 10.1.
- If merge conflicts are detected (and you should check), then automatically handle them. If there is any major concern about how to merge, ask the user first before merging

The skill exits this loop only when the PR is merged or closed.

## Guidelines

- **Spec drives everything.** Don't improvise beyond the spec. If the spec is wrong, flag it — don't silently deviate.
- **Spec merge precedes implementation.** Repository content stays canonical after human approval and required checks. Post-merge amendments and POCs use new PRs from `main`; material direction changes need renewed approval. Implementation PR merge is a separate human-controlled gate.
- **Sub-agents get full context.** Never make a sub-agent read files to understand their task. Paste the relevant spec sections directly into the prompt.
- **Sequential implementation, parallel review.** Tasks execute in order (they often depend on prior tasks). Reviews run in parallel (they're independent).
- **Fix before presenting.** The user should see clean work, not a list of known issues. Fix everything the reviewers flag before Step 8.
- **Restraint is not optional.** `review`'s restraint lens (`second-look`) exists because agents tend to over-build. Take its findings seriously — subtraction is part of the change (BP-038).
- **One shot for simple issues.** Don't spin up sub-agents for a 10-line bug fix. The complexity assessment in Step 4 exists to prevent ceremony overhead on simple work.
- **Keep Linear updated.** Every state change should be reflected. The whole point is traceability.
- **Acknowledge before you act.** On every PR re-invocation, react to every new comment with `eyes` *before* deciding what to do with any of them. Reviewers should never wonder whether the agent saw their comment.
- **Never leave a code-related comment unresponded to.** Every actionable comment gets a code change + reply; every non-actionable code comment gets a reply explaining why no change is being made. Only pure non-code conversation (acknowledgments, scheduling, off-topic) can be left at just the `eyes` reaction. **The `eyes` reaction marks *seen*, not *resolved*** — a code comment is done only when it *also* has a reply. A comment left at eyes-only (read, considered, maybe even acted on, but never answered) is the exact failure this guards against: the reviewer can't tell whether it was seen, understood, or handled. The 10.6 completion gate enforces this every pass.
- **Replies describe outcomes, not reasoning.** Say what changed and where, or why nothing changed and which rule/spec backs that. No performative agreement.
