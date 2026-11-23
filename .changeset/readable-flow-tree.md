---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/workforce": minor
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/claude-code": patch
---

A flow and its sessions can say what they are, so a flow list reads by who and what instead of by hashed ids (FIX-2875).

- **core / engine / client:** `defineFlow({ description })` goes out on the flow list as `FlowListEntry.description`. `session.label: ({ id, state }) => string | undefined` names a session on every read of it, as `SessionSummary.label`. It sees only the state the session shows (readonly and exposed fields). A label that throws leaves that session unlabelled, and the server warns once for that flow kind.
- **react:** `FlowNavigator` reads a session's title, then its `label`, then a shortened id (derived ids such as `dsx_…` shorten too). In every app that uses `FlowNavigator`, a collection flow with one copy whose id is the flow's kind draws one level; a single copy with a different id keeps its own line. Sessions run with no session id of their own (`ephemeral_…`) fold into one closed "One-off runs (N)" line, together with every run they started. An empty session list shows the flow's description, which is also the flow line's tooltip.
- **devtool:** each session line has a copy button for its id.
- **workforce:** every worker flow labels a session by its worker's name (a standard worker's `name:`, else the worker id), plus the task id for a task's session. The `agent` worker flow and service flows have descriptions; so do harness manager's `coder` and `harnesses` flows and the Claude Code kit's flow.

Docs: apps/docs (flow definition: `description`, `session.label`; the DevTool's flow tree)
