---
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/core": minor
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": minor
---

Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).
