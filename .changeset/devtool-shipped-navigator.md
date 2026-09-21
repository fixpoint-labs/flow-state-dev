---
"@flow-state-dev/devtool": patch
---

The DevTool's flow navigator is now the `FlowNavigator` component from `@flow-state-dev/react`, which the package takes as a new dependency: flows are grouped by kind with their copies underneath, and a session list is read only when you open a single flow instance (FIX-1477).
