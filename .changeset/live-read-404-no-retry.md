---
"@flow-state-dev/client": patch
---

A live read (`client.live`, and every hook and view built on it) no longer retries a 404 on backoff (FIX-2844). Before, a read of something that isn't there (a view the flow never declared) tried again up to every 30 s for as long as the screen was open. Now it reports the error through `onError`, stays stale, and reads again only on a notice, a tick or `refresh()`. Every other failed read still retries on its own, 1 s doubling to 30 s.

Docs: none (the live-read docs describe retrying a failed read; a sentence saying a 404 is not retried can follow at release).
