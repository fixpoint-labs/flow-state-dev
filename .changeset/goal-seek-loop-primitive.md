---
"@flow-state-dev/orchestration": minor
---

Add `goalSeekLoop` — a config-driven, judge-gated loop over a task board's drain. It names the "produce → drain → judge → repeat, bounded so it always terminates" shape once, so a bounded "work until done" loop is one primitive instead of a hand-wired sequencer. A single three-way `Verdict` (`done` / `continue` / `replan`) plus the `mapToVerdict` helper unifies the drain-empty and LLM-verdict termination dialects; `maxIterations` is a mandatory finite backstop and the loop emits a typed termination item recording the reason (`converged`, `max-iterations`, or `judge-error`) and drain count. The board must be request- or resource-backed (rejected at construction otherwise). The task board handle now also carries a `backing` descriptor and a `hasIdlessInitialTasks` flag, and `createApplyReplan` (with its `TaskContextSupply` type) moved here from `@flow-state-dev/patterns` — patterns re-export it, so their public surface is unchanged.
