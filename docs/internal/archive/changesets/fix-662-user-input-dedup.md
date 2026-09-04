---
"@flow-state-dev/core": patch
---

Wiring both `action.userMessage` and the generator's `user` slot to the same source no longer double-emits the user's content to the model. The framework now deduplicates equivalent user-role messages at the generator's message-assembly layer, so flows built on the canonical chat-agent template behave correctly. Sub-generators with non-input-derived `user` slots are unaffected.
