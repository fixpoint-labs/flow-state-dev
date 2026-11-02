---
"@flow-state-dev/react": minor
---

`useSession` can re-read a session's state without its item history: `refresh({ items: false })` makes one state read and leaves `items` alone. The hook now also re-reads state when a request it follows ends without completing, and after `abortRequest()`. A new `followedRequest` field gives the status of the request the view shows last, even when a later request was sent beside it (FIX-2410).
