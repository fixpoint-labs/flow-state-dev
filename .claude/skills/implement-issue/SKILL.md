---
name: fsd:implement-issue
description: Use when implementing a Linear issue that has a spec document attached. Fetches the issue and spec, creates a fix branch, dispatches sub-agents for complex work, and runs a comprehensive review before presenting results.
argument-hint: "<Linear issue ID, e.g. FIX-123>"
---

You are an implementation agent. Given a Linear issue ID, your job is to pull the issue and its spec, set up a branch, implement the work (dispatching sub-agents for anything non-trivial), and run a thorough review before presenting the result.

## Core Principle

**The spec is the source of truth, not the issue description.** The issue description says *what* and *why*. The attached Linear document (the spec) says *how*. Always read both, but when they conflict on implementation details, the spec wins. If no spec exists, treat this as a simple issue and implement directly — but flag that a spec was missing.

## Workflow

### Step 1: Pull the Linear Issue

Fetch everything about the issue:

1. `get_issue` with `includeRelations: true` — get the full issue: description, labels, priority, relations
2. `list_comments` — read any discussion or decisions
3. **Fetch attached documents** — use `get_document` for each attached document. The spec is typically the document titled `{ISSUE-ID}: ... — Implementation Spec`
4. If the issue has sub-tasks, fetch those too — they may represent the intended PR breakdown

If $ARGUMENTS doesn't look like a Linear issue ID, search with `list_issues` using it as a query.

**After reading, capture these details (you'll need them for sub-agents):**
- Issue ID, title, and description
- Full spec content (every section)
- Blocking/blocked-by relations and their status
- Any decisions from comments
- Labels and priority

### Step 2: Validate Readiness

Before starting work, check:

1. **Spec exists?** If no spec document is attached:
   - For issues labeled "Bug" with a clear description → proceed without spec (simple fix)
   - For everything else → tell the user: "This issue has no spec attached. Should I proceed based on the description alone, or create a spec first with `/create-spec {ID}`?"

2. **Dependencies resolved?** Check blocking issues:
   - If blockers are still "In Progress" or "Todo" → tell the user what's blocking and stop
   - If blockers are "Done" but code isn't on main → check if there's a merged PR. If not, flag it

3. **Open questions?** If the spec has an "Open Questions" section with unresolved items → present them to the user and wait for answers before proceeding

If all clear, move to Step 3.

### Step 3: Set Up Branch

1. Ensure main is up to date: `git checkout main && git pull`
2. Create the branch: `fix/{ISSUE-ID}` (e.g., `fix/FIX-123`) — lowercase the ID
3. Update the Linear issue state to "In Progress" using `save_issue`

### Step 4: Assess Complexity

Read the spec's "Implementation Sequence" section (or equivalent) to determine scope:

**Simple** (implement directly — no sub-agents):
- Single file change or tightly coupled changes in 2-3 files
- No architectural decisions to make
- Clear, unambiguous spec with < 3 implementation steps
- Bug fixes with obvious root cause

**Complex** (dispatch sub-agents):
- 3+ implementation steps in the spec
- Multiple packages or subsystems touched
- New APIs, types, or abstractions to create
- Integration work across package boundaries

If simple → go to Step 5A.
If complex → go to Step 5B.

### Step 5A: Simple Implementation

Implement directly following the spec:

1. Read relevant code to understand the area
2. Implement the changes as specified
3. Write or update tests
4. Run typechecks and tests:
   ```bash
   pnpm --filter <affected-package> typecheck
   pnpm --filter <affected-package> test
   ```
5. Commit the work with a conventional commit message referencing the issue ID
6. Skip to Step 6 (Review)

### Step 5B: Complex Implementation (Sub-agent Team)

#### 5B.1: Extract Tasks from Spec

Parse the spec's "Implementation Sequence" into discrete, ordered tasks. For each task, note:
- What to build (exact files, functions, types)
- What it depends on (which prior tasks must complete first)
- How to test it (acceptance criteria from spec)
- What NOT to build (scope boundaries)

Create a TodoWrite with all tasks.

#### 5B.2: Dispatch Implementer Sub-agents

For each task, sequentially dispatch an implementer sub-agent using the template in `./implementer-prompt.md`. Provide:

- **Full task text** from the spec (don't make the sub-agent read files)
- **Scene-setting context**: where this fits in the overall implementation, what prior tasks produced, architectural constraints
- **The relevant spec sections** that inform this task (Technical Design, Edge Cases, Testing Strategy)
- **Codebase conventions** from AGENTS.md and best-practices.md

**Model selection:**
- Mechanical tasks (isolated functions, clear specs, 1-2 files) → `sonnet`
- Integration tasks (multi-file coordination, pattern matching) → default model
- Architecture/design tasks (new abstractions, complex patterns) → `opus`

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

### Step 6: Comprehensive Review

This is the critical quality gate. Launch **three review sub-agents in parallel**:

#### Agent 1: Completeness Review (spec compliance)
Launch a `general-purpose` sub-agent to:
- Compare the full implementation against every section of the spec
- Check each acceptance criterion from the spec
- Verify edge cases from the spec's "Edge Cases" section are handled
- Confirm the testing strategy from the spec was followed
- Flag anything in the spec that wasn't implemented
- Flag anything implemented that wasn't in the spec

#### Agent 2: Simplification Review
Launch a `Plan` sub-agent to:
- Look for over-engineering: abstractions that aren't justified by the spec's scope
- Identify unnecessary indirection or complexity
- Check if any code could be simplified without losing functionality
- Verify the implementation follows existing codebase patterns rather than inventing new ones
- Check for YAGNI violations — features or flexibility that wasn't requested
- **Key question**: "If I were reading this PR for the first time, what would I find unnecessarily complex?"

#### Agent 3: Quality and Impact Review
Launch a `superpowers:code-reviewer` sub-agent to:
- Review code quality: naming, structure, test coverage
- Check for bugs or logic errors
- Verify adherence to project conventions (AGENTS.md, best-practices.md)
- Identify if changes affect other parts of the codebase
- Check documentation needs (architecture docs, READMEs, changelog)

#### Process Review Results

**For each issue found, categorize:**
- **Must fix** — spec gaps, bugs, security issues → fix before presenting
- **Should fix** — over-engineering, unnecessary complexity → fix before presenting
- **Note for user** — observations, follow-up suggestions → include in summary

Fix all must-fix and should-fix items. Re-run affected tests after fixes.

### Step 7: Update Linear

Update the Linear issue:
- Add a comment summarizing: what was implemented, approach taken, test results, any deviations from spec
- Keep state as "In Progress" until user approves

### Step 8: Present for Review

Present the completed work:

1. **Summary**: what was implemented (tied back to the spec)
2. **Changes**: files modified/created with brief descriptions
3. **Deviations**: anything that differed from the spec and why
4. **Test results**: full typecheck and test output
5. **Review findings**: notable observations from the three reviewers
6. **Simplifications made**: what the simplification review caught and how it was addressed
7. **Follow-ups**: any items for future work (not in scope but worth noting)

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
   - Body: summary, changes, test plan, `Fixes FIX-{number}`
4. Update Linear issue:
   - State: "Done"
   - Attach PR URL
   - Final comment with PR link

## Guidelines

- **Spec drives everything.** Don't improvise beyond the spec. If the spec is wrong, flag it — don't silently deviate.
- **Sub-agents get full context.** Never make a sub-agent read files to understand their task. Paste the relevant spec sections directly into the prompt.
- **Sequential implementation, parallel review.** Tasks execute in order (they often depend on prior tasks). Reviews run in parallel (they're independent).
- **Fix before presenting.** The user should see clean work, not a list of known issues. Fix everything the reviewers flag before Step 8.
- **Simplification is not optional.** The simplification review exists because agents tend to over-build. Take its findings seriously.
- **One shot for simple issues.** Don't spin up sub-agents for a 10-line bug fix. The complexity assessment in Step 4 exists to prevent ceremony overhead on simple work.
- **Keep Linear updated.** Every state change should be reflected. The whole point is traceability.
