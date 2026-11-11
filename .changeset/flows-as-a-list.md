---
"@flow-state-dev/engine": minor
---

`createFlowState` takes its flows as a list: `flows: [chat, support]`. Each flow is served under its own id, as before, so the keys of the old record were never read. The keyed record form is removed with no alias (FIX-2626), and passing one throws a `FlowStateConfigError` that names the list form. To migrate, replace `flows: { chat: chatFlow }` with `flows: [chatFlow]`, and a record you build elsewhere with `Object.values(record)`.

Docs: every `createFlowState({ flows: { … } })` example becomes `flows: [ … ]` (apps/docs/docs/api/server.md first, then the getting-started, server, configuration, persistence, advanced and workforce pages and the deployment and webhook guides that show the call); package READMEs that show the call change the same way.
