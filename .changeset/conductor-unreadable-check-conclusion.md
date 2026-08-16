---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — a check conclusion conductor cannot read no longer counts as a passing suite.

Aggregating a commit's check runs tested only for conclusions known to *fail*. A run reported as `completed` whose conclusion was missing, `null`, or a value GitHub introduces later matched neither the pending branch nor the failure branch, so it fell through contributing nothing — and if every other run passed, the suite aggregated to `success`. That clears `awaiting_ci` and exposes the merge gate on a check that never reported an accepted passing conclusion.

The passing conclusions are now a whitelist (`success`, `neutral`, `skipped`), and a completed run outside both sets counts as **pending**. Pending rather than failure because an unreadable conclusion is not evidence of a red build: `failure` routes to repair, which would spend a paid dispatch answering a suite that may be perfectly green, and the commonest case is the transient one — `completed` with the conclusion not yet set — which the next tick resolves on its own.

This brings the check-run path in line with the two siblings that already read this way: classic commit statuses in the same file, and the webhook path in `github/signals`, which applies exactly these three passing conclusions.
