---
"@flow-state-dev/react": patch
---

A `FlowNavigator` section can omit `kinds` to cover every kind the server registers, for an app that cannot name them ahead of time, and the `leafToolbar` slot now receives the flow-list entry its leaf was drawn from, so a host can render what a flow declares without reading the flow list a second time (FIX-1477).
