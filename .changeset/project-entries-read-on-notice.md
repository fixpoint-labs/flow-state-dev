---
"@flow-state-dev/shift-manager": patch
---

A project's workstreams show a change within a second, and stop reading every 5 seconds (FIX-2466). The project view and the project's group in the sidebar read the project and its workstreams again when one of them is written, from any session, and on each Lab read, as before. On a host whose bus can miss a change (the SQLite store's), they still read every 5 seconds. A later read that fails keeps the list on screen; only a first read that fails shows.

Docs: packages/shift-manager/README.md (*Workstreams*: a project's workstreams are read when one changes, not every few seconds).
