---
"@flow-state-dev/cli": minor
---

Flow discovery now scans `labs/` alongside `packages/`, `examples/`, and `apps/`, and no longer silently drops flow modules that throw during import — failures produce a stderr warning, are listed in the "Flow not found" / "No flows found" errors, and are observable programmatically via the new `onImportFailed` option on `discoverFlows`.
