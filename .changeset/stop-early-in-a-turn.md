---
"@flow-state-dev/react": patch
---

`useSession().abortRequest` now stops a turn whenever it is pressed: while the turn's POST is still out (the stop is sent again once the server has the request, and the turn is not picked back up), on a turn the hook resumed on mount, and mid-stream, where the hook's stop record now stays in `items` until a snapshot holds the server's own (FIX-1956).
