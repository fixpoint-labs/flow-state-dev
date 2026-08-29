---
"@flow-state-dev/fsdev": patch
---

`/quit` and idle Ctrl-C no longer stop a parked question. The board row is what counts as in flight, not a run record that stays `running` across a park. (LAB-151)
