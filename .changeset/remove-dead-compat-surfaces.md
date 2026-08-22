---
"@flow-state-dev/react": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/patterns": minor
---

Remove unused compatibility surfaces: the React module-singleton FlowContext helpers (`setFlowContext` / `getFlowContext` / `withFlowContext`), the engine `injectHeartbeat` stream wrapper, and the public `legacyWorkerAdapter` export. Use `<FlowProvider>` / `useFlowContext()`, `createSSEStream`, and `executableTaskSchema` respectively.
