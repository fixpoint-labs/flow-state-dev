---
"@flow-state-dev/fsdev": patch
---

Ctrl-C during a `fsdev conductor` drain stops that drain. A board refresh (`r`, a poll) no longer starts a second `status` that would take the abort instead. (LAB-151)
