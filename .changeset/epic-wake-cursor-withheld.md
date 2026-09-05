---
---

Internal (workflows): `epic-wake` no longer logs a spec-review fold as "converged" when the refresh scout reported activity but no timestamp to advance the cursor to.

The PR-state schema's `required` list left out `latestActivityAt` even though its own description already called it required whenever `newSpecReviewEvents` or `newPrEvents` is true. A scout could satisfy the schema while omitting it, `cursorUsable` correctly refused to let the batch consume a review round, but the planner had no way to tell that refusal apart from a genuinely converged review — so it logged "spec converged" for a fold that never ran, and nothing told the coordinator the scout under-reported.

`latestActivityAt` is now required (still `['string','null']`, so a scout can say "no activity to date"). A row the planner can't act on for this reason is now logged as withheld — the fold is skipped rather than invented, and the next wake's scan retries.

The same misreport had a third cause: a spec the human had already approved, parked because the cross-spec coherence pass hasn't run, was also reported as converged and "awaiting the human gate" — the gate it was waiting on had already been given. That row now says what is actually holding it.

Fixing those one at a time was itself the problem: the planner's reporting branch kept re-deriving *why* a row didn't dispatch from its own hand-picked subset of the dispatcher's guards, and each round found another guard missing from that subset — most recently the refusals that sit ahead of the phase switch, so a row waiting on an unresolved human question was announced as held by the cross-spec pass and told to expect that pass to release it. The ordering now lives in one place both paths read, and a matrix check pins the two in agreement across the whole space rather than one case at a time. Each cause is pinned by a `verify.mjs` case, red against the unfixed script.
