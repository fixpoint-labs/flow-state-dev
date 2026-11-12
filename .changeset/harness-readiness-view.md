---
"@flow-state-dev/harness-manager": minor
---

Harness readiness can be read as a view, with no session (FIX-2624).

- `harnessReadinessView(readiness)` is the readiness read as a user-scope view. Install it on a flow with `views: { readiness: harnessReadinessView(readiness) }`. It takes `{ refresh?: boolean }` (`refresh: true` is Re-check) and answers one row per harness, keyed by harness. The rows are this machine's, the same for every signed-in caller; the answer names no change topic.
- `harnessReadinessViewRef(flow, view?)` from `@flow-state-dev/harness-manager/browser` is the client's handle on it, for `client.view(ref, { refresh })` or `useView(ref)`. The view name defaults to `"readiness"`.
- `HarnessReadinessViewDefinition` is the view's type.
- `harnessReadinessAction` is unchanged.

Docs: packages/harness-manager/README.md ("Which harnesses can run here": the view and its client handle beside the action; add the three names to the supported-API list), apps/docs/docs/orchestration/harness-manager.md (the "A screen" bullet: read the view with no session, Re-check as `{ refresh: true }`)
