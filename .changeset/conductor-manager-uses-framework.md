---
---

Internal only — hygiene in `labs/conductor` (private, unpublished lab). The
harness manager's block declarations now use the framework's own mechanisms:
`sequencerStateSchema` instead of hand-written state casts, a declared return
type instead of `as unknown as TaskWorker`, and `.validate()` on the sequencer
that declares an `outputSchema` (BP-025). No package surface changes and no
behaviour change.
