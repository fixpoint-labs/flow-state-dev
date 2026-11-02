---
"@flow-state-dev/engine": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/bullmq": patch
"@flow-state-dev/fsdev": patch
---

Stores profiles take a `bus` slot: a change bus that carries notices that something under a session, user or org changed (`ChangeBus`, `ChangeNotice`, `BusTopic`, `createInMemoryBus`). Every request and session write publishes on its session's topic, through `withChangeBus`, which `resolveStores`, `createFlowState`, `runAction`, BullMQ's job processor and `fsdev run` / `chat` apply. The session stream (`GET /sessions/:id/stream`) now reads when a notice wakes it, at most once a second; on a bus that crosses processes it reads nothing while the session is idle. The in-memory bus, the default and the only one that ships today, keeps the once-a-second read as well, so nothing changes for a deployment that sets no `bus`. A `bus` adapter declares `"bus"` in its capabilities and resolves `{ bus }`. `@flow-state-dev/contracts` (re-exported by core) adds `ChangeKind` and the wire topic constructors `topic.session(id)`, `topic.user()` and `topic.org()` (FIX-2426).
