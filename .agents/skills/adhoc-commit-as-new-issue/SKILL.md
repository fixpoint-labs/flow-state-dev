---
name: adhoc-commit-as-new-issue
description: Create a Linear issue for work already done (or in progress), check out a fix/ branch, commit the changes, and open a PR. For quick logging and shipping of on-the-fly work.
argument-hint: "<brief description of what was done>"
---

You are a shipping agent. The user has already done (or is finishing) work and wants to retroactively log it, branch it, commit it, and open a PR — all in one shot. No implementation needed, just logistics.

## Core Principle

**Ship fast, log accurately.** The code changes already exist. Your job is to create the paper trail (Linear issue, branch, commit, PR) quickly and correctly. Do not modify any code. Do not ask unnecessary questions.

## Workflow

### Step 1: Understand What Was Done

Parse the user's description (or infer from staged/unstaged changes) to understand:
- What was changed and why
- Whether this is a bug fix, improvement, or feature
- Which packages were affected

If no description is provided, analyze the git diff to infer the description. If the changes are ambiguous, ask one focused clarifying question.

### Step 2: Check for Existing Linear Issues

Search Linear for duplicates before creating:

1. Use `list_issues` to search with keywords from the description.
2. If a likely duplicate exists, tell the user and ask whether to link to the existing issue or create a new one.
3. If an existing issue is found that this work resolves, use that issue's ID for the branch name and PR.

### Step 3: Create Linear Issue

Create the issue using `save_issue`:
- **Title**: concise, imperative mood (e.g., "Add makeSchemaStrict for OpenAI structured output compatibility")
- **Label**: "Bug", "Improvement", or "Feature" based on the work
- **Priority**: 3 (Normal) unless the user indicates otherwise
- **State**: "In Progress"
- **Team**: "Fixpoint Labs"
- **Project**: Infer from the affected packages (e.g., changes to `packages/engine` or `packages/core` → "flow-state.dev", changes to `packages/thought-fabric-core` → "Thought Fabric")
- **Description**: 2-3 sentences covering what and why. Keep it scannable.
- **Assignee**: "me"

Tell the user the issue ID was created.

### Step 4: Create Branch and Stage Changes

1. Determine current git state:
   - If already on a feature/fix branch with the right changes, skip branch creation
   - If on main or an unrelated branch with uncommitted changes:
     a. Stash changes
     b. Ensure main is up to date (`git checkout main && git pull`)
     c. Create branch: `fix/FIX-{number}-{slug}` (use the Linear issue number)
     d. Pop stash and resolve any conflicts (prefer stashed changes)

2. Stage relevant files. Be selective — don't stage unrelated files, `.env` files, or credential files. Use `git add <specific files>` not `git add -A`.

### Step 5: Commit

Create a commit with a descriptive message following the project's conventional commit format:

```
<type>(<scope>): <description>

<optional body explaining what and why>

Fixes FIX-{number}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Type mapping:
- Bug fix → `fix`
- New feature/capability → `feat`
- Improvement to existing → `feat` or `refactor`
- Tests only → `test`
- Docs only → `docs`

Scope: the primary affected package (e.g., `server`, `core`, `cli`, `thought-fabric`).

### Step 6: Push and Open PR

1. Push branch: `git push -u origin <branch>`
2. Create PR with `gh pr create`:
   - Title: concise (under 70 characters)
   - Body: follow [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → "The layout" like any other PR — the problem first, then what this does, then what's asked of you, with **nothing preceding the problem** (not `Fixes FIX-N`, not a summary heading). Most work on this route is small, so the visible half is often one paragraph and a links line with no *detail* worth collapsing; the budget is the small-change row in [`writing-for-humans.md`](../../../docs/contributing/writing-for-humans.md) → Budgets. **The reviewer contract is not detail and is never dropped** — a small change is exactly where a reviewer is most likely to assume the wrong route.
   - This route has **no spec and no gate upstream**, so paste a contract variant from `pr-reviewer-guidance.md` into a collapsed `<details>`, and put the test plan there too. **Pick it truthfully, and the default here is variant 4, no upstream contract.** This skill is logistics — it infers what and why from a diff that already exists, and changes no code — so on this route the issue is filed *after* the work, nothing upstream constrained it, and the whole change is in scope. Two variants are wrong by default:

     - **Brief-backed** would assert a one-screen agent brief. Step 3 writes a 2–3 sentence issue description, which is not one.
     - **The direct-route (bug) variant** asks reviewers to check a repro → cause → fix → regression-test chain. Label alone doesn't create that chain: this skill runs no reproduction and no root-cause analysis. Use it **only when the diagnosis actually exists and is visible** — the work came from a `diagnose` run, and the repro and its regression test are in the diff. If you're inferring "this looks like a bug fix" from the changes, the diagnosis is not there and variant 4 is the honest contract.
   - The links line carries `Fixes FIX-{number}`.

### Step 7: Update Linear

Update the Linear issue:
- **State**: "Done"
- **Link**: attach the PR URL

### Step 8: Report

Tell the user:
- Linear issue ID and URL
- PR URL
- Branch name

## Guidelines

- **No code changes.** You are shipping existing work, not implementing anything.
- **Be selective with staging.** Only stage files related to the described work. If there are unrelated changes in the working tree, leave them unstaged.
- **Infer intelligently.** If the user just says "ship it" or gives a vague description, analyze the diff to write a good commit message and issue description.
- **One shot.** This entire workflow should complete in a single pass. Don't ask for confirmation at each step — just do it and report the results at the end.
- **Handle existing branches.** If the user is already on a correctly named branch, don't create a new one. If changes are already committed, just push and open the PR.
