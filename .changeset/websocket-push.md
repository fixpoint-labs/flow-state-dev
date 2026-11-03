---
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/node": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
---

Screens can read again when something they show changes, without polling on the Node host (FIX-2428).

- **client:** `fsd.subscribe(topics, { onChange, pollIntervalMs? })` calls `onChange` with the notice that woke it (`{ topic, kind, origin? }`), or `null` for a connect, a reconnect or a timer tick. Build topics with `topic.session(id)`, `topic.user()` and `topic.org()`, now exported from the client too. On a host with push, one WebSocket per client carries the notices, signed in through the client's fetcher; elsewhere `onChange(null)` runs every `pollIntervalMs`. `FlowCapabilities` gains `push`. **Breaking:** `fsd.stream()` never worked (the server answered 501); use `fsd.subscribe()`. `UserStreamOptions`, `UserSSECallbacks` and `UserStreamHandle` are removed with it.
- **react:** `useSubscription(topics, read, { pollIntervalMs?, enabled? })` runs a screen's read again on a change, one read in flight and one waiting.
- **node:** `serve()` serves the change-notice WebSocket at `<basePath>/users/:userId/stream`. New options: `push` (default `true`) and `pushSecret` (default `FSD_PUSH_SECRET`, then a random key), which every process behind one address must share.
- **engine:** `GET /capabilities` answers `{ userStream: false, push }`. `POST /users/:userId/stream` checks each topic with its scope's read check and answers a short ticket for the granted ones; a refused topic is left out, as a missing session is. `GET /users/:userId/stream` answers 426 instead of 501. `enablePushDelivery(router, { secret? })` turns push on for a host that serves the socket.
- **contracts / core:** the push wire types (`PushCapability`, `PushMintAnswer`, `PushServerFrame`, `PushClientFrame`, `WireNotice`). **Breaking:** the user-stream event types `UserStreamEvent`, `UserEventBase`, `UserResourceChangedEvent`, `ResourceContentUpdatedEvent`, `ResourceContentCreatedEvent`, `ResourceContentDeletedEvent`, `ScopeStateChangedEvent`, `UserDebugEvent` and `UserPingEvent` are removed; `StreamEvent` is `RequestStreamEvent`.
