---
"@flow-state-dev/core": patch
"@flow-state-dev/contracts": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

`ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
