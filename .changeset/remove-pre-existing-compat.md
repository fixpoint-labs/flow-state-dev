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

Remove backward-compatibility paths for data and options from before earlier renames (FIX-1804, FIX-850).

- `@flow-state-dev/claude-code` no longer has a package-root entry. `remoteAgentTaskHandleSchema`, `RemoteAgentTaskHandle`, `RemoteAgentSource` and `RemoteAgentStatus` are gone from the root, `/cli` and `/sdk`; use `harnessRunEnvelopeSchema` from `@flow-state-dev/core` and `HarnessRunEnvelope`, `HarnessSource`, `HarnessRunStatus` from `@flow-state-dev/core/types`. A stored SDK handle must carry `source: "claude-code/sdk"`.
- `@flow-state-dev/patterns` no longer exports `legacyWorkerAdapter`, `executableTaskSchema` or `ExecutableTask`. Supervisor workers receive `TaskWorkerInput`.
- The filesystem, SQLite and Postgres stores read only the current on-disk and table layouts, and a scheduled request is matched only by `metadata.schedule.scheduleId`. Data written in an older layout is not read or migrated: move such a store aside or delete it.
- Removed options are no longer refused by name: `clientData` on a scope, `authentication.requireOrg`, `requireOrg` on a block, the `presets` resolver option and `preset/*` model strings, the `prefer` rule in `selectModel`, and `fileFilter`/`syncMode` on `createBashTool`.
