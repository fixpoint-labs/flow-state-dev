---
---

Trading Desk: add a run-quality evaluation suite to the private
`@flow-state-dev/trading-desk` example. A zero-model `runArtifacts` flow action
projects a stored `analyze` run into a full scored-artifact bundle (the deeper
sibling of `runSummary`). Over it, a `eval/` stack scores the run two ways: a
deterministic invariant layer (pure code, zero model spend) that catches internal
contradictions — a rating outside its band, incoherent scenario probabilities, a
committed size that ignores the mandate gates, snapshot/memo mirror drift,
dishonest valuation abstention, malformed citations — and a blinded LLM-judge layer
(four rubric dimensions run directly through `utility.analyzer` + `testBlock` — the
same internal path as `analyzerScorer`, preserving raw findings — with a judge model
pinned distinct from the desk's generators and k repeats with mean±std).
The `pnpm eval` harness
(`sweep` / `eval` / `variance`) batches runs and appends one separable
`QualityRecord` line per run to a JSONL scoreboard with a detail sidecar; a variance
mode characterizes judge noise (Krippendorff's alpha across ≥2 sessions, 2·SE
bands). The mandate-gate math and the five-tier rating enum are extracted to shared
libs (behavior-neutral) so the invariants recompute against the same formulas the
pipeline used. Internal-only — no publishable package surface changes.
