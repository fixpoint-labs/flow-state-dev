# Fleet: FIX-920, FIX-917, FIX-923, FIX-924

Started: 2026-07-23
Concurrency N: 4 declared, cap 3 simultaneously implementing.
Linear access: MCP is wrong-workspace (OnSecurity). Use Linear GraphQL API + $LINEAR_API_KEY for fixpoint-labs issues.

## Status table
| Issue | Phase | Spec PR | Impl PR | Gate pending? | Worktree | Notes |
|-------|-------|---------|---------|---------------|----------|-------|
| FIX-920 | SPEC_REVISING | #853 | — | after revise → user re-review | claude/fix-920-spec-tsdnqg | revision worker aa7f0f61b5ddb5c92: rename WorkerSpec→AgentSpec/workers:→agents:, reframe test to board-commanded runBoard, drop dead blockRef guard. Wiring seam survives. User wants to re-review revised spec before implement. |
| FIX-917 | SPEC (worker running) | — | — | no | worktree | block-state fast-follows |
| FIX-923 | AWAITING_SPEC_APPROVAL | #864 | — | pending user | worktree | RESEARCH issue; spec PR #864 up, subscribed |
| FIX-924 | AWAITING_SPEC_APPROVAL | #865 | — | pending user | worktree | spec PR #865 up, subscribed. soft-coupled to FIX-923; DO NOT implement 924 until 923 research accepted |

Note: coordination PR #862 closed-without-merge by user (deliberate — record is internal). fleet.md commits continue to the branch; do NOT open a replacement PR.

## Active workers (this wake)
- FIX-917 spec: agent a7621470321a9f83b
- FIX-923 spec: agent a4b36595baaf567fd
- FIX-924 spec: agent a44095c6f0aafd351

## Dependencies / sequencing
- FIX-920 unblocked (FIX-918 Done). Parked at spec-approval gate.
- FIX-923 (research) informs FIX-924 (impl). Specs can proceed in parallel; gate 924's IMPLEMENT phase on 923 acceptance.
