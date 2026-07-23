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
- Cross-spec design review (920/917/923/924 interactions): agent ab963c9f4375e4534 — RUNNING (read-only, returns to fleet).
- FIX-917 review-response: agent a7c5fac94b420145e — DONE (P1 refuted, P2 minor set).
- FIX-917 predicate fold-in: agent a76bb0f4945e926ca — DONE (a1e78e34: §7 warn-on-dirty+non-sequencer, Decision 4, §12 Q3 resolved, §3/§8/§9 synced, both threads replied).
- FIX-917 dead-key rejection (BP-030): agent a0c64c00a15eba49c — DONE (§6/§8/§9 runtime dead-key throw, thread replied).
- Cross-spec review: agent ab963c9f — DONE (see CROSS-SPEC REVIEW section).
- Cross-spec soft-tweak fold-ins (user said continue → do it): FIX-920 drain-mode note = agent acf2a5e2833483b94 DONE (15de5e9b, §3.6 KD5 + §6); FIX-924 error vocab worker→agent = agent a1fd8b29eaa12602e DONE (303d3dcc).
- FIX-917 durable:false sequencer predicate fix (Codex line-281, valid correctness): agent a81048e0eb04ac298. DONE (§7/§6/§9/§8, thread replied).
- ALL FOUR SPECS FINAL + at AWAITING_SPEC_APPROVAL. No workers running. Fleet idle pending user approvals + backstop trig_01RYq12rZkKpd6mkdopHdiuJ (~02:32Z).
- FIX-917 now treated FINAL: further Codex rounds that aren't silent-loss/correctness class → batch to implementation, don't fold, tell user.
- TREADMILL CALL: after this durable:false fix, treat FIX-917 spec as FINAL. Further Codex rounds that are not silent-loss/correctness class → batch to implementation, tell user, stop folding.
- All four specs at AWAITING_SPEC_APPROVAL. Backstop check-in trig_01RYq12rZkKpd6mkdopHdiuJ (~02:32Z).
- WATCH: Codex re-reviews on each push (treadmill). Findings so far all valid+converging (P1 refuted, P2 changeset, predicate, dead-key). If future rounds nitpick/repeat, STOP folding and tell user spec is good enough.

## PR notes
- #866 (FIX-917 spec) taken out of draft by user 2026-07-23 — review signal only; spec PRs are not merged.
- #866 CRUX: Codex P1 + Cursor pt7/line170 BOTH claim FIX-914 block-state API (ctx.self/parentStateSchema) is NOT on main despite FIX-914=Done. Worker a7c5fac94b420145e verifying. If premise broken → spec-blind-spot, surface to user.
- #866 predicate fold-in DISPATCHED: agent a76bb0f4945e926ca — §7 warn-on-dirty+non-sequencer (drop ancestor walk), §12 Q3 resolved, Decision 4 updated, reply both threads. (User approved fold-in.)
- #866 NEW Codex P2 (r3635010743, line 267, post-P2-push): ancestor-sequencer-checkpoint suppression is a FALSE NEGATIVE — sequencer checkpoint only persists ctx.sequencer.state via state_snapshot, NOT a child block's own container, so a dirty child suspending in a durable sequencer would be SILENT on the common HITL path (exactly what the warning should catch). Converges with Cursor line-267. Recommended fix: adopt Cursor's simpler v1 (warn on dirty own-state + non-sequencer, DROP ancestor walk, accept false positive) — resolves §12 Q3. SURFACED to user for sign-off (design decision on unapproved spec).
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

## CROSS-SPEC REVIEW (agent ab963c9f, done) — all 4 grounded vs origin/main
Verdict: ALL FOUR safe to approve independently. No spec has a self-blocking contradiction.
Interactions (ranked):
1. 924↔923 (valid-assignee def): NOT a blocker. 924 strict checkAssignee is coherent; 923 D5 widens it later via ONE edit. Rec: ship 924 strict now, ratify 923 D5 same sitting.
2. 920↔923 (drain-mode): 920 `conversation` defined vs blocking drain; 923 D7 = don't bake blocking assumptions in. SOFT ASK: 920 add 1 line scoping inheritance boundary + "revisit under FIX-901".
3. 920↔923/641 (contextSupply=how-much vs identity=who): both flow thru materializeWorker; no spec owns whether ad-hoc identity worker can be `conversation`. Flag for FIX-641.
4. 920↔924: shared file cluster but disjoint concerns — parallel-implementable, trivial merge.
5. 924 vocab: error says "worker", guidance says "agent". SOFT ASK: 924 error → "agent".
6. 920 `contextSupply` naming: already dodges contextMode 3-way collision. OK.
7. 917: CONFIRMED independent — shares no surface with delegation trio.
Recommended APPROVAL order (one sitting): ratify 923 D5+D7 FIRST → 924 → 920 & 917 any order. 923 = linchpin.
Recommended IMPL order: 917 anytime (isolated, quiet window) · 924 now on merged-918 · 920 parallel w/ 924 (rebase branch first) · FIX-641 after 923.
Two soft pre-approval spec tweaks: (a) 920 drain-mode note; (b) 924 error vocab → "agent". All else coordinate-at-implement.
Reminder: FIX-920 branch cut pre-918 merge-base — rebase onto origin/main before impl (line refs already match main).
