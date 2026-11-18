---
"@flow-state-dev/engine": patch
---

A view that reads another of the user's sessions with `sessions.read` now reads again when that session is created or deleted, and no longer each time one of its turns starts or ends. A board view that names its conversation no longer reads again while a reply streams there (FIX-2773).
