# hire-plane › it keeps the debug listing on the hire plane

**Issue:** FIX-1535
**Outcome:** With debug endpoints switched on, which is what `fsdev dev` does, a session's debug resource listing shows only the hire rows that session's user may see. A teammate in the same organization does not get another user's private hire row, its instructions, or its count. Another organization gets neither that row nor the org roster. The owner still sees her own row, and a teammate still sees the org-visible roster.
**Input:** `fixtures/input.json`: two orgs, three users, a private seat id, an org seat id, and one marker for each row. Held-out: every id and both markers are read from the fixture and graded against the debug responses. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router with `debugEndpointsEnabled: true`, in-memory stores, no model. The owner's `hire` action writes her private row through the workforce's branded private writer and one org row through the org roster, both through the resource handle. Each leg reads `GET …/debug/resources`, `…/debug/resources/privateRoster/items` and `…/debug/resources/roster/items` from its own session.
(a) The owner's hire completes. Her debug reads contain the private marker and her private item count is 1.
(b) The teammate's debug reads are all 200, contain no private marker, list no private topic, report a private item count of 0, and list exactly the org seat on the org roster, marker included.
(c) The other organization's debug reads are all 200 and contain neither marker.

**Anti-game:** a hollow pass would assert that the teammate's listing is empty, or that some debug request returned 404. Both hold if the debug routes list nothing for anyone. So the check MUST see the owner's own debug read return her marker, MUST see the teammate still receive the org-visible row, and MUST grade the teammate's reads for the private marker in every body, including the tree's count.
**Model:** n/a (handlers only). The property is which stored rows a debug read returns, not model output.
**Run:** `pnpm tsx goals/hire-plane/keeps-the-debug-listing-on-the-hire-plane/run.mts` (after `pnpm --filter @flow-state-dev/workforce... build`)
**Controls:** none in the runner. The red state is a source revert, so it fails for the reason a missing fence fails and not because the runner skipped a leg.
- Drop `privateRosterAdmits` from `collectionKeyVisible` in `packages/engine/src/routes/debug-snapshot.ts` and rebuild the engine. Must FAIL leg (b) only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | `c0960b6d8` with `privateRosterAdmits` dropped from `collectionKeyVisible`, engine rebuilt, then restored | n/a | FAIL (expected) | **Leg (b) only:** `teammate debug listing contained the owner's marker`, `teammate private topics ["~alice/research"]`, `teammate private itemCount was 1`. Legs (a) and (c) stayed green. |
| 2026-09-23 | `c0960b6d8` (fence restored, engine rebuilt) | n/a | PASS | Exit 0. alice hired research; her debug listing showed `ALICE-ONLY-HIRE-MARKER` (count 1). bob's debug listing showed `eng.lead` only (private count 0, marker absent). globex's debug listing showed neither marker. |
