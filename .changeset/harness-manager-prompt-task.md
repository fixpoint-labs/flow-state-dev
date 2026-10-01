---
"@flow-state-dev/harness-manager": minor
---

A phase's `buildPrompt` now receives `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. Prompt builders that only read `run.issue` keep working unchanged (FIX-1717).
