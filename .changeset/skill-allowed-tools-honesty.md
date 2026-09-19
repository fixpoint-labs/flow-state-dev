---
"@flow-state-dev/orchestration": patch
---

An active skill's `allowed-tools` now renders into the generator's context as the skill's intent rather than as a grant. The note names the same tools, states that they are what the skill is written around, and says the generator's own tool configuration decides what it can actually call. The previous wording ("only these tools are available: ...") claimed both that those tools were callable — which a generator fenced by its own `tools:` could not do — and that nothing else was, which no code enforces (FIX-1451).
