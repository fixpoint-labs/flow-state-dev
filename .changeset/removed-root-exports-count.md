---
"@flow-state-dev/client": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
"@flow-state-dev/cursor": patch
"@flow-state-dev/devtool": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/patterns": patch
"@flow-state-dev/react": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/store-postgres": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/testing": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/workspace": patch
---

**Breaking:** 1,078 unused exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
