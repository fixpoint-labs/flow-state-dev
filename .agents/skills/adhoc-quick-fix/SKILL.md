---
name: adhoc-quick-fix
description: Log a Linear issue for ad-hoc work and ship it. Two entries — fix it now, or the work is already done — then branch, commit, and open a PR. Handles duplicate detection, ticket creation, optional implementation, and Linear status.
argument-hint: "<description of the issue, or of the work already done>"
---

# Adhoc

One pipeline: Linear issue → (optional fix) → branch → commit → PR. Two entries,
picked from the ask.

## Which entry

| The user… | Entry | You implement? | You wait before commit? |
|---|---|---|---|
| Saw something broken / wants it fixed now | **A — Fix it now** | Yes | Yes — present, then ship |
| Already did the work (or is finishing it) and wants it logged and shipped | **B — Work already done** | No. Do not modify code. | No — ship in one pass |

If the description is ambiguous between A and B, look at the working tree. Dirty
or staged changes that match the description → B. Nothing to commit → A.

## Core principle

**Act autonomously on logistics. Gate Entry A on commit.** Do not ask for
approval to start coding, choose an approach, or create the Linear ticket.
Entry A pauses only when presenting the completed fix. Entry B does not pause.
The one exception: if the issue is ambiguous and you cannot pick a fix (A) or
infer the description (B), ask all clarifying questions at once.

## Shared — Steps 1 to 3

### Step 1: Understand

Parse the ask (or, on B with no description, the git diff):

- What is broken, suboptimal, or already changed, and why
- Where it lives / which packages
- **Bug**, **improvement**, or **feature**
- Severity (A) — blocking vs polish

### Step 2: Check for existing issues

Search Linear before creating (CLAUDE.md → "Linear access"):

1. `list_issues` with keywords from the description, then broader terms
   (component, feature area).
2. If a likely duplicate exists, show it (ID, title, status, summary) and ask
   whether to update/link that issue or create a new one. Wait.
3. On B, if an existing issue is what this work resolves, use **that** ID for
   the branch and PR.

### Step 3: Create the Linear issue

`save_issue`:

- **Title**: concise, imperative ("Fix SSE reconnection dropping items")
- **Label**: Bug / Improvement / Feature from Step 1
- **Priority**: A — from severity (1=Urgent … 4=Low). B — 3 unless the user said otherwise
- **State**: In Progress
- **Team / project / assignee**: infer when you can (B defaults team "Fixpoint Labs",
  assignee "me"; engine/core → "flow-state.dev")
- **Description**:
  - **A** — the **agent-brief template** at `docs/contributing/agent-brief-template.md`
    (What we're solving → Current → Desired → Key surfaces → Acceptance criteria →
    Out of scope → Context). Short; this is not a feature spec.
  - **B** — 2–3 sentences covering what and why. Not a brief.

Tell the user the issue identifier. On A, say you are starting work.

## Entry A — Fix it now

### Step 4: Investigate and fix

1. Read the relevant code. Read `CLAUDE.md` orientation if you need architecture.
2. Identify the root cause, not just the symptom.
3. Minimal, focused changes. Do not refactor neighbors.
4. Typecheck and test the affected packages:
   ```bash
   pnpm --filter <affected-package> typecheck
   pnpm --filter <affected-package> test
   ```
5. If tests fail, fix them. If existing tests don't cover the fix, add targeted coverage.
6. **Confirm against the real path** when the behaviour is user-visible and there
   is a runnable real path — `fsdev run` on a real model. Mocked specs passing
   do not prove the symptom is gone. Pure type/unit fixes skip this.
   (`tdd` → "Two kinds of test".)

Do not ask for approach approval.

### Step 5: Quality review (sub-agents, in parallel)

1. **Code quality** — `feature-dev:code-reviewer`: bugs, security, conventions
   (`AGENTS.md`, `docs/contributing/best-practices.md` + the relevant category
   file), coverage.
2. **Alternative approaches** — `Plan`: simpler/more robust? root cause vs
   symptom? broader refactor (note it, don't block).
3. **Impact** — `Explore`: other sites with the same problem; related Linear issues.
4. **Docs & changelog** — `general-purpose`: architecture docs, `apps/docs`,
   package READMEs, AGENTS/BPs. Changeset only if a published-package consumer
   can observe the fix (BP-022). Return a concrete file list.

Address critical findings before presenting. Non-critical notes go in the summary.

### Step 6: Update Linear

Comment: root cause, files changed, test results, **real-path verdict**
(`fsdev run` command + result, or "N/A — type/unit-only"). Keep state
In Progress until the user approves.

### Step 7: Present for review

1. What was wrong and what you did
2. Files changed
3. Test results
4. Real-path verdict
5. Sub-agent findings
6. Related issues

They may **approve** (→ Ship), **request changes** (fix, re-test, present again),
or **reject** (revert, Linear → Cancelled or Backlog).

Then **Ship**.

## Entry B — Work already done

Skip Steps 4–7. Do not modify any code. Infer the commit message and the issue
description from the diff if the user said "ship it". Then **Ship**.

## Ship (both entries)

### Branch and stage

1. Current git state:
   - Already on a feature/fix branch with the right changes → skip creation
   - On main or an unrelated branch with uncommitted changes: stash, update
     main, create `fix/FIX-{number}-{slug}`, pop stash (prefer stashed changes
     on conflict)
2. Stage **relevant** files only. No `.env`, no credentials, no `git add -A`.
   On B, leave unrelated dirty files unstaged.

### Commit

```
<type>(<scope>): <description>

<optional body explaining what and why>

Fixes FIX-{number}
```

Type: bug → `fix`; new capability → `feat`; improvement → `feat` or `refactor`;
tests → `test`; docs → `docs`. Scope: the primary package (`engine`, `core`, …).

### Push and open the PR

1. `git push -u origin <branch>`
2. Open the PR. Title under 70 characters. Body follows
   [`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md)
   → "The layout" — problem first, then what this does, then what's asked.
   Language: ASD-STE100. Most of this route is small: one paragraph and a links
   line. **The reviewer contract is never dropped.**
   - **A (bug with a visible diagnose chain)** — the direct-route (bug) variant,
     only when the repro and regression test are in the diff.
   - **A (otherwise) or B** — variant 4, **no upstream contract**. This route
     files the issue *after* or *as* the work. Do not paste the brief-backed
     variant: Step 3's brief (A) is not a one-screen agent brief that constrained
     the work, and B writes 2–3 sentences.
   - Links line: `Fixes FIX-{number}`.

### Close Linear

State: Done. Attach the PR URL. On A, the final comment includes the commit hash.

### Report

Linear issue ID and URL, PR URL, branch name. On A, include the review summary
the user already saw.

## Guidelines

- **Minimal changes** (A). Fix the issue. Don't improve neighbors.
- **No code changes** (B). Logistics only.
- **Speed over ceremony.** One ask, not five. Don't drip-feed questions.
- **Keep Linear updated.** Every state change is reflected.
- **One shot on B.** Don't ask for confirmation at each step.
- **Handle existing branches.** If the user is already on the right branch, or
  changes are already committed, push and open the PR.
