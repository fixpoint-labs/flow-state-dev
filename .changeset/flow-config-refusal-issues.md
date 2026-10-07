---
"@flow-state-dev/core": patch
---

A refused flow config bag now throws `FlowConfigRefusalError`, which carries each issue as `{ path, code, message }` beside the same message as before (FIX-1789).
