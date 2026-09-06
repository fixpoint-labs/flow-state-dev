---
"@flow-state-dev/core": patch
---

LAB-153: the model price table now knows OpenAI's Codex models, so a Codex run can be priced.

`gpt-5.4-codex-mini` previously matched the `gpt-5.4` row and was estimated at the full model's rate. Cost estimates for that model change; the other Codex names were unpriced before and are priced now.
