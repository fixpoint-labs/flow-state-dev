---
"@flow-state-dev/claude-code": patch
---

A Claude Code run's `usage.inputTokens` now counts cached input (FIX-1178). It was only the uncached part of the prompt, so a run that read from the prompt cache under-reported its tokens while `cost` charged for all of them. Cache reads and cache writes are both counted as input, matching what the run's spend report already did.

Docs: packages/claude-code/README.md (wherever the handle's `usage` is described)
