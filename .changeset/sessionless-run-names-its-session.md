---
"@flow-state-dev/engine": patch
---

A run that starts with no session id (a scheduled fire, for one) now records the one-off session it ran in on its request record and on any suspension it parks on (FIX-2888). Listing a session's requests, including the DevTool's Trace tab, finds those runs, and stopping or continuing a parked sessionless run continues it in the same session instead of a new one. Records written before this name no session and read as they did.

Docs: none; this makes existing request listings behave as documented.
