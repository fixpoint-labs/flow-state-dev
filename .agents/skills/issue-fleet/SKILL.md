---
name: fsd:issue-fleet
description: Coordinate MULTIPLE Linear issues through their full lifecycle in parallel within one session — each issue on its own branch in its own git worktree so parallel commits never collide. A thin, event-driven fleet coordinator that composes fsd:issue-lifecycle per issue via worktree-isolated sub-agents, holds only a compact per-issue status table (never the workers' transcripts), surfaces each issue's spec-approval gate as it arrives while the others keep moving, and stops each before merge. Sizes concurrency to the session VM.
argument-hint: "<issue IDs, e.g. FIX-1 FIX-2 FIX-3 — or a selection to confirm>"
---

# Issue Fleet

Run several issues at once — each getting the full `fsd:issue-lifecycle` (spec →
approval → implement → PR feedback) — from a single session, without their branches
colliding and without the coordinator's token count exploding.

## How it stays safe and cheap

- **One worktree per issue.** Each issue's work runs in a worker sub-agent declared
  `isolation: worktree`, so it lives on its own branch in its own git worktree.
  Parallel commits/pushes never collide — the whole reason worktrees exist here.
- **Thin coordinator, isolated workers.** The fleet holds only a compact **status
  table** — one row per issue: `issue · phase · spec PR# · impl PR# · gate-pending?
  · worktree`. It never holds a worker's context. Each worker advances its issue by
  **one bounded step** (via `fsd:issue-lifecycle`) in its own context and returns
  **≤ a couple of lines** of status, then exits. Token cost at the fleet level is a
  small table across wakes, regardless of how much work the issues involve.
- **Event-driven, like the single-issue loop.** The fleet is the event loop. It ends
  its turn while issues are idle and re-enters on PR events or a scheduled check-in;
  on re-entry it refreshes each row from Linear + PR state (cheap fetches) and acts
  only where there's a pending action.

## Sizing to the VM (read this before picking N)

A Cloud session is **4 vCPU / 16 GB RAM / 30 GB disk**, and **each worktree is a full
checkout**. Full lifecycles also run installs/builds/tests. So keep concurrency
modest — **~3–4 active issues** is a sane default; go higher only for light issues.
If disk or memory gets tight, cap the number of *simultaneously implementing* issues
even if more are queued. State the chosen N and the cap to the user.

## The loop (each invocation)

1. **Resolve the set.** Take the issue IDs from the argument, or propose a set (you
   may compose `fsd:plan-dispatch` / `fsd:linear-triage` for selection) and confirm
   with the user. Record the set + chosen N in `.agents/orchestration/fleet.md`
   (compact: the issue list and per-issue handle-cache pointers).
2. **Refresh the table.** For each issue, cheaply fetch its Linear state + PR
   status to derive its phase (reuse each issue's `.agents/orchestration/<ISSUE>.md`
   handle cache). Do **not** re-dispatch workers just to read state.
3. **Advance where there's a pending action.** For each issue that has a next bounded
   action (needs spec, has unhandled PR events, spec just approved, …) and is within
   the concurrency cap, dispatch an **`issue-worker`** — the custom agent at
   `.claude/agents/issue-worker.md`, which declares `isolation: worktree` (its own
   worktree/branch) and has no `AskUserQuestion` (it never prompts; it returns
   blockers for the fleet to surface):

   ```
   Agent tool (agentType: issue-worker):
     description: "Advance <ISSUE>"
     prompt: Advance <ISSUE> by its one next bounded step (its current phase), in your
             worktree. Return the compact status line. One step, then exit.
   ```

   Dispatch independent issues' workers **in parallel** (one message, multiple calls),
   up to the cap. (Where the harness lacks custom agents, fall back to the Agent tool
   with `isolation: worktree` and the same prompt.)
4. **Collect compact status** and update the table. Never fold a worker's full output
   in — one status line per issue.
5. **Surface gates.** For any issue now **awaiting spec approval**, surface its Part I
   summary to the user and note it's blocked on their sign-off; the *other* issues
   keep moving. For any issue **ready to merge**, surface it and stop there (merge is
   the user's).
6. **End the turn.** Subscribe to all live impl PRs; schedule one fleet check-in
   (`send_later`, ~30–60 min) as the heartbeat and re-arm while any issue is live.
   Re-enter on PR events or the check-in. Stop the fleet once every issue is merged,
   closed, or dropped.

## Gates & autonomy

- **Spec-approval gate is per issue.** Each issue independently waits for the user's
  sign-off before implementing; approvals are independent, so issue B isn't blocked
  by issue A's pending spec.
- **Stop before merge**, per issue. The fleet never merges.
- A worker that reports a **blocker** (dependency not landed, ambiguous spec review,
  a challenger-surfaced spec blind spot) surfaces to the user for that issue; the
  rest continue.

## Token & depth discipline

- The fleet's context is the status table + the fleet record. Nothing else persists
  across wakes. Workers are the token sink, and they're isolated and discarded.
- Depth stays within Claude Code's 5-level cap: fleet (main) → worktree worker
  running issue-lifecycle (1) → the phase skill it dispatches, e.g. implement-issue
  (2) → that skill's implementer / `fsd:review` sub-agents (3) → review lenses (4).
  Comfortable. If you ever approach the cap, have the worker run the phase skill
  in-context rather than dispatching a further sub-agent.
- Never read specs/diffs at the fleet level. Handles and status only.

## Boundaries

- Parallel *coordination* of independent issues. Issues with hard dependencies on
  each other should be sequenced (run the blocker to merge-ready first, or use
  `fsd:issue-lifecycle` one at a time) rather than run concurrently.
- Composes `fsd:issue-lifecycle` (one lifecycle definition, reused per issue). It does
  not reimplement the lifecycle.
