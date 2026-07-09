---
"@flow-state-dev/react": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/ui": minor
---

Move presentational components out of `@flow-state-dev/react` (the style-system-free logic layer) into the `@flow-state-dev/ui` registry, and make audit results render out of the box.

- `@flow-state-dev/react`: removed the `ModelBadge`, `AuditAnnotation`, and `AuditAnnotationProgress` exports. `ModelBadge` now lives in the ui registry — install it with `fsdev ui add model-badge` and import it from your local copy. The ui version is Tailwind-only (no inline-style fallback), so a project without Tailwind will need to add its own styling via `className`. Audit results now render through the ui `audit-annotation` component (included in `chatAssistantRenderers`); `AuditAnnotationProgress` had no replacement and was removed outright.
- `@flow-state-dev/patterns`: the `responseAuditor` pattern now emits an `audit-annotation` component item when it surfaces findings, so the audit card renders automatically for any consumer instead of each app hand-wiring the emit.
- `@flow-state-dev/ui`: added the `model-badge` component and registered the existing `audit-annotation` component so both are installable via `fsdev ui add`.
