---
"@flow-state-dev/fsdev": patch
"@flow-state-dev/core": patch
---

`fsdev run` says why an `intent/*` model has nothing to resolve to when no `fsdev.config.*` is found (FIX-2451). After the run's error, stderr names the directory searched, says that the file which calls `createFlowState` is not read, and points at default-exporting `createFlowState(...)` from `fsdev.config.ts` or passing `--config <path>`. `--quiet` suppresses it. Runs that load a config, and failures of any other kind, are unchanged.

`@flow-state-dev/core` now throws that resolver failure as `UnresolvedIntentError`, a `FlowError` with `code: UNRESOLVED_INTENT_CODE` (`"unresolved_intent"`) and `details.intent`, so callers can recognise it without matching the message. Both are exported from the `@flow-state-dev/core/errors/unresolved-intent-error` subpath, not the package root. The message is unchanged.
