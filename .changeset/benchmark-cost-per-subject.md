---
"@flow-state-dev/testing": patch
---

Surface per-subject cost in the benchmark scorecard and add Claude Sonnet 4.6 pricing. The ranking table now includes a `$/task` column (a subject's mean cost per cell) and a `score/$` column (mean quality per dollar), so cross-model comparisons are legible — a cheap orchestrated subject that nearly matches an expensive single-call one wins on `score/$` even when it loses on mean. The data already aggregated per subject; only the rendering and a Sonnet entry in the cost table were missing (unpriced models estimate to $0, which would have shown the expensive baseline as free). `claude-sonnet-4-6` is priced at $3/$15 per 1M input/output tokens. The `$/task` and `score/$` columns read a new `SubjectCategoryStat.costPerTaskUsd` field computed from the unrounded per-subject cost, so sub-cent costs that would round to $0 in the 4-decimal `costUsd` total keep their signal.
