---
"@flow-state-dev/fsdev": patch
---

`fsdev conductor` no longer advertises `/wake` on an errored or cancelled row. That row is spent; the board will not take it. (LAB-151)
