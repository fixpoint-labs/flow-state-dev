---
"@flow-state-dev/core": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
---

Remove the `pattern` and `fork` skill context modes. A skill is now inline instructions, optionally plus delegation, and `SkillContextMode` collapses to `"inline"`.

- `@flow-state-dev/core`: `SkillContextMode` is now the single value `"inline"`; the `PatternBinding` and `TaskInitYaml` types and `SkillState.outputSchema` are removed; `SkillState` gains a top-level `workers` field.
- `@flow-state-dev/orchestration`: delegation is derived from a bound skill's `workers:` on `createSkillsLibrary` — it installs a private task board, `taskTools`, and one callable tool per worker (calling a worker runs it and returns its result inline); the fork generator and the `runSkill` pattern/fork routes are removed, and the `taskTools` board-resolution sentinel is renamed to `no_delegation_board`. Deterministic flows like `goalSeekLoop` and `taskBoard().drain` can be placed in a generator's `tools:` and called as a single tool.
- `@flow-state-dev/patterns`: the `defaultPatternRegistry` / skill-pattern binding is removed; the pattern factories themselves are unchanged.
