---
"@flow-state-dev/engine": patch
"@flow-state-dev/client": patch
---

Stopping an `interrupted` request that no gate holds now ends it `aborted`: `POST …/abort` answers 204 instead of 409, and the request leaves `requests.interrupted()`. `@flow-state-dev/client` exports `interruptedBySession(requests, { actions })`, which groups what `requests.interrupted()` returned by session, oldest first, keeping only the named actions (FIX-2377).
