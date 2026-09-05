---
"@flow-state-dev/core": patch
"@flow-state-dev/react": minor
---

Added `useSuspensions` hook and `ApprovalRenderer` component for human-in-the-loop approval flows. `useSuspensions(session)` derives pending and resolved suspensions from the live item stream and exposes `approve`/`reject` callbacks. `ApprovalRenderer` is the built-in inline card rendered by `ItemRenderer` for `suspension` items; suppress it with `renderers={{ suspension: false }}` or replace it with a custom component via the new `RendererRegistry.suspension` slot. Also adds `isSuspensionItem` and `isSuspensionResumeItem` type guards to `@flow-state-dev/core`.
