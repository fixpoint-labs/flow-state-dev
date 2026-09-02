---
---

Internal (workflows): `epic-wake` no longer logs a spec-review fold as "converged" when the refresh scout reported activity but no timestamp to advance the cursor to.

The PR-state schema's `required` list left out `latestActivityAt` even though its own description already called it required whenever `newSpecReviewEvents` or `newPrEvents` is true. A scout could satisfy the schema while omitting it, `cursorUsable` correctly refused to let the batch consume a review round, but the planner had no way to tell that refusal apart from a genuinely converged review — so it logged "spec converged" for a fold that never ran, and nothing told the coordinator the scout under-reported.

`latestActivityAt` is now required (still `['string','null']`, so a scout can say "no activity to date"). A row the planner can't act on for this reason is now logged as withheld — the fold is skipped rather than invented, and the next wake's scan retries. Pinned by a `verify.mjs` case, red against the unfixed script.
