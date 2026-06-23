---
"@flow-state-dev/engine": patch
---

The filesystem store now persists request events to an append-only NDJSON file instead of rewriting the whole event log on every flush, making event persistence cost scale with new events rather than total log size; legacy JSON-array event files are migrated transparently on first write.
