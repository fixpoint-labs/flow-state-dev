---
"@flow-state-dev/codex": minor
---

Codex's non-fatal warnings (an `error` item, such as a service tier the model doesn't advertise) are now kept `status` notes instead of `error` items, and its stream-level `error` events (retry progress) are transient `status`; when the stream ends on one with no turn result, that error becomes the run's failure. A failed turn the CLI then exits on fails with the turn's own message, read down to one line from the API's JSON body, and the CLI's output rides on the error item's `details.output`. `TranslatedEvent` gains `notice` and `stream_error` kinds: a `switch` over it that covers every kind needs a case for each (FIX-1988).
