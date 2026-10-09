---
"@flow-state-dev/claude-code": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
"@flow-state-dev/tools": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/devtool": minor
---

Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
