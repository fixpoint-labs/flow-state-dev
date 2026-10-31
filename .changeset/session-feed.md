---
"@flow-state-dev/client": minor
---

`@flow-state-dev/client` exports `sessionFeed(client, sessionId)`: one session followed without React, with its items, its unfinished runs, and a connection `state` (`connecting`, `live`, `reconnecting`, `lapsed`, `stopped`) that recovers on its own after a dropped connection. `followResponse(response)` keeps a send's answer as it is written. The pieces it is built from are exported too: `followSession`, `readSessionHistory` and `mayReplaceItem`. `useSession` now follows sessions through them, with no change to what it shows (FIX-2374).
