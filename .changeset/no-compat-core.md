---
"@flow-state-dev/core": minor
---

A three-part `gateway/provider/model` model string now fails as an invalid model format, with no message pointing at the colon spelling; write `"gateway:provider/model"`. `defineFlow` and the block builders no longer refuse `middleware` or `work` by name, and a stop recorded under the model tool name `waitForUser` no longer resumes as `suspendForUser` (FIX-2454).

Docs: none. The old names and shapes are removed outright, with no refusal message.
