---
"@flow-state-dev/harness-manager": minor
---

A phase's `buildPrompt` now receives `run.task`: the claimed row's goal, plus its title, context, input, dependency outputs and selected prior work when present. `PromptRunContext.task` is a required field, so code that builds a `PromptRunContext` by hand (a test fixture, say) must now supply it. Prompt builders that only read `run.issue` keep working unchanged (FIX-1717).
