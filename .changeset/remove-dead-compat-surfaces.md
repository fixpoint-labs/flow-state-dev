---
"@flow-state-dev/react": minor
---

Remove the React module-singleton FlowContext helpers (`setFlowContext` / `getFlowContext` / `withFlowContext`). They wrote to a module-level variable that nothing read — neither `useFlowContext()` nor `<FlowProvider>` ever consulted it, so calling them had no effect on any hook. Use `<FlowProvider>` and `useFlowContext()` (FIX-1210).
