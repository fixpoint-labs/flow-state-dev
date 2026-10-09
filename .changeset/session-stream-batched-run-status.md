---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

A session stream now opens on a session with many child runs in a fixed number of request reads instead of two per run, so on the filesystem store a hundred runs open in well under a second rather than several. `RequestListOptions.sessionId` now also accepts an array, matched by set membership (an empty array matches nothing), which custom request stores must honor (FIX-1702).
