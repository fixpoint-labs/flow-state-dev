---
"@flow-state-dev/shift-manager": patch
---

The Messages view shows a message another worker sent within a second, and stops reading every 5 seconds (FIX-2466). It reads the log again when a message is written, from any session, and on each Lab read, as before. On a host whose bus can miss a change (the SQLite store's), it still reads every 5 seconds. A later read that fails keeps the messages on screen; only a first read that fails shows.

Docs: packages/shift-manager/README.md (*Workstreams*: the message log is read when a message is written, not every few seconds).
