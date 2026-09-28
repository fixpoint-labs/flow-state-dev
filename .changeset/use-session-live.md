---
"@flow-state-dev/react": patch
---

`useSession` takes `live: true` to hear requests the view didn't send: other tabs, other people, agents answering in the same session. Their finished items join `items` about a second after the server keeps them, each once, in the order a reload shows, and `childSessions` is re-read whenever a run starts or finishes. Off by default (FIX-1609).

`useSession` now tells items apart by request and item id, live or not. Two requests that each keep a keyed item with the same key both appear in `items`; before, the later one replaced the earlier, or a reload showed it twice.

A live view opens its stream from the snapshot's `at`, so nothing kept after the snapshot is missed however long the snapshot took. Once a live view holds a finished copy of an item, a copy still being written never replaces it, whichever arrives first. A keyed item emitted twice keeps its later copy (by the server's `ts`, then `itemIndex`), whichever stream or snapshot brings it last.

The user's message a view shows while a request is sent gives way to the server's copy from either stream, so it no longer shows twice when the view's own stream drops first. An item that arrives live stays in view until a snapshot requested after it arrived, however long an earlier snapshot takes to land.

A snapshot read never undoes a newer one: when two are in flight, the one requested later wins, and an earlier one landing after it is dropped with the session detail read beside it. A session switch retires every read in flight. A history longer than a page is read so that no item is skipped when a request is removed or a keyed item moves between two pages: the read starts over, and fails after five tries rather than show part of the history as whole. It starts over too when a later page comes from another session that took the id. A snapshot read that lands, from `refresh()` or anywhere else, takes away the `error` an earlier failed snapshot read set, including the five-tries error; it leaves an error from anything else, such as a failed action, and one set by a read requested after it.

A live view's stream follows the session its snapshot read. When the session is deleted and its id used again, the stream stops; once a snapshot of the new session lands, the stream opens again on that one.

With `live: true`, once the stream has named the runs, a reconnect that fails, a refusal, or the session gone keeps the rows and raises `childSessionsStale`, until a connection names the runs again, or for good.
