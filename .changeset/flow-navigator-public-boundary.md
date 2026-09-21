---
"@flow-state-dev/react": minor
"@flow-state-dev/client": minor
---

`@flow-state-dev/react` ships `FlowNavigator`, a rail that browses your flow kinds and their sessions. How deep a kind goes is read from its declared `cardinality` — a collection kind lists its instances and then one instance's sessions, a singleton kind lists its sessions directly — so there is no depth prop. Sessions are read only when a leaf opens, so a kind holding two hundred instances costs nothing to expand. It brings no CSS framework and no icon set; style it with CSS custom properties and fill it through slots, and pass your own clients so its reads carry your transport. `useReadFence` is exported alongside it. `@flow-state-dev/client` gains `sessionQueryFor`, which turns a flow address into the right session-listing filter (FIX-1477).
