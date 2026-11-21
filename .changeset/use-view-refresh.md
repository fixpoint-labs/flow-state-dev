---
"@flow-state-dev/react": minor
---

`useView` returns `refresh()`, which reads the view again now for every screen sharing the read, and `failure` (`{ message, httpStatus? }`), why the last read failed while `stale` (FIX-2774).

Docs: packages/react/README.md (`useView`)
