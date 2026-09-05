---
"@flow-state-dev/core": patch
---

LAB-153: the model price table learns OpenAI's Codex models, so a Codex run can
be priced at all.

The rows sit before their base models deliberately. `findModelEntry` matches by
substring and takes the first hit, so without them `gpt-5.4-codex-mini` fell
through to the `gpt-5.4` row and was priced as the full model — a wrong number
rather than a missing one.

Codex variants are priced as the base model they are built on. If OpenAI's prices
diverge, correcting them here corrects every adapter reading this table.
