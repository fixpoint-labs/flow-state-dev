---
---

Trading Desk: make headless verification a first-class, fsdev-native workflow in
the private `@flow-state-dev/trading-desk` example. A zero-model `runSummary`
flow action projects the stored decision snapshot, memos, and stop-state into a
machine-readable `RunSummary` (final rating + clamps, target weight + mandate
gates, stop reason, per-memo status, session id). An agent verifies a desk change
by driving raw `fsdev run` directly — `analyze --capture --quiet` then
`runSummary --capture --quiet` from `labs/trading-desk` — and reading the summary
capture file; the `runSummary` capture is the artifact, and the analyze capture's
event log is the trace on demand. A new `verify-trading-desk` skill teaches this
two-step plus the record→replay verification ladder (cheap `fixture` runs by
default; a one-time `record` run to populate fixtures when the full flow needs
data the corpus lacks). The earlier wrapper scripts (`run.mts`, `batch.mts`,
`harness.ts`, `lib.ts`) are removed — they re-implemented what `fsdev run` already
does; batch sweeps belong to the eval-suite (FIX-790). The `goals/` smoke check
now drives the raw two-step over a single NVDA fixture run. Internal-only — no
publishable package surface changes.
