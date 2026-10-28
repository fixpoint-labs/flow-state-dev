---
"@flow-state-dev/react": minor
---

`useSession` has `followRequest(requestId)`: follow a request of the session that was sent without the hook, streaming its items into `items` and making it the request `abortRequest` stops (FIX-2265). Send a request beside the one the page follows through the client, and follow it once that one ends, so the page stays on the running request meanwhile.
