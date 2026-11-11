---
"@flow-state-dev/workforce": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

A session can now announce something once on a topic the app declares, and every routine of the same user that follows that topic hears it once, as a message from `service:internal` (FIX-2630). Build the topics with `internalServiceFlow({ installation, topics })`, give its `provider` to `hireWorkforce`'s `routines.providers`, and publish with `publishEvent` (a worker's tool through `capability`, or a function a block calls); an undeclared topic or event kind is refused at publish and at subscribe, and a chain of announcements stops at the message budget.

Docs: workforce/routines.md (a "Topics your sessions publish" section: declaring topics, `publishEvent` as a tool and a function, following a topic with a routine, own user and tenant only, the message budget as the loop guard), packages/workforce/README.md (`internalServiceFlow` and `publishEvent`), apps/docs/docs/advanced/inbound-transports.md (the one-to-many line beside `dispatcher()`: a published event reaches every routine of its user that follows its topic, where a dispatch reaches one named entry)
