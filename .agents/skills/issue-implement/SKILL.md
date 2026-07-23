---
name: issue-implement
description: Use when implementing a Linear issue. Fetches the issue and spec, creates a fix branch, auto-routes by Linear category (Bug vs Feature/Enhancement) to the right implementation discipline, dispatches sub-agents for complex work, runs a comprehensive review, opens a PR, and then stays on the PR — acknowledging new review comments with an eyes reaction and responding to every code-related comment with either a fix or a justification. Handles "Fix bug for FIX-N" and "Implement FEAT-N" the same way — the routing happens inside.
argument-hint: "<Linear issue ID, e.g. FIX-123>"
---

You are an implementation agent. Given a Linear issue ID, your job is to pull the issue and its spec, set up a branch, implement the work using the right discipline for the issue's category, dispatching sub-agents for anything non-trivial, and run a thorough review before presenting the result.

## Core Principles

**The spec is the source of truth, not the issue description.** The issue description says *what* and *why*. The spec says *how* — it is authored at `docs/specs/<ISSUE-ID>.md` on the spec PR branch (`spec/<ISSUE-ID>`, PR titled `spec(<ISSUE-ID>)`) and mirrored to the attached Linear document. The spec PR is a review vehicle, not a merge target: it exists to collect feedback, and this skill closes it unmerged at Step 3 — so the spec file is NOT on main. The two copies should be in sync but may have drifted, and the spec PR may carry review comments never folded into either copy — Step 1 reconciles all of this before any code is written. **While the spec PR is open, the GitHub PR copy is the authoritative reference** — it is where review feedback and iteration land, so it is the one to trust and mirror onto Linear; the Linear document is only the source when there is no open spec PR to read from. When issue and spec conflict on implementation details, the spec wins. If no spec exists, behavior depends on category (see Step 2).

**Bugs and features follow different disciplines.** Step 4 reads the Linear category label and routes:

- **Bug** → implementer sub-agents follow **`diagnose`** (build feedback loop → reproduce → hypothesise → instrument → fix + regression test → cleanup). For flow-execution bugs specifically, Phase 1 of diagnose hands off to **`debug-flow`** for the NDJSON trace reader.
- **Feature / Enhancement** → implementer sub-agents follow **`tdd`** (red-green-refactor with vertical tracer-bullet slices). One test → minimal code → repeat. No horizontal slicing.

Both disciplines are embedded into the implementer sub-agent prompt at dispatch time. The implementer doesn't choose — this skill picks based on the label and gives them the right shape.

## Workflow

**Re-entry on an in-flight PR.** Before running Step 1 from scratch, check if this issue already has an open **implementation** PR (`gh pr list --search "FIX-N in:title,body" --state open`, or the URL recorded on the Linear issue). **Ignore the docs-only spec PR** (`spec(FIX-N)` title / `spec/FIX-N` branch from `issue-spec`, open or closed) — that's the spec artifact, not the implementation; matching it would wrongly jump to PR-feedback mode and skip the build. If an implementation PR exists, the implementation phase is done — jump directly to **Step 10 (Respond to PR Feedback)**. Do not branch, re-implement, or re-review.

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
   - **Issue labeled "Bug" with a clear reproduction** → proceed without a full spec. Bugs follow `diagnose`, which requires a feedback loop before any code change — that's the implementer's first job, not the spec author's. If the issue body lacks a reproduction or is ambiguous, still consider running `/issue-spec` (specs aren't only for features) — the spec for a bug captures the reproduction shape and the regression-test seam.
   - **Issue labeled "Feature" / "Enhancement" / "Improvement" with no spec** → tell the user: *"This issue has no spec attached. Should I proceed based on the description alone, or create a spec first with `/issue-spec {ID}`?"* For non-trivial feature work, no-spec is usually a mistake.
   - **Either category with a one-screen agent-brief** (per `docs/contributing/agent-brief-template.md`) → proceed; that brief is the contract.

2. **Dependencies resolved?** Check blocking issues:
   - If blockers are still "In Progress" or "Todo" → tell the user what's blocking and stop
   - If blockers are "Done" but code isn't on main → check if there's a merged PR. If not, flag it

3. **Open questions?** If the spec has an "Open Questions" section with unresolved items, or Step 1 surfaced substantive spec-PR review comments the spec text never addressed → present them to the user and wait for answers before proceeding. Once answered, fold the decisions into the spec text and update the Linear document before moving on — after Step 3 closes the spec PR, Linear is the only live copy, and sub-agent prompts are built from it

If all clear, move to Step 3.

### Step 3: Set Up Branch

1. Ensure main is up to date: `git checkout main && git pull`
2. Create the branch: `fix/{ISSUE-ID}` (e.g., `fix/FIX-123`) — lowercase the ID
3. **Close the spec PR — never merge it.** The spec PR exists to collect review; merging it would accumulate point-in-time spec docs on main that go stale the moment implementation deviates. The Linear document (reconciled in Step 1) is the durable copy, and the closed PR keeps the review history findable. Close with a comment and delete the branch:

   ```bash
   gh pr close {spec-pr} --delete-branch \
     --comment "Spec review complete — implementation starting on fix/{issue-id}. Canonical spec is the Linear document on {ISSUE-ID}; review history stays on this PR."
   ```

   Skip if there's no spec PR (bug without a spec, agent-brief issue) or it's already closed. From this point on, the Linear document is the only live copy — any mid-implementation spec edit happens there.
4. Update the Linear issue state to "In Development" using `save_issue`

### Step 4: Determine Category and Complexity

#### 4.1: Pick the discipline (by Linear category label)

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

Follow the discipline picked at Step 4.1.

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
6. Apply the fix.
7. Write the regression test (Phase 5 of diagnose) at the correct seam — the seam the spec named in Testing Strategy, or the spec's substitute if one was not provided.
8. Run the loop again; verify the original repro no longer reproduces. If the bug was user-visible behaviour (not a pure type/unit regression), confirm the fix through the **real path** too — `fsdev run` against a real model — not only the mocked regression spec, so you've proven the symptom is actually gone.
9. Cleanup: grep `[DEBUG-` and remove all instrumentation. Delete throwaway harnesses.
10. Run typechecks and tests: `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
11. Commit with a conventional commit message referencing the issue ID. The commit message names which hypothesis turned out correct, so the next debugger learns.
12. Skip to Step 6 (Review)

**For features/enhancements (`tdd` discipline):**

1. Read relevant code to understand the area (use `zoom-out` shape if unfamiliar)
2. List the behaviours to test from the spec's Testing Strategy — observable outcomes through the public surface (items emitted, state changes, return values), not implementation steps
3. **Tracer bullet**: write ONE test for the first behaviour through `@flow-state-dev/testing`'s mock context → write minimal code to pass → green
4. **Incremental loop**: for each remaining behaviour, RED (one test, fails) → GREEN (minimal code, passes). One test at a time. Do not write all tests first.
5. After all tests pass, refactor while green: extract duplication, deepen modules, follow BP-011–BP-016. Never refactor while red.
6. For generators specifically: assert schema strictness with `makeSchemaStrict` per BP-016.
7. Run typechecks and tests: `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
8. **Run the goal check** if the spec's Testing Strategy names one (real model, real path — see `tdd` → "Two kinds of test"). Green specs are mocked; they don't prove the goal. Run `fsdev run` against a real model or `pnpm tsx goals/<describe>/<it>/run.mts` and confirm PASS on the actual outcome. If it fails, the work isn't done — return to the loop. Record the command and verdict. If the spec documented that no goal check applies (docs/refactor/config work with no observable outcome), skip this and note the documented justification.
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

- **Bug** → fill with the `diagnose` discipline block (see template). Sub-agent must build a feedback loop and reproduce before changing code; produces a regression test at the spec's named seam; runs the cleanup pass before reporting.
- **Feature/Enhancement** → fill with the `tdd` discipline block (see template). Sub-agent runs red-green-refactor with tracer bullets, one test → one impl, no horizontal slicing.

Provide:

- **Full task text** from the spec (don't make the sub-agent read files)
- **Scene-setting context**: where this fits in the overall implementation, what prior tasks produced, architectural constraints. If the sub-agent is landing in unfamiliar code, include a `zoom-out` shape map up front
- **The relevant spec sections** that inform this task (Technical Design, Edge Cases, Testing Strategy — Testing Strategy is especially load-bearing because it names the discipline's seam)
- **Codebase conventions** from AGENTS.md and best-practices.md — universal rules + index inline; situational rule text (e.g. BP-010 react, BP-011–BP-016 blocks/generators/resources) in `docs/contributing/best-practices/<category>.md`
- **The chosen discipline block** filled into the `[Discipline]` slot

**Model selection:**
- Mechanical tasks (isolated functions, clear specs, 1-2 files) → `sonnet`
- Integration tasks (multi-file coordination, pattern matching) → default model
- Architecture/design tasks (new abstractions, complex patterns) → `opus`
- Bugs with non-trivial reproduction → default model or `opus` (the diagnose loop benefits from careful reading; sonnet often skips Phase 1)

**Handle implementer status:**
- **DONE** → proceed to spec review
- **DONE_WITH_CONCERNS** → read concerns, address if about correctness, note if observational
- **NEEDS_CONTEXT** → provide missing context and re-dispatch
- **BLOCKED** → assess and either provide more context, use a more capable model, break the task smaller, or escalate to user

#### 5B.3: Spec Compliance Review (per task)

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
- **Prove the goal on the assembled work** (real model, real path — see `tdd` → "Two kinds of test"). The per-task specs are mocked and only prove the pieces; this step proves the whole achieves the outcome. Confirm PASS before moving to review and record the command and verdict.
  - **Feature/Enhancement:** run the goal check the spec names. If the spec documented that no goal check applies, skip and note the documented justification.
  - **Bug** (complex bugs route through 5B, not 5A): if the original symptom was user-visible, re-run the **original repro through the real path** (`fsdev run` against a real model) on the assembled fix and confirm it's gone — this is the bug's goal verdict Step 6 expects. For a pure type/unit regression, note "N/A — type/unit-only" with the regression test as the proof.

### Step 6: Comprehensive Review

This is the critical quality gate. Launch **three review sub-agents in parallel**:

#### Agent 1: Completeness Review (spec compliance)
Launch a `general-purpose` sub-agent to:
- Compare the full implementation against every section of the spec
- Check each acceptance criterion from the spec
- Verify edge cases from the spec's "Edge Cases" section are handled
- Confirm the testing strategy from the spec was followed
- **Confirm the goal was actually proven — when the spec names a goal check.** If the spec's Testing Strategy names a goal check, confirm it was run with a real model and passed (`tdd` → "Two kinds of test"); a green CI suite is not evidence. If it wasn't run, or only mocked specs exist, that is a completeness failure: flag it must-fix and run the goal check before presenting. **Honor a documented skip.** If the spec declares "no goal check applies" (docs-only, pure type/schema/internal refactor, config/build plumbing — per `issue-spec`'s "When a goal check doesn't apply"), confirm that justification still holds — i.e. no user-observable outcome was actually introduced — rather than demanding a check. For bug work, the real-path confirmation is the goal-level proof — Step 5A for simple bugs, Step 5B.4 for complex bugs that route through sub-agents; verify that verdict (wherever it was recorded) instead of a named goal check.
- Flag anything in the spec that wasn't implemented
- Flag anything implemented that wasn't in the spec

#### Agent 2: Simplification Review
Launch a `Plan` sub-agent to:
- Look for over-engineering: abstractions that aren't justified by the spec's scope
- Identify unnecessary indirection or complexity (shallow handlers per BP-013, wrapper sequencers per BP-036, BP-014 violations, etc.)
- Check if any code could be simplified without losing functionality
- Verify the implementation follows existing codebase patterns rather than inventing new ones
- Check for YAGNI violations — features or flexibility that wasn't requested
- **What could this change remove?** (BP-038) — a superseded path left beside the new one, an export/option/config key no caller needs, dead code the change orphaned. Subtraction is part of the change, not a follow-up.
- Surface **deepening opportunities** the implementation revealed — capability-shaped wiring that wasn't extracted, repeated `.step()` chains that could be a pattern, shallow modules. These do not block the PR; flag them as follow-ups to be handled later via `improve-codebase-architecture`
- **Key question**: "If I were reading this PR for the first time, what would I find unnecessarily complex?"

#### Agent 3: Quality and Impact Review
Launch a `superpowers:code-reviewer` sub-agent to:
- Review code quality: naming, structure, test coverage
- Check for bugs or logic errors
- **Run the second-path checklist (BP-035)** against the changed surface: legacy/persisted records, null/empty/boundary inputs and guard-clause order, concurrent/duplicate (409) calls, cancel/error paths, second-tenant key scoping, cost/observability of any new model call, and React derived-state/no-op-render. These are the highest-frequency review-defect classes; treat an unhandled path as must-fix unless explicitly out of scope.
- Verify adherence to project conventions (AGENTS.md, best-practices.md)
- Identify if changes affect other parts of the codebase
- Check documentation needs (architecture docs, READMEs, changeset)
- For changeset fragments specifically, follow the [Release notes workflow](../../../docs/contributing/release-notes-workflow.md) and BP-022: one user-facing sentence per affected package, no file paths, no test counts, no implementation rationale. Pre-1.0: `patch` or `minor` only, never `major`. If the spec is large, summarize at user-facing depth — don't transcribe the spec into the fragment. Internal-only PRs can use `pnpm changeset --empty`.

#### Process Review Results

**For each issue found, categorize:**
- **Must fix** — spec gaps, bugs, security issues → fix before presenting
- **Should fix** — over-engineering, unnecessary complexity → fix before presenting
- **Note for user** — observations, follow-up suggestions → include in summary

Fix all must-fix and should-fix items. Re-run affected tests after fixes.

### Step 7: Update Linear

First, **compile the Key Decisions & Ramifications (top 5)** — the most consequential decisions made *during implementation* (not the spec's): a shape the spec left open, a deviation, a tradeoff under a constraint the spec didn't anticipate. For each: the decision, the alternative rejected, and the ramification — what it locks in, what it rules out, what risk it carries. If implementation was purely mechanical with no real decisions, say so rather than padding to five. This list is reused verbatim in Step 8 (presentation) and Step 9 (PR body).

Then update the Linear issue:
- Add a comment summarizing: what was implemented, approach taken, test results, the **goal verdict** (the goal-check command and its PASS verdict; or, when the spec documented no goal check, the justification; or, for bugs, diagnose's real-path confirmation), any deviations from spec
- Include the **Key Decisions & Ramifications (top 5)** compiled above — the durable record lives on the issue so the decisions are reviewable async, not just in chat
- Keep state as "In Progress" until user approves

### Step 8: Present for Review

Present the completed work:

1. **Summary**: what was implemented (tied back to the spec)
2. **Key decisions & ramifications (top 5)**: the list compiled in Step 7 — each decision made *during implementation*, the alternative rejected, and the ramification (what it locks in, what it rules out, what risk it carries). This lets the user review the decisions, not just the code.
3. **Changes**: files modified/created with brief descriptions
4. **Goal verdict**: when the spec named a goal check, the check that was run (command/path), that it used a real model, and its PASS verdict with the evidence it checked — the proof the goal was met, distinct from the mocked test suite. When the spec documented that no goal check applies, state that and the one-line justification. For bugs, give diagnose's real-path confirmation instead.
5. **Deviations**: anything that differed from the spec and why
6. **Test results**: full typecheck and test output
7. **Review findings**: notable observations from the three reviewers
8. **Simplifications made**: what the simplification review caught and how it was addressed
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

1. Make the change. For non-trivial feedback, follow the same discipline the PR was built under (TDD for features → add the failing test first; diagnose for bugs → reproduce the regression first).
2. Run the affected package's typecheck and tests:
   `pnpm --filter <affected-package> typecheck && pnpm --filter <affected-package> test`
3. Commit with a message that names the feedback being addressed and references the issue:
   `fix: address PR review — {short summary} (FIX-N)`
4. Push to the PR branch: `git push`
5. Reply on the comment thread describing exactly what changed, with concrete file references (path:line). For inline review comments, post as a threaded reply so the conversation stays attached to the code:

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
- **Simplification is not optional.** The simplification review exists because agents tend to over-build. Take its findings seriously.
- **One shot for simple issues.** Don't spin up sub-agents for a 10-line bug fix. The complexity assessment in Step 4 exists to prevent ceremony overhead on simple work.
- **Keep Linear updated.** Every state change should be reflected. The whole point is traceability.
- **Acknowledge before you act.** On every PR re-invocation, react to every new comment with `eyes` *before* deciding what to do with any of them. Reviewers should never wonder whether the agent saw their comment.
- **Never leave a code-related comment unresponded to.** Every actionable comment gets a code change + reply; every non-actionable code comment gets a reply explaining why no change is being made. Only pure non-code conversation (acknowledgments, scheduling, off-topic) can be left at just the `eyes` reaction.
- **Replies describe outcomes, not reasoning.** Say what changed and where, or why nothing changed and which rule/spec backs that. No performative agreement.
