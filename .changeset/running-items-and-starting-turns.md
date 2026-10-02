---
"@flow-state-dev/engine": patch
"@flow-state-dev/harness-manager": patch
---

A running request's items are now readable while it runs on the in-memory stores too, and a message sent to a coding run whose harness hasn't named its session yet is held until it does instead of being refused as a run that can't continue (FIX-1735).
