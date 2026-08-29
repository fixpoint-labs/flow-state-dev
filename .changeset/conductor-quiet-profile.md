---
"@flow-state-dev/engine": patch
"@flow-state-dev/fsdev": patch
---

`FlowState.setLogger` installs a host logger before `getRuntime()`, so `fsdev conductor` and `--quiet` can suppress the active-profile init line. (LAB-151)
