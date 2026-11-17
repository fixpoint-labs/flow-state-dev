---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/core": patch
"@flow-state-dev/workspace": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/cursor": patch
---

A harness run that is still working is no longer stopped for how long it has run. Coding runs and harness session turns are stopped only once the harness has sent nothing for 20 minutes, and they fail with a message that names the harness, such as "No output from Claude Code for 20 mins; stopped." (FIX-2794)

- **Coding runs.** `harnessManager` and the harness kit take `idleTimeoutMs` (default 20 minutes). `runTimeoutMs` is now an optional cap on a run's total time, off by default; before, it was required, and the kit capped every run at 20 minutes. `harnessManager` also takes `harnessLabel`, the harness's name in the stop message, which the kit fills from each harness's `label`. `codingDrainBudgetMs` takes `idleTimeoutMs` too. When no cap is set, a shutdown waits 20 minutes for a run's harness before it cancels the run.
- **Session turns.** `harnessSessionFlow` takes `idleTimeoutMs` (default 20 minutes) and `harnessLabel`. `turnTimeoutMs` is now an optional cap, off by default; before, every turn was capped at 60 minutes. A turn stopped for silence is recorded as `timedOut`, like one stopped at the cap.
- **The harness contract.** A new optional feed, `onEvent` (type `HarnessEventHook`, helper `reportHarnessEvent` in `@flow-state-dev/core/harness`), is called on every event a run sends. `claudeCodeAgent`, `codexAgent` and `cursorAgent` call it, and `codexHarness()` and `cursorHarness()` pass it on. **If you write your own harness slot and pick feeds by name, pass `onEvent` on too.** A harness that never calls it is stopped after the idle window, however busy it is.
- **Checkout locks.** A coding run's checkout lock is marked live on its events (`refreshLock` in `@flow-state-dev/workspace`), so a long run keeps its lock. The stale window is sized from the idle window rather than from a run's length.

Docs: apps/docs/docs/orchestration/harness-manager.md (`runTimeoutMs` is an optional cap; `idleTimeoutMs` and `harnessLabel`; the drain budget's run term), the harness kit page (the `idleTimeoutMs` key; `runTimeoutMs` off by default), apps/docs/docs/tools/codex.md and cursor.md (`onEvent` on the block's options), the harness contract reference (`onEvent`, `HarnessEventHook`, `reportHarnessEvent`).
