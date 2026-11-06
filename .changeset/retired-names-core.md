---
"@flow-state-dev/core": minor
---

A three-part `gateway/provider/model` model string throws `RetiredNameError`, still naming its colon spelling (`"vercel:openai/gpt-6"`), and the refusal is removed in core 0.7.0. `defineFlow` and the block builders no longer refuse `middleware` or `work` by name, and a stop recorded under the model tool name `waitForUser` no longer resumes as `suspendForUser`: no published core accepted or wrote them (FIX-2454).

Docs: none
