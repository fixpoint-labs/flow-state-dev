---
"@flow-state-dev/react": minor
---

Remove the module-singleton FlowContext helpers (`setFlowContext` / `getFlowContext` / `withFlowContext`). They never fed `useFlowContext()` or `<FlowProvider>`. Use those instead.
