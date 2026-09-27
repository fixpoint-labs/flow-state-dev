---
"@flow-state-dev/react": patch
---

`useSession` takes `live: true` to hear requests the view didn't send: other tabs, other people, agents answering in the same session. Their finished items join `items` about a second after the server keeps them, each once, in the order a reload shows, and `childSessions` is re-read whenever a run starts or finishes. Off by default (FIX-1609).

`useSession` now tells items apart by request and item id, live or not. Two requests that each keep a keyed item with the same key both appear in `items`; before, the later one replaced the earlier, or a reload showed it twice.
