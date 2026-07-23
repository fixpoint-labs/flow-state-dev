# Fleet: FIX-920, FIX-917, FIX-923, FIX-924

Started: 2026-07-23
Concurrency N: 4 declared, cap 3 simultaneously implementing.
Linear access: MCP is wrong-workspace (OnSecurity). Use Linear GraphQL API + $LINEAR_API_KEY for fixpoint-labs issues.

## Status table
| Issue | Phase | Spec PR | Impl PR | Gate pending? | Worktree | Notes |
|-------|-------|---------|---------|---------------|----------|-------|
| FIX-920 | AWAITING_SPEC_APPROVAL (revised) | #853 | — | user re-review | claude/fix-920-spec-tsdnqg | Spec revised to merged FIX-918 (agents:/runBoard, board-commanded, blockRef dropped, refs fixed). Q2a/Q3 still OPEN. Ready for user sign-off. |
| FIX-917 | AWAITING_SPEC_APPROVAL | #866 | — | pending user | spec/FIX-917 | Spec sound. P1(Codex)=REFUTED (stale pre-FIX-914 base, branch 105 behind main; 4-key surface verified on main). P2=fixed b9d05a4a (changeset minor for hard-rename). Rebase branch onto main at IMPLEMENT time (not needed to approve spec). Cursor /simplify batch = impl-time refinements (deferred); 2 items need user sign-off: §12-Q2 sequencer state.own, Decision-2 consumer-check-as-hard-gate. |
| FIX-923 | AWAITING_SPEC_APPROVAL (co-spec done) | #864 | — | pending user | spec/FIX-923 | Re-spec pushed: drain-mode axis (blocking/background), FIX-901-forward-compat host model, §8A drain analysis, §8B harness prior art (Claude Code/Codex), Decision 7. 923↔901 related created + Linear mirror. Conclusions unchanged for blocking drain today. |
| FIX-924 | AWAITING_SPEC_APPROVAL | #865 | — | pending user | worktree | spec PR #865 up, subscribed. soft-coupled to FIX-923; DO NOT implement 924 until 923 research accepted |

Note: coordination PR #862 closed-without-merge by user (deliberate — record is internal). fleet.md commits continue to the branch; do NOT open a replacement PR.

## Active workers
- FIX-923 co-spec (w/ 901 + harness research): agent a6f3374cd04c10a01 (restarted after /grill-me interrupt killed prior ae4c4c238de6d74ea)
- (prior specs done: 917→#866, 923→#864, 924→#865; 920 revision→#853)

## Active workers (cont.)
- (none running) — all four specs at AWAITING_SPEC_APPROVAL. Fleet idle pending user gates + backstop check-in trig_01MhRkGdfiCwtRZw3yUMXFHt (~01:49Z).
- FIX-917 review-response: agent a7c5fac94b420145e — DONE (P1 refuted, P2 minor set).

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
