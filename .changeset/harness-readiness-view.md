---
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": patch
---

Harness readiness is read as a view, with no session (FIX-2624).

- `harnessReadinessView(readiness)` is the readiness read as a user-scope view. Install it on a flow with `views: { readiness: harnessReadinessView(readiness) }`. It takes `{ refresh?: boolean }` (`refresh: true` is Re-check) and answers one row per harness, keyed by harness. The rows are this machine's, the same for every signed-in caller; the answer names no change topic.
- `harnessReadinessViewRef(flow, view?)` from `@flow-state-dev/harness-manager/browser` is the client's handle on it, for `client.view(ref, { refresh })` or `useView(ref)`. The view name defaults to `"readiness"`.
- `HarnessReadinessViewDefinition` is the view's type.
- `harnessReadinessAction` is removed, with no alias. Install `harnessReadinessView(readiness)` in the flow's `views` instead of the action in its `actions`, and read it with `client.view(harnessReadinessViewRef(flow), { refresh })` instead of sending the action in a session; the answer is the rows themselves, not `{ harnesses }`.

Docs: packages/harness-manager/README.md ("Which harnesses can run here": the view and its client handle in place of the action; swap `harnessReadinessAction` for the three names in the supported-API list), apps/docs/docs/orchestration/harness-manager.md (the "A screen" bullet and its example: install the view, read it with no session, Re-check as `{ refresh: true }`; drop `harnessReadinessAction` from the export list), packages/shift-manager/README.md (Usage: `openLab({ readiness })` puts the `readiness` view on the projects flow, not a `harnessReadiness` action)
