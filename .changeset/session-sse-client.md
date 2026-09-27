---
"@flow-state-dev/client": patch
---

Add `createSessionSSEClient(options)`, a client for the whole-session stream. It reconnects with backoff, handing back the last server time it heard, and stops without retrying when the server refuses the session or has no such route (FIX-1609).
