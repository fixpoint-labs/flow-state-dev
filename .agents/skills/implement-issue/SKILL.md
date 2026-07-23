---
name: fsd:implement-issue
description: Use when implementing a Linear issue. Fetches the issue and spec, creates a fix branch, auto-routes by Linear category (Bug vs Feature/Enhancement) to the right implementation discipline, dispatches sub-agents for complex work, runs a comprehensive review, opens a PR, and then stays on the PR — acknowledging new review comments with an eyes reaction and responding to every code-related comment with either a fix or a justification. Handles "Fix bug for FIX-N" and "Implement FEAT-N" the same way — the routing happens inside.
argument-hint: "<Linear issue ID, e.g. FIX-123>"
---

You are an implementation agent. Given a Linear issue ID, your job is to pull the issue and its spec, set up a branch, implement the work using the right discipline for the issue's category, dispatching sub-agents for anything non-trivial, and run a thorough review before presenting the result.

## Core Principles

**The spec is the source of truth, not the issue description.** The issue description says *what* and *why*. The spec says *how* — it is authored at `docs/specs/<ISSUE-ID>.md` on the spec PR branch (`spec/<ISSUE-ID>`, PR titled `spec(<ISSUE-ID>)`) and mirrored to the attached Linear document. The spec PR is a review vehicle, not a merge target: it exists to collect feedback, and this skill closes it unmerged at Step 3 — so the spec file is NOT on main. The two copies should be in sync but may have drifted, and the spec PR may carry review comments never folded into either copy — Step 1 reconciles all of this before any code is written. **While the spec PR is open, the GitHub PR copy is the authoritative reference** — it is where review feedback and iteration land, so it is the one to trust and mirror onto Linear; the Linear document is only the source when there is no open spec PR to read from. When issue and spec conflict on implementation details, the spec wins. If no spec exists, behavior depends on category (see Step 2).

**Bugs and features follow different disciplines.** Step 4 reads the Linear category label and routes:

- **Bug** → implementer sub-agents follow **`fsd:diagnose`** (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup). For flow-execution bugs specifically, Phase 1 of diagnose hands off to **`fsd:debug-flow`** for the NDJSON trace reader.
- **Feature / Enhancement** → implementer sub-agents follow **`fsd:tdd`** (red-green-refactor with vertical tracer-bullet slices). One test → minimal code → repeat. No horizontal slicing.

Both disciplines are embedded into the implementer sub-agent prompt at dispatch time. The implementer doesn't choose — this skill picks based on the label and gives them the right shape.

**Red is a gate, not a suggestion.** For any change with observable behaviour, the discipline is not satisfied by writing the test after the code, or writing the test and the fix together and only confirming green. The flow is always: write ONE behavioural test → run it → observe it fail for the intended reason (not a typo, import error, or missing fixture) → write the minimal code → observe it pass. Both the failing output and the passing output are evidence (BP-003) — "tests pass" alone proves nothing if the test was never seen to fail. This applies everywhere this skill drives a code change: Step 5A/5B implementation (tracer-bullet loop, red-before-green per slice) and Step 10.4 fixes made in response to PR review (every regression test shown failing against the un-fixed code first). Step 6's completeness review checks for this evidence, not just green tests.

**Exceptions.** (a) Pure characterization/parity work — swapping an implementation while holding pre-existing tests green (see `fsd:tdd` → "When NOT to use TDD") — has no red-green cycle by design; the discipline there is that the parity tests already existed *before* the change and continue to pass, not that anything was ever red. (b) Trivial, mechanical edits with no behavioural surface — config values, docs, renames — don't need a test at all. Anything with observable behaviour (an item emitted, a return value, a state change, a symptom that's now fixed) gets the red gate; when in doubt, treat it as observable.

**Meta-awareness — challenge the spec where the code contradicts it.** The spec did the hard 80% and passed review, but implementation is the first time its assumptions meet real code. At the step boundaries you judge most likely to expose a blind spot — not the trivial ones — run the **challenger** sub-agent (`./challenger-prompt.md`). It asks only whether the code reveals something the spec *misunderstood or didn't realize*; it does not re-litigate a reviewed spec or review quality/scope. On a real blind spot, **surface it**: escalate to the human when available, else take the best-judgment path, fold the correction into the spec, and flag it loudly as a spec deviation in the PR and Linear (never silently force-follow or deviate). A challenged blind spot is prime `fsd:distill-lessons` signal.

## Workflow

**Re-entry on an in-flight PR.** Before running Step 1 from scratch, check if this issue already has an open **implementation** PR (`gh pr list --search "FIX-N in:title,body" --state open`, or the URL recorded on the Linear issue). **Ignore the docs-only spec PR** (`spec(FIX-N)` title / `spec/FIX-N` branch from `fsd:create-spec`, open or closed) — that's the spec artifact, not the implementation; matching it would wrongly jump to PR-feedback mode and skip the build. If an implementation PR exists, the implementation phase is done — jump directly to **Step 10 (Respond to PR Feedback)**. Do not branch, re-implement, or re-review.

### Step 1: Pull the Linear Issue

Fetch everything about the issue:

1. `get_issue` with `includeRelations: true` — get the full issue: description, labels, priority, relations
2. `list_comments` — read any discussion or decisions
3. **Read the spec — from both homes, plus the spec-PR review.** The spec lives in two places that should match but may not: the spec PR branch and the Linear document.
   1. **Locate the spec PR**: `gh pr list --search "spec({ISSUE-ID}) in:title" --state all --json number,state,headRefName,url`. It may be open (normal) or already closed (a prior run got past Step 3).
   2. **Read the repo copy** from the PR head, using the `headRefName` returned by the previous step (git refs are case-sensitive — don't retype the branch name): `git fetch origin {headRefName} && git show FETCH_HEAD:docs/specs/{ISSUE-ID}.md`. If the branch is gone (PR closed with branch deleted), fetch `pull/{N}/head` instead and read from `FETCH_HEAD` the same way.
   3. **Read the Linear copy** with `get_document` (titled `{ISSUE-ID}: ... — Implementation Spec`).
   4. **Read the spec-PR discussion** — all three comment surfaces, same commands as Step 10.1 (inline review comments, top-level PR comments, review submissions). Reviewers critique the design here; some feedback may have been applied to the spec text, some may not.
   5. **Reconcile — the GitHub PR copy wins while the spec PR is open.** The spec PR is where review feedback and iteration land, so whenever the spec PR is open its head copy is the authoritative spec text — take it even if the Linear document's timestamp looks newer (a stray Linear edit does not outrank the reviewed PR copy). Mirror that text to the Linear document *now*, so Linear is correct before the spec PR closes at Step 3. Fall back to the Linear document as the source **only when there is no open PR version to reference**: if the spec PR is already closed its file is frozen and Linear holds the reconciled text plus any post-close edits, so Linear is authoritative — read the closed PR only for its review history, and never mirror the old PR file back over Linear; if no spec PR ever existed, the Linear document (or agent-brief) is the source. Either way, for each substantive spec-PR comment, check whether the spec text addresses it; collect the ones that don't as open questions for Step 2.
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

1. **Spec exists?**
   - **Issue labeled "Bug" with a clear reproduction** → proceed without a full spec. Bugs follow `fsd:diagnose`, which requires a feedback loop before any code change — that's the implementer's first job, not the spec author's. If the issue body lacks a reproduction or is ambiguous, still consider running `/create-spec` (specs aren't only for features) — the spec for a bug captures the reproduction shape and the regression-test seam.
   - **Issue labeled "Feature" / "Enhancement" / "Improvement" with no spec** → tell the user: *"This issue has no spec attached. Should I proceed based on the description alone, or create a spec first with `/create-spec {ID}`?"* For non-trivial feature work, no-spec is usually a mistake.
   - **Either category with a one-screen agent-brief** (per `docs/contributing/agent-brief-template.md`) → proceed; that brief is the contract.

2. **Dependencies resolved?** Check blocking issues:
   - If blockers are still "In Progress" or "Todo" → tell the user what's blocking and stop
   - If blockers are "Done" but code isn't on main → check if there's a merged PR. If not, flag it

3. **Open questions?** If the spec has an "Open Questions" section with unresolved items, or Step 1 surfaced substantive spec-PR review comments the spec text never addressed → present them to the user and wait for answers before proceeding. Once answered, fold the decisions into the spec text and update the Linear document before moving on — after Step 3 closes the spec PR, Linear is the only live copy, and sub-agent prompts are built from it

If all clear, move to Step 3.

### Step 3: Set Up Branch

1. Ensure main is up to date: `git checkout main && git pull`
2. Create the branch: `fix/{ISSUE-ID}` (e.g., `fix/FIX-123`) — lowercase the ID.
   **Scoped to a sub-PR of a multi-PR plan?** (Invoked by `fsd:issue-lifecycle` for one
   node of the spec's PR plan.) Then use branch `fix/{ISSUE-ID}-{sub-PR id}`, implement
   **only that sub-PR's deliverables** (not the whole issue), branch off the dependency's
   branch if it has one (else main), and open that sub-PR. Do **not** close the spec PR
   per sub-PR — the lifecycle closes it once, when the plan starts.
3. **Close the spec PR — never merge it.** The spec PR exists to collect review; merging it would accumulate point-in-time spec docs on main that go stale the moment implementation deviates. The Linear document (reconciled in Step 1) is the durable copy, and the closed PR keeps the review history findable. Close with a comment and delete the branch:

   ```bash
   gh pr close {spec-pr} --delete-branch \
     --comment "Spec review complete — implementation starting on fix/{issue-id}. Canonical spec is the Linear document on {ISSUE-ID}; review history stays on this PR."
   ```

   Skip if there's no spec PR (bug without a spec, agent-brief issue) or it's already closed. From this point on, the Linear document is the only live copy — any mid-implementation spec edit happens there.
4. Update the Linear issue state to "In Development" using `save_issue`

### Step 4: Determine Category and Complexity

#### 4.1: Pick the discipline (by Linear category label)

- **Bug** → discipline = **`fsd:diagnose`**. Implementer sub-agent must build a feedback loop and reproduce the bug *before* changing code. The discipline's six phases (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup) get embedded in the implementer prompt. For flow-execution bugs specifically, point the implementer at `fsd:debug-flow` for Phase 1 mechanics (NDJSON event types, failure-pattern table).
- **Feature / Enhancement / Improvement** → discipline = **`fsd:tdd`**. Implementer sub-agent follows red-green-refactor with vertical tracer-bullet slices: write one behavioural test for the first slice → minimal code to pass → repeat. No "write all the specs first" — that produces tests insensitive to real bugs.
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

If the area being touched is unfamiliar to you (whether running this skill directly or dispatching sub-agents), get a map first via `fsd:zoom-out` shape — package / flow / actions / block kinds / capabilities / scopes / items / boundaries / callers. A 30-second orientation prevents an hour of misdirected work.

### Step 5A: Simple Implementation

Follow the discipline picked at Step 4.1. As you work, at any boundary that resists the spec's plan or sits on a Part I decision, run the challenger (Core Principles → Meta-awareness; `./challenger-prompt.md`) before committing to that direction. Skip it at trivial boundaries.

**For bugs (`fsd:diagnose` discipline):**

1. Read relevant code to understand the area (use `fsd:zoom-out` shape if unfamiliar)
2. **Build a feedback loop FIRST** (Phase 1 of diagnose). Don't touch code until you have a reproduction:
   - Default: vitest filter at the package level — fastest, sharpest
   - For block-level isolation: `fsdev block <path> -i '<json>'`
   - For flow-level reproduction: `fsdev run` with NDJSON capture (hand off to `fsd:debug-flow` for trace reading)
   - For type-only regressions: `pnpm --filter <pkg> typecheck`
3. Reproduce the bug through the loop. Confirm the failure mode matches what the user described.
4. Hypothesise: 3–5 ranked falsifiable hypotheses before testing any.
5. Instrument with `[DEBUG-<short-hash>]` tags so cleanup is a single grep at the end.
6. **Write the regression test before the fix** (Phase 5 of diagnose), at the correct seam — the seam the spec named in Testing Strategy, or the spec's substitute if one was not provided. Run it and confirm it fails for the bug's actual reason, not a typo or setup error. Capture the failing output — you'll need it for the report.
7. Apply the fix.
8. Run the regression test again and capture the passing output. Run the loop again; verify the original repro no longer reproduces. If the bug was user-visible behaviour (not a pure type/unit regression), confirm the fix through the **real path** too — `fsdev run` against a real model — not only the mocked regression spec, so you've proven the symptom is actually gone.
9. Cleanup: grep `[DEBUG-` and remove all instrumentation. Delete throwaway harnesses.
10. Run typechecks and tests: `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
11. Commit with a conventional commit message referencing the issue ID. The commit message names which hypothesis turned out correct, so the next debugger learns.
12. Skip to Step 6 (Review)

**For features/enhancements (`fsd:tdd` discipline):**

1. Read relevant code to understand the area (use `fsd:zoom-out` shape if unfamiliar)
2. List the behaviours to test from the spec's Testing Strategy — observable outcomes through the public surface (items emitted, state changes, return values), not implementation steps
3. **Tracer bullet**: write ONE test for the first behaviour through `@flow-state-dev/testing`'s mock context. Run it — confirm it fails for the intended reason (the behaviour doesn't exist yet, not a typo or import error) — and capture the failing output. Only then write the minimal code to make it pass, run it again, and capture the passing output.
4. **Incremental loop**: for each remaining behaviour, RED (write the test, run it, confirm it fails for the intended reason, capture the output) → GREEN (minimal code, run it, capture the passing output). One test at a time. Do not write all tests first, and do not write a test and its implementation together without running the test red first.
5. After all tests pass, refactor while green: extract duplication, deepen modules, follow BP-011–BP-016. Never refactor while red.
6. For generators specifically: assert schema strictness with `makeSchemaStrict` per BP-016.
7. Run typechecks and tests: `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
8. **Run the goal check** if the spec's Testing Strategy names one (real model, real path — see `fsd:tdd` → "Two kinds of test"). Green specs are mocked; they don't prove the goal. Run `fsdev run` against a real model or `pnpm tsx goals/<describe>/<it>/run.mts` and confirm PASS on the actual outcome. If it fails, the work isn't done — return to the loop. Record the command and verdict. If the spec documented that no goal check applies (docs/refactor/config work with no observable outcome), skip this and note the documented justification.
9. Commit with a conventional commit message referencing the issue ID
10. Skip to Step 6 (Review)

### Step 5B: Complex Implementation (Sub-agent Team)

#### 5B.1: Extract Tasks from Spec

Parse the spec's "Implementation Sequence" into discrete, ordered tasks. For each task, note:
- What to build (exact files, functions, types)
- What it depends on (which prior tasks must complete first)
- How to test it (acceptance criteria from spec)
- What NOT to build (scope boundaries)

Create a TodoWrite with all tasks.

#### 5B.2: Dispatch Implementer Sub-agents

For each task, sequentially dispatch an implementer sub-agent using the template in `./implementer-prompt.md`. The template has a `[Discipline]` slot — fill it based on Step 4.1:

- **Bug** → fill with the `fsd:diagnose` discipline block (see template). Sub-agent must build a feedback loop and reproduce before changing code; produces a regression test at the spec's named seam; runs the cleanup pass before reporting.
- **Feature/Enhancement** → fill with the `fsd:tdd` discipline block (see template). Sub-agent runs red-green-refactor with tracer bullets, one test → one impl, no horizontal slicing.

Provide:

- **Full task text** from the spec (don't make the sub-agent read files)
- **Scene-setting context**: where this fits in the overall implementation, what prior tasks produced, architectural constraints. If the sub-agent is landing in unfamiliar code, include a `fsd:zoom-out` shape map up front
- **The relevant spec sections** that inform this task (Technical Design, Edge Cases, Testing Strategy — Testing Strategy is especially load-bearing because it names the discipline's seam)
- **Codebase conventions** from AGENTS.md and best-practices.md — universal rules + index inline; situational rule text (e.g. BP-010 react, BP-011–BP-016 blocks/generators/resources) in `docs/contributing/best-practices/<category>.md`
- **The chosen discipline block** filled into the `[Discipline]` slot

**Model selection (per the AGENTS.md model-tiering policy — "Opus judges, Sonnet executes decided work, Haiku fetches"):**
- **Decided execution** — a well-specified task whose architecture the spec already settled (mechanical or integration) → dispatch the **`spec-implementer`** agent (Sonnet). It escalates any un-decided fork as a blocker rather than inventing it, so judgment stays upstream.
- **Architecture / design tasks** (a new abstraction, a genuinely open shape the spec left to the implementer) → keep on the **default (Opus)** model; the judgment isn't settled yet.
- **Bugs with non-trivial reproduction** → **default (Opus)**; the diagnose loop benefits from careful reading (cheaper models often skip Phase 1). Once the repro and fix approach are clear, the mechanical fix itself can go to `spec-implementer`.
- **Read-only orientation** before a task (a `fsd:zoom-out` map, locating callers) → the **`scout`** agent (Haiku).

**Handle implementer status:**
- **DONE** → proceed to spec review
- **DONE_WITH_CONCERNS** → read concerns, address if about correctness, note if observational
- **NEEDS_CONTEXT** → provide missing context and re-dispatch
- **BLOCKED** → assess and either provide more context, use a more capable model, break the task smaller, or escalate to user

#### 5B.3: Spec Compliance Review (per task)

For a task on a high-risk boundary (it resisted the spec's plan, exposed a checkable assumption, or sits on a Part I decision), **run the challenger first** (`./challenger-prompt.md`) — catch a spec blind spot before the compliance check, since compliance assumes the spec is right. Skip the challenger for mechanical tasks.

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
- **Prove the goal on the assembled work** (real model, real path — see `fsd:tdd` → "Two kinds of test"). The per-task specs are mocked and only prove the pieces; this step proves the whole achieves the outcome. Confirm PASS before moving to review and record the command and verdict.
  - **Feature/Enhancement:** run the goal check the spec names. If the spec documented that no goal check applies, skip and note the documented justification.
  - **Bug** (complex bugs route through 5B, not 5A): if the original symptom was user-visible, re-run the **original repro through the real path** (`fsdev run` against a real model) on the assembled fix and confirm it's gone — this is the bug's goal verdict Step 6 expects. For a pure type/unit regression, note "N/A — type/unit-only" with the regression test as the proof.

### Step 6: Comprehensive Review

This is the critical quality gate. **Invoke `fsd:review`** on the change (the implementation branch/PR), passing the spec and the Linear category as context. It is the single definition of how we review — the same skill runs standalone — so there is no separate inline panel here. It composes the review lenses as **parallel sub-agents** and returns one deduped, ranked report:

- **Coherence** (`fsd:audit-coherence`) — does the solution cohere with `docs/philosophy.md` and the surrounding patterns? The apex lens: it catches the "directionally-right spec but the design feels off" failure the others structurally can't. A coherence break usually means reshaping the approach, not patching lines.
- **Restraint** (`fsd:second-look`) — overbuilt / YAGNI / 80-20 / what can be subtracted (BP-038)?
- **Correctness** — bugs and logic errors + the second-path checklist (BP-035) + the changeset (BP-022).
- **Completeness** (a spec is in scope) — every spec requirement built and nothing extra, **red demonstrated** (the failing output captured before the fix), and the **goal proven** on a real model (or the documented "no goal check applies" justification; for bugs, diagnose's real-path confirmation).

Depth follow-ups (`fsd:improve-codebase-architecture`) come back as non-blocking notes. If the area is unfamiliar or large, `review` may run the depth lens too.

#### Process Review Results

**For each issue found, categorize:**
- **Must fix** — spec gaps, bugs, security issues → fix before presenting
- **Should fix** — over-engineering, unnecessary complexity → fix before presenting
- **Note for user** — observations, follow-up suggestions → include in summary

Fix all must-fix and should-fix items. Re-run affected tests after fixes.

### Step 7: Update Linear

First, **compile the Key Decisions & Ramifications (top 5)** — the most consequential decisions made *during implementation* (not the spec's): a shape the spec left open, a deviation, a tradeoff under a constraint the spec didn't anticipate. For each: the decision, the alternative rejected, and the ramification — what it locks in, what it rules out, what risk it carries. If implementation was purely mechanical with no real decisions, say so rather than padding to five. This list is reused verbatim in Step 8 (presentation) and Step 9 (PR body).

Then update the Linear issue:
- Add a comment summarizing: what was implemented, approach taken, test results — including the red/green evidence (the failing output captured before the fix/implementation, then the passing output after) for each new behavioural or regression test, per the confirm-red gate; "tests pass" alone is not sufficient — the **goal verdict** (the goal-check command and its PASS verdict; or, when the spec documented no goal check, the justification; or, for bugs, diagnose's real-path confirmation), any deviations from spec
- Include the **Key Decisions & Ramifications (top 5)** compiled above — the durable record lives on the issue so the decisions are reviewable async, not just in chat
- Keep state as "In Progress" until user approves

### Step 8: Present for Review

Present the completed work:

1. **Summary**: what was implemented (tied back to the spec)
2. **Key decisions & ramifications (top 5)**: the list compiled in Step 7 — each decision made *during implementation*, the alternative rejected, and the ramification (what it locks in, what it rules out, what risk it carries). This lets the user review the decisions, not just the code.
3. **Changes**: files modified/created with brief descriptions
4. **Goal verdict**: when the spec named a goal check, the check that was run (command/path), that it used a real model, and its PASS verdict with the evidence it checked — the proof the goal was met, distinct from the mocked test suite. When the spec documented that no goal check applies, state that and the one-line justification. For bugs, give diagnose's real-path confirmation instead.
5. **Deviations**: anything that differed from the spec and why
6. **Test results**: full typecheck and test output, plus the red/green evidence (failing output captured before the fix/implementation, passing output after) for each new behavioural or regression test — per the confirm-red gate. "Tests pass" alone is not evidence.
7. **Review findings**: notable findings from `fsd:review` across its lenses (coherence, restraint, correctness, completeness) and how the must-fix / should-fix items were resolved
8. **Restraint & subtraction**: what the restraint lens (`fsd:second-look`) flagged as overbuild/YAGNI and what was subtracted (BP-038)
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
   - Body: summary, changes, **Key Decisions & Ramifications (top 5)** (the same list compiled in Step 7 — so reviewers evaluate the direction, not only the diff), test plan, the **goal verdict** (goal-check command + PASS verdict; or the documented no-goal-check justification; or diagnose's real-path confirmation for bugs), `Fixes FIX-{number}`
4. Update Linear issue:
   - State: "Done"
   - Attach PR URL
   - Final comment with PR link

After the PR is open, the skill's job is not finished — every re-invocation falls into Step 10.

### Step 10: Respond to PR Feedback

Once the PR is open, this skill owns it until it merges. Whenever the skill is re-invoked with PR activity (new comments, new review, change requests), run this loop. The "never leave a code-related comment unresponded to" rule applies across re-invocations: a comment from yesterday is still a new comment if it doesn't yet have an `eyes` reaction from us.

#### 10.1: Enumerate every comment and review on the PR

Use `gh` to read everything attached to the PR. There are three distinct comment surfaces — you must check all three, and always `--paginate` (these endpoints return 30 items per page by default; a busy PR silently loses the rest):

```bash
# repo identifiers (use jq to extract from the PR URL or run once and cache)
gh pr view {PR} --json url,headRefName,number,reviewDecision,baseRefName

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

A comment is **new** (unprocessed) if it does not yet have an `eyes` reaction from us (the PR author / the agent's GitHub identity). Ignore comments authored by us — we don't acknowledge our own replies.

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
2. If the suggestion is a real follow-up that just isn't this PR's job, offer to file a Linear issue and link it in the reply.

**Non-code conversation:**

Leave it alone. The `eyes` reaction is already there, which is acknowledgment enough.

#### 10.5: Reply style

- Short and concrete. No performative agreement ("Great catch!", "Good point!").
- Describe *what* changed (or *why* nothing changed), not your reasoning narrative.
- Reference file paths and commit shas when describing a fix.
- One reply per comment thread, not a wall of text.

#### 10.6: Continue until merged

After processing the batch:

- If reviews requested changes and you've addressed them all, re-request review:
  `gh pr edit {PR} --add-reviewer {handle}`
- If the PR is approved with no open threads, it's ready to merge — but defer the merge decision to the user unless the workflow explicitly allows auto-merge.
- If new activity arrives later, re-enter at Step 10.1.
- If merge conflicts are detected (and you should check), then automatically handle them. If there is any major concern about how to merge, ask the user first before merging

The skill exits this loop only when the PR is merged or closed.

## Guidelines

- **Spec drives everything.** Don't improvise beyond the spec. If the spec is wrong, flag it — don't silently deviate.
- **The spec PR is a review vehicle, not a merge target.** It closes (unmerged) at Step 3. Mirror any Step 1 reconciliation to the Linear document before closing — after the close, Linear is the sole live spec. Never re-open or merge a spec PR.
- **Sub-agents get full context.** Never make a sub-agent read files to understand their task. Paste the relevant spec sections directly into the prompt.
- **Sequential implementation, parallel review.** Tasks execute in order (they often depend on prior tasks). Reviews run in parallel (they're independent).
- **Fix before presenting.** The user should see clean work, not a list of known issues. Fix everything the reviewers flag before Step 8.
- **Restraint is not optional.** `fsd:review`'s restraint lens (`fsd:second-look`) exists because agents tend to over-build. Take its findings seriously — subtraction is part of the change (BP-038).
- **One shot for simple issues.** Don't spin up sub-agents for a 10-line bug fix. The complexity assessment in Step 4 exists to prevent ceremony overhead on simple work.
- **Keep Linear updated.** Every state change should be reflected. The whole point is traceability.
- **Acknowledge before you act.** On every PR re-invocation, react to every new comment with `eyes` *before* deciding what to do with any of them. Reviewers should never wonder whether the agent saw their comment.
- **Never leave a code-related comment unresponded to.** Every actionable comment gets a code change + reply; every non-actionable code comment gets a reply explaining why no change is being made. Only pure non-code conversation (acknowledgments, scheduling, off-topic) can be left at just the `eyes` reaction.
- **Replies describe outcomes, not reasoning.** Say what changed and where, or why nothing changed and which rule/spec backs that. No performative agreement.
