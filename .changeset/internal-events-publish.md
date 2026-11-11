---
"@flow-state-dev/workforce": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

A session can now announce something once on a topic the app declares, and every routine of the same user that follows that topic hears it once, as a message from `service:internal` (FIX-2630). Build the topics with `internalServiceFlow({ installation, topics })`, give its `provider` to `hireWorkforce`'s `routines.providers`, and publish with `publishEvent` (a worker's tool through `capability`, or a function a block calls); an undeclared topic or kind is refused at publish and at subscribe, and a chain of announcements stops at the message budget.

Docs: workforce/routines.md
