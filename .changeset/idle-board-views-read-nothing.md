---
"@flow-state-dev/client": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/contracts": patch
---

An idle view stops re-reading on changes that can't touch what it shows (FIX-2695).

- **client:** `client.live` with `topicsFromResult` now applies a result's `hears` (a view's answer, from `client.view`): a notice under the answer's topics that its hearings don't admit reads nothing. `LiveResult` gains an optional `hears`. Before, only `useView` applied it; a screen that passed `client.view`'s answer to `client.live` re-read on every notice under the topics, including each chunk of a reply streaming in the session.
- **client:** when a live read's answer names new topics, it subscribes them before it lets go of the old ones, so a client whose only subscription is that live read keeps its socket instead of closing it and opening another.
- **engine:** a view that reads a session's state hears only that session's `state` notices. A reply streaming in the session (`items`, `request`) and a request stamping the session record (`run`) no longer wake it. A view that reads the session itself (its items, metadata, window or journal, or another session through the request host) still hears every kind but `resource` and `board`.

Docs: none for users beyond the client reference's `client.live` entry (`hears` on a `topicsFromResult` result), if it lists `LiveResult`'s fields.
