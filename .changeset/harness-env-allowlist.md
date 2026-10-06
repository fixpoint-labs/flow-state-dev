---
"@flow-state-dev/core": patch
---

Add `harnessEnv({ pass })`, which builds a coding harness's `env` from an allowlist of variable names so a harness's agent process sees only the variables you name instead of the server's entire `process.env` (FIX-1716).
