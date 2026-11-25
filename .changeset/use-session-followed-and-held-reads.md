---
"@flow-state-dev/react": patch
---

`useSession` fixes two edge cases in how it reads a session (FIX-2508).

- A state change that arrives while `refresh({ items: false })` is waiting on its detail read, after its state read answered and before the first full read lands, is no longer lost. An `increment` in that window used to be dropped from the state the view showed.
- When the latest-request read fails and the hook holds no earlier record, the request the view shows last now reads its own status, so `followedRequest` is no longer stuck at `null`. With `live`, it is read again until it has ended, as when the latest-request read names another request.

Docs: none; behaviour now matches what `followedRequest` and `refresh({ items: false })` already describe.
