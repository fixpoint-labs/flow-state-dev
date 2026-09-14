---
"@flow-state-dev/orchestration": minor
---

`createSkillsLibrary({ catalog })` takes a new `registerCatalogTools` option (default `true`, preserving today's behaviour). Set it `false` to keep validating a bound skill's declared `allowed-tools` against `catalog` without the library registering any of `catalog` on the generator itself — useful when a caller already owns tool registration through its own means (FIX-1363).
