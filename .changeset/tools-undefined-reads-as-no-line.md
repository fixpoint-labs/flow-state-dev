---
"@flow-state-dev/workforce": patch
---

A hand-built worker manifest with `tools: undefined` is now treated as having no `tools:` line everywhere (FIX-1459). Before, every turn already granted it its picked presets' tools, but the startup check read it as a written line and skipped the clash refusal, so a preset tool-name clash surfaced mid-turn instead of at hire.
