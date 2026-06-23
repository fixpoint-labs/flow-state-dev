---
"@flow-state-dev/memory": patch
---

The memory observer now extracts only from conversation `message` items. Previously it fed the *entire* session item log to the `memory/observe` prompt — including `block_trace`, `state_change`, `router_decision`, `reasoning`, and `tool_output` items, plus the memory subsystem's own observer/reflect output. That execution noise bloated the prompt and skewed extraction. Selection is now narrowed to user turns and assistant replies (the watermark still advances over the full log, so nothing is double-processed). The selection/formatting logic is exported as `buildObserveContext(items, lastProcessedIndex)`.
