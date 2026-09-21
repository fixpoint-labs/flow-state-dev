---
"@flow-state-dev/react": patch
"@flow-state-dev/client": patch
---

`FlowNavigator` browses your flow kinds and their sessions, reading each kind's depth from its declared `cardinality` and fetching sessions only when a leaf opens, and `sessionQueryFor` turns a flow address into the right session-listing filter (FIX-1477).
