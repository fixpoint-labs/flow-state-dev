---
---

Internal (workflows): `epic-wake` no longer acts on a Linear refresh that answers with UUIDs.

The refresh scout was asked for each issue's "id" and "the ids of any open blocked-by relations", and Linear has two ids per issue. The wake matches rows by the human identifier (`LAB-152`), so a scout that returned issue UUIDs matched nothing — every child read as newly discovered and every carried row as unobserved — and one that returned *relation* UUIDs in `blockedBy` named a blocker nothing could resolve, stranding the row for the rest of the epic. Both happened in production.

The prompt now says which id it wants, with an example entry. The wake drops any entry whose `id` or `blockedBy` is not identifier-shaped, whole, and logs it: the issue reads as unobserved that wake (carried state stands, no blocker clears, nothing is discovered) and the next wake retries. Nothing is invented. Pinned by one case in `verify.mjs`.
