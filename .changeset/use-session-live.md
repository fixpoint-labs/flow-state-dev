---
"@flow-state-dev/react": patch
---

`useSession` takes `live: true` to hear requests the view didn't send: other tabs, other people, agents answering in the same session. Their finished items join `items` about a second after the server keeps them, each once, in the order a reload shows, and `childSessions` is re-read whenever a run starts or finishes. Off by default (FIX-1609).

`useSession` now tells items apart by request and item id, live or not. Two requests that each keep a keyed item with the same key both appear in `items`; before, the later one replaced the earlier, or a reload showed it twice.

A live view opens its stream from the snapshot's `at`, so nothing kept after the snapshot is missed however long the snapshot took. Once a live view holds a finished copy of an item, a copy still being written never replaces it, whichever arrives first. A keyed item emitted twice keeps its later copy (by the server's `ts`, then `itemIndex`), whichever stream or snapshot brings it last.

The user's message a view shows while a request is sent gives way to the server's copy from either stream, so it no longer shows twice when the view's own stream drops first. An item that arrives live stays in view until a snapshot requested after it arrived, however long an earlier snapshot takes to land.
