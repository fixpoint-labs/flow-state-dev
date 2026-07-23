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

## Active workers
- FIX-923 co-spec (w/ 901 + harness research): agent a6f3374cd04c10a01 (restarted after /grill-me interrupt killed prior ae4c4c238de6d74ea)
- (prior specs done: 917→#866, 923→#864, 924→#865; 920 revision→#853)

## Active workers (cont.)
- FIX-917 review-response: agent a7c5fac94b420145e — verify Codex P1 (does FIX-914 block-state API exist on main?), fix/refute, set changeset minor (P2), reply threads.

## PR notes
- #866 (FIX-917 spec) taken out of draft by user 2026-07-23 — review signal only; spec PRs are not merged.
- #866 CRUX: Codex P1 + Cursor pt7/line170 BOTH claim FIX-914 block-state API (ctx.self/parentStateSchema) is NOT on main despite FIX-914=Done. Worker a7c5fac94b420145e verifying. If premise broken → spec-blind-spot, surface to user.
- #866 Cursor /simplify batch (NON-BLOCKING per cursor's own verdict) — DEFERRED until P1 verdict, then one follow-up worker on spec/FIX-917:
  - Part 2 v1: drop ancestor checkpoint-coverage walk; warn on dirty own-state + non-sequencer (accept false positive) until Q3 pinned (lines 267, 257-267)
  - Reuse isTraceObservabilityEnabled() + logRuntimeEvent("[flow-state]…") instead of raw NODE_ENV/console.warn; note NODE_ENV=test suppression (line 269)
  - Dirty-detect via StateContainer.getVersion() O(1) prefilter, after replay/resume early-returns (~2657-2710) (line 263)
  - Config/runtime dual-shape: doc as explicit temp debt w/ follow-up, or push config.state to engine (line 245)
  - Defer optional DevTool trace note to follow-up (line 273)
  - Decision 2 external-consumer check = hard gate before coding, not in-PR branch (line 170)
  - Sequencer state.own (§12 Q2): decide at sign-off (line 213)
  - Capability asymmetry: blocks→state.*, caps still flat sequencerStateSchema/targetStateSchemas; doc or resolveBlockStateFromConfig helper (line 186)

## Dependencies / sequencing
- FIX-920 unblocked (FIX-918 Done). Parked at spec-approval gate.
- FIX-923 (research) informs FIX-924 (impl). Specs can proceed in parallel; gate 924's IMPLEMENT phase on 923 acceptance.
