---
"@flow-state-dev/engine": minor
---

A request's SSE stream no longer holds the whole request in memory for a reader that is slow or absent (FIX-2675).

- **engine:** a request stream (the inline `Accept: text/event-stream` POST response and the `GET /requests/:id/stream` live tail) holds at most 4 MiB its reader has not taken yet. A reader that falls further behind gets what was already written, then the stream ends with no terminal event. Resume it from the last event id it received (`Last-Event-ID` or `starting_after`), as after any disconnect; every event is delivered. Code that treats the end of a stream as the end of the request should check for a terminal `request.*` event and resume when there was none.
- **engine:** a route that answers `202` (action, resume, answer, continue, retry) no longer fills a live stream for that request, and neither do continuations nothing streams (the durability sweeper, a wait's resume, a parked stop). Their events are read through the GET stream as before.

Docs: apps/docs streaming / resume page (a request stream ends when its reader falls 4 MiB behind; resume from the last event id), packages/engine/README.md if it describes inline streaming.
