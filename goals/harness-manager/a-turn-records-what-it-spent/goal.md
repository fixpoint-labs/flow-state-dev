# harness-manager › a turn records what it spent

**Issue:** FIX-2398 (epic FIX-2369)

**Outcome:** Every app that shows a coding task or a harness turn shows what it spent, in the same words: model, tokens, the vendor's charge when it reported one, and for a turn how long it took. This check covers the turn half at the package: a harness session's turn record carries what the turn spent, however the turn ended.

**Input:** a one-line prompt that asks Claude Code to echo a fresh random token, and a long count to stop mid-run. Any other prompt must pass. An in-memory store.

**Signal:** real Claude Code, in process, signed in with an API key (`ANTHROPIC_API_KEY`, else `MY_ANTHROPIC_API_KEY`) so its vendor reports a charge. No tools.

- **t**: after a completed turn, its record's `spend` names the model, `inputTokens + outputTokens > 0`, `costUsd > 0`, and `endedAt ≥ at`.
- **s**: a turn stopped after 8 s still has `spend`, naming `claude-code`.

**Anti-game:** both legs read the turn record from session state, the record a page reads. Nothing reads the harness's handle or its spend report, which exist whether or not the record was written.

**Model:** `claude-haiku-4-5` (override with `GOAL_CLAUDE_MODEL`). Any model Claude Code runs must pass.

**Run:** `pnpm tsx goals/harness-manager/a-turn-records-what-it-spent/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=no-turn-spend`: the flow's turn-end step is dropped, as a flow that never writes a turn's spend would. **t** and **s** FAIL on `spend` being null.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-31 | implementation branch, on 45cefc5 | claude-haiku-4-5 (API key) | **PASS** | Linux container. **t**: 17,634 in · 73 out · $0.022405, 4.0 s. **s**: stopped, 17,491 in · 4 out, no charge reported for the stopped run. Control `no-turn-spend` FAILED **t** (no spend, no `endedAt`) and **s** (no spend) |
