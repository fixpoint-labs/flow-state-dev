---
"@flow-state-dev/orchestration": patch
---

The Inbox client now rejects a refused answer or board action with the server's own words (the response body's `error`), not the transport's `Request failed (409)`. A round already answered, for example, reads as the server describes it. A 5xx still rejects as it came (FIX-2835).

Docs: none.
