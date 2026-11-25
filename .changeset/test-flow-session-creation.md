---
"@flow-state-dev/testing": patch
---

`testFlow` now lets the engine create a fresh session when `seed.session` is omitted. Session default factories and creation checks run as they do in production. Passing a session fixture still lets tests simulate older stored state (FIX-1132).
