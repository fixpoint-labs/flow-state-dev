---
"@flow-state-dev/cli": minor
"@flow-state-dev/server": minor
---

`fsdev run` and `fsdev dev` now load an `fsdev.config.ts` (or `.mts`/`.js`/`.mjs`) from the project root — a file that default-exports your `createFlowState` handle — so the CLI runs your flows with the app's own model resolver and stores, the same wiring the server uses; pass `--config <path>` to point at a specific file or `--no-config` to force directory discovery.

Added `isFlowState()`, a structural guard for `FlowState` handles, and moved the active-profile diagnostic that `createFlowState` logs on first runtime resolution from stdout to stderr so it no longer interleaves with data streams such as `fsdev run`'s NDJSON output.
