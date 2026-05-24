---
name: fsd:plan-dispatch
description: Use when the user wants to figure out which Linear issues to dispatch right now — picks spec-ready and implement-ready issues respecting open-PR capacity, overlap, and priority. Trigger phrases include "what should we dispatch", "plan the next batch", "what's ready to go", "kick off some work", "pick today's dispatches". User-provided focus arguments (e.g. "focus on streaming") override priority order.
argument-hint: "[optional focus area or guidance, e.g. 'streaming work' or 'urgent bugs only']"
---

You are the planner that feeds `fsd:dispatch-remote`. Look at Linear and GitHub, decide which issues should be dispatched (for spec authoring or implementation), which should be closed, which need priority changes, and present that plan for user approval before dispatching anything.

## Core Principles

**User focus is the top rank.** If $ARGUMENTS contains focus guidance, it sits above every other heuristic — issue priority, project priority, age, theme. Surface matching issues first; when a higher-priority issue is skipped because it doesn't match the focus, say so out loud in the plan.

**Capacity is a hard cap.** No more than 8 open PRs on https://github.com/fixpoint-labs/flow-state-dev at a time. If 7 are open, dispatch at most 1 `implement-issue`. Spec dispatches don't open PRs and aren't bound by that gate — but a too-deep spec queue is its own form of debt, so default to no more than 3 spec dispatches per cycle unless the user overrides.

**Overlap kills throughput.** Two parallel issues touching the same files mean one PR rebases the other from scratch. Before recommending any dispatch, scan open PRs and "In Development" Linear issues; if a candidate touches the same area, defer it ("waiting on PR-NNN").

**Themes trigger clarification, not auto-decisions.** When 4+ candidates touch the same area, that's a signal to ask — maybe they should be consolidated, sequenced behind a parent, or rescoped. Don't dispatch parallel theme work without asking.

**`fsd:linear-triage` is the prep step when the queue is messy.** If Linear has many "No priority" issues, suspected duplicates, large theme groups with unclear ownership, or many stale Todos, propose running triage first. Cleaning once is cheaper than dispatching the wrong issue.

**You don't dispatch directly.** Produce a plan, get approval, then call `fsd:dispatch-remote` with the approved IDs. Apply close/priority changes via Linear MCP after approval. Never auto-dispatch.

## Workflow

### Step 1: Capture focus

Parse $ARGUMENTS for explicit focus or exclusion guidance and record it in one sentence. Examples:

- `"focus on streaming"` → bias selection toward streaming-area issues
- `"urgent bugs only"` → only Bug-labeled issues with priority Urgent
- `"ignore auth — it's blocked on legal"` → exclude auth-area issues
- no argument → no bias; pure priority order

You'll cite this sentence in the final plan so the user can audit it.

### Step 2: Snapshot capacity (parallel)

Run these in parallel:

1. `gh pr list --repo fixpoint-labs/flow-state-dev --state open --json number,title,headRefName,labels,createdAt,updatedAt,author` — open PRs
2. Linear `list_issues` filtered by state in (`In Development`, `In Review`) — implementation already in flight
3. Linear `list_issues` filtered by state in (`In Spec Dev`, `In Spec Review`) — specs in flight

Compute:

- `open_pr_count = len(open_prs)`
- `implement_capacity = max(0, 8 - open_pr_count)`
- `spec_capacity = max(0, 3 - count(specs_in_flight))` (soft cap; override only on explicit user request)

If both capacities are 0, stop and report: *"Both queues full — N open PRs, M specs in flight. Nothing to dispatch. Want me to suggest closes / re-priorities anyway?"*

### Step 3: Pull dispatch candidates (parallel)

In parallel, pull:

1. **Implement candidates** — `list_issues` filtered by your team's post-spec-review state (e.g. `Spec Approved` or whatever follows `In Spec Review`). For each, confirm a spec document is attached via `get_issue` / `get_document`. If no spec attached despite the post-review state, flag it as a state inconsistency and skip.
2. **Spec candidates** — `list_issues` filtered by state in (`Todo`, `Backlog`). Exclude any that already have an attached spec doc — those represent a state-tracking gap, not a fresh spec opportunity; surface them as "needs state correction".

For each candidate, capture: ID, title, state, issue priority, project + project priority, labels, age (days since created), assignee, blocking/blocked-by relations.

### Step 4: Detect overlap

For each candidate, infer the area it touches — from labels, title, project, and (for implement candidates) the spec's Architecture / file list. Cross-reference:

- **Open PRs** — read titles + labels; for high-confidence matches, run `gh pr view <num> --json files` to confirm file overlap
- **`In Development` / `In Review` Linear issues** — same area inference

Mark each candidate:

- `clean` — no overlap, safe to dispatch
- `overlap-soft` — same area but different files; flag in plan, dispatch allowed
- `overlap-hard` — same files or same load-bearing subsystem with active PR; defer with `"waiting on PR-NNN"` and exclude from the dispatch slots

### Step 5: Detect themes

Group candidates by area (label / project / file inference). If any group has 4+ entries, that's a theme. For each theme, write a one-sentence question for the user:

- *"Five candidates touch streaming (FIX-201, FIX-203, FIX-205, FIX-207, FIX-209). Ship in parallel, or sequence behind FIX-201?"*
- *"Four 'No priority' issues touch devtool polish. Triage these (`fsd:linear-triage`) before dispatching anything from this group?"*

Themes don't block the plan — they trigger clarification before final pick.

### Step 6: Triage gate

Decide whether to recommend `fsd:linear-triage` *before* dispatching. Recommend it when any of:

- More than 10 issues sit at "No priority" in Backlog / Todo
- 3+ candidates appear to be duplicates of one another or of existing issues
- A theme group has internal ambiguity (overlapping scopes, unclear ownership)
- Many stale Todo / Backlog issues with last activity > 60 days

If yes, surface as the first proposal in the plan: *"Suggest running `fsd:linear-triage` first because <reasons>. Want me to do that and re-plan after?"* The user decides; you don't run triage on your own.

### Step 7: Rank and pick

Sort candidates by this composite key:

1. Match to user focus from Step 1 (matches first)
2. Project priority (Urgent → No priority)
3. Issue priority (Urgent → No priority)
4. Age within priority bucket (older first, so things don't rot)
5. Overlap status (`clean` before `overlap-soft`; `overlap-hard` excluded)

Pick:

- Top `implement_capacity` candidates from the implement list
- Top `spec_capacity` candidates from the spec list

If user focus narrows the pool below capacity, **pick fewer — don't fill slots with off-theme work**. Note the unused capacity in the plan so the user can override.

### Step 8: Surface closes and re-prioritizations

While the data is in hand, also flag:

- **Close candidates** — issues with: low/no priority + stale (>90d) + no assignee + no recent comment activity; OR issues that a prior `fsd:create-spec` Necessity check verdict marked "Don't build" but didn't get closed; OR issues that match a `docs/internal/out-of-scope/` rejection. Cap at ~5 per plan; anything bigger goes through `fsd:linear-triage`.
- **Re-prioritize candidates** — issues that: block active work but have a lower priority than what they block; sit at "Urgent" with no recent activity (priority inflation); sit at "No priority" but match the user's stated focus.

These are the *obvious* ones from current data. Deep cleanup is `fsd:linear-triage`'s job, not this skill's.

### Step 9: Present the plan

Output one structured plan. Keep it scannable.

```
## Dispatch plan

Focus: <one-sentence summary, or "no explicit focus">
Capacity: <implement_capacity> implement slots, <spec_capacity> spec slots
Open PRs: <count> / 8

### Triage prep
[fsd:linear-triage proposal with reasons, or "skip — queue looks clean"]

### Themes to clarify
- <theme one-liner with question>

### Proposed dispatches

Implement (<N>):
  - {ID} — {title} — priority {P}, project {proj} — <one-line reason>

Create-spec (<N>):
  - {ID} — {title} — priority {P}, project {proj} — <one-line reason>

Deferred (overlap):
  - {ID} — waiting on PR-{NNN} ({pr title})

### Issues to close
  - {ID} — <reason>

### Issues to re-prioritize
  - {ID} — {current} → {proposed} — <reason>
```

Then ask: *"Proceed? Reply `go` to dispatch + apply close/priority changes, `edit <details>` to adjust, or `triage first` to run `fsd:linear-triage` instead."*

### Step 10: On approval, execute

When the user replies `go`:

1. For each implement and create-spec dispatch, invoke `fsd:dispatch-remote` with the ID. Dispatch sequentially; capture each remote task URL/ID.
2. For each close: `save_issue` setting state to your team's closed state (e.g. `Cancelled`) and add a one-line comment with the reason.
3. For each re-priority: `save_issue` setting `priority` to the new value and add a one-line comment.
4. Report: dispatched IDs with task URLs, closed IDs, re-prioritized IDs.

If the user replies `triage first`, invoke `fsd:linear-triage` and stop. They'll re-invoke this skill afterwards with a cleaner queue.

If the user replies `edit <details>`, apply their edits and re-present the plan once. After that single edit cycle, ask for `go` or `cancel` — don't loop indefinitely.

## Guidelines

- **One plan, one approval.** Don't dispatch issue-by-issue with separate confirmations. Present the whole plan, get one yes / no / edit.
- **Capacity math is hard math.** If `implement_capacity` is 0, do not dispatch implements even if the user says `go` — tell them why and offer spec dispatches instead.
- **Cite Linear and GitHub data.** Every priority claim and overlap call must trace to a Linear field or a PR you actually read. Never invent priority. Never claim overlap without naming the conflicting PR or issue.
- **Themes go to the user.** When a theme triggers, ask — don't pre-decide whether to consolidate, sequence, or split. The user owns scope.
- **Don't repeat dispatch-remote's job.** This skill picks issues; `fsd:dispatch-remote` classifies state, builds prompts, and calls the remote CLI. Don't inline state classification here.
- **Don't repeat linear-triage's job.** This skill *recommends* triage when the queue is messy. It does not deep-clean priorities, propose new issues, or sequence batches — that's `fsd:linear-triage`.
- **User focus dominates.** A higher-priority issue that doesn't match the focus loses to a lower-priority issue that does. Say so out loud so the trade is auditable.
- **Linear MCP runs locally.** This skill needs Linear access on the local Claude side (`get_issue`, `list_issues`, etc.). The cloud agents `fsd:dispatch-remote` dispatches use their own Linear access via `LINEAR_API_KEY`.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Filling all implement slots regardless of overlap | Apply the overlap filter *before* ranking; defer overlapping candidates explicitly |
| Recommending dispatches that don't match the user's stated focus | Focus dominates ranking; under-fill capacity rather than dilute focus |
| Auto-running `fsd:linear-triage` instead of proposing it | Triage is a separate, user-approved step; propose, don't act |
| Closing stale issues without surfacing reason | Every close needs a one-line reason in both the plan and the Linear comment |
| Conflating issue priority with project priority | They're independent — project priority is the outer ranking, issue priority is the inner |
| Picking spec candidates that already have a spec attached | Spec candidates must have NO attached spec doc; double-check via `get_document` |
| Treating `In Spec Review` issues as ready to implement | They're under human review — only the post-review approved state qualifies for implementation dispatch |
| Inventing file overlap from titles alone | Run `gh pr view <num> --json files` before claiming hard overlap |
| Looping "edit" cycles forever | One edit cycle, then `go` or `cancel` — don't keep replanning |
