---
"@flow-state-dev/core": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
---

Remove the `pattern` and `fork` skill context modes. A skill is now inline instructions, optionally plus delegation, and `SkillContextMode` collapses to `"inline"`.

- `@flow-state-dev/core`: `SkillContextMode` is now the single value `"inline"`; the `PatternBinding` and `TaskInitYaml` types and `SkillState.outputSchema` are removed; `SkillState` gains a top-level `workers` field.
- `@flow-state-dev/orchestration`: delegation is derived from a bound skill's `workers:` on `createSkillsLibrary`. It installs a private own-state task board, `taskTools` (whose `addTask` accepts a structured `input` payload), one callable tool per worker (calling a worker runs it and returns its result inline), and `runBoard` — a board drain over that ledger, so the skill plans a task graph (`addTask` with assignee/deps) and executes it under concurrency with dependency gating in one call. Workers materialize at runtime through the generator's async tool seam, so `agent-ref` workers resolve via the new `agentRegistry`/`materializeAgent`/`capabilityCatalog` library options and runtime-activated worker skills contribute their tools too; identical worker specs shared by two active skills dedupe. The fork generator and the `runSkill` pattern/fork routes are removed (`runSkill` also rejects stale pre-migration non-inline manifests loudly), and the `taskTools` board-resolution sentinel is renamed to `no_delegation_board`. Deterministic flows like `goalSeekLoop` and `taskBoard().drain` can still be placed in a generator's `tools:` and called as a single tool.
- `@flow-state-dev/patterns`: the `defaultPatternRegistry` / skill-pattern binding is removed; the pattern factories themselves are unchanged.
