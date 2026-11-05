---
"@flow-state-dev/fsdev": patch
---

`fsdev run` says why an `intent/*` model has nothing to resolve to when no `fsdev.config.*` is found (FIX-2451). After the run's error, stderr names the directory searched, says that a runtime in another file such as `lib/flowstate.ts` is not read, and points at default-exporting `createFlowState(...)` from `fsdev.config.ts` or passing `--config <path>`. Runs that load a config, and failures of any other kind, are unchanged.
