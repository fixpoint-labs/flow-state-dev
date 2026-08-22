---
"@flow-state-dev/orchestration": minor
---

Remove the unused `catalog` option from `createRunSkillTool`. Inline activation does not resolve tools there; pass the catalog to `createSkillsLibrary` or `createSkillsCapability` instead.
