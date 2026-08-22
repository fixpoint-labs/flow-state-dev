---
"@flow-state-dev/patterns": patch
---

`eventActors`' two state-only steps — the initial task spawn and the re-emission tap — no longer echo their input onto their `block_trace` items (FIX-1214).
