---
---

Docs-only correction to three wrong claims about the delegation board: its ledger
does not survive a checkpoint resume (the board is generator-hosted, and only
sequencer blocks checkpoint), the research-team example's `chat` path needs a
search-provider key as well as a model key, and `maxIterations` is a per-worker
loop cap rather than a board-wide one. No behavior change.
