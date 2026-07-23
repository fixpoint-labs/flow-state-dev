# Fleet: FIX-920, FIX-917, FIX-923, FIX-924

Started: 2026-07-23
Concurrency N: 4 declared, cap 3 simultaneously implementing.
Linear access: MCP is wrong-workspace (OnSecurity). Use Linear GraphQL API + $LINEAR_API_KEY for fixpoint-labs issues.

## Status table
| Issue | Phase | Spec PR | Impl PR | Gate pending? | Worktree | Notes |
|-------|-------|---------|---------|---------------|----------|-------|
| FIX-920 | AWAITING_SPEC_APPROVAL (revised) | #853 | — | user re-review | claude/fix-920-spec-tsdnqg | Spec revised to merged FIX-918 (agents:/runBoard, board-commanded, blockRef dropped, refs fixed). Q2a/Q3 still OPEN. Ready for user sign-off. |
| FIX-917 | AWAITING_SPEC_APPROVAL | #866 | — | pending user | worktree | spec PR #866 up, subscribed. Decision 2 (hard rename vs BP-030 dual-read) needs sign-off; contingent on zero external consumers of the 4 legacy keys |
| FIX-923 | RE-SPECING (co-spec w/ 901) | #864 | — | after respec → user | spec/FIX-923 | Co-spec host model with blocking-vs-background drain as first-class axis, forward-compatible w/ FIX-901. Reference 901 as mechanism (don't spec its hard parts). Research Claude Code + Codex harness background-task models for inspiration. Establish 923↔901 relation. |
| FIX-924 | AWAITING_SPEC_APPROVAL | #865 | — | pending user | worktree | spec PR #865 up, subscribed. soft-coupled to FIX-923; DO NOT implement 924 until 923 research accepted |

Note: coordination PR #862 closed-without-merge by user (deliberate — record is internal). fleet.md commits continue to the branch; do NOT open a replacement PR.

## Active workers (this wake)
- FIX-917 spec: agent a7621470321a9f83b
- FIX-923 spec: agent a4b36595baaf567fd
- FIX-924 spec: agent a44095c6f0aafd351

## Dependencies / sequencing
- FIX-920 unblocked (FIX-918 Done). Parked at spec-approval gate.
- FIX-923 (research) informs FIX-924 (impl). Specs can proceed in parallel; gate 924's IMPLEMENT phase on 923 acceptance.
