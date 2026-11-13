---
"@flow-state-dev/client": minor
"@flow-state-dev/codex": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/cursor": minor
"@flow-state-dev/devtool": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/react": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/testing": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/workspace": minor
---

**Breaking:** 1,080 unused exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
