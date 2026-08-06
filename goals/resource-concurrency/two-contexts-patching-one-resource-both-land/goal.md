# resource-concurrency › it two-contexts-patching-one-resource-both-land

**Issue:** FIX-992
**Outcome:** A flow author mutates a resource from two requests that happen to overlap, and neither mutation disappears. Before this, whichever request saved second overwrote the first with its own pre-race snapshot — silently, with no error anywhere, so the only symptom was a field that used to have a value and now doesn't.
**Input:** the `WRITERS` table in `run.mts` — one `(requestId, field, value)` row per concurrent context. Held-out: the check derives every expectation from that table rather than hardcoding a state shape, so changing the field names, the values, or the number of writers still grades a correct implementation correctly and still fails a losing one.
**Signal:** three `createExecutionContext` calls over one SQLite file, all constructed before any of them writes (so all three hold the same pre-race view), each patching a **different** field of the same session resource. The store is then closed and **reopened**, and the durable row must carry all three fields at `version === WRITERS.length`.
**Anti-game:** a hollow pass would (a) patch the **same** field from each context — that passes under a value-only design that never merges, which is exactly the design this issue rejected; (b) assert on a context's in-memory `ref.state`, which can show a correct merge while the persisted row lost a field, since the cache is written per key in place and the store write is what races; or (c) build the contexts lazily so each one loads *after* the previous write committed, turning the race into a sequence that last-write-wins also survives. The check must therefore use distinct fields, read back through a **reopened** store connection, and construct all contexts up front. The version assertion is the independent witness: three committed writes to a previously-absent key must leave it at exactly 3, so a merge arrived at with fewer committed writes (or with a blind `"any"` write that skipped the version) fails even if the fields happen to look right.
**Model:** n/a — resource persistence and CAS retry, no generator anywhere in the flow.
**Run:** `pnpm tsx goals/resource-concurrency/two-contexts-patching-one-resource-both-land/run.mts`

> Proven to reach its branch: run against `origin/main` at `5685a738` (the store contract merged, the registry driver not yet), this check **fails** with `field "claimedBy" ... was lost` and `field "note" ... was lost` — only the last writer's field survives, which is the last-write-wins signature. The store-level CAS from the previous sub-PR is on `main` and does not by itself make this pass, which is the point of running it here rather than trusting the store conformance suite.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-05 | 5685a738 | n/a | FAIL (expected) | Pre-change baseline. Two of three contexts' fields absent from the reopened row; only the last writer's `attempts` survived. Confirms the check discriminates. |
| 2026-08-05 | fix/fix-992-b | n/a | PASS | Reopened SQLite row was `{"claimedBy":"worker-a","note":"in progress","attempts":3}` at version 3 — all three concurrent contexts' fields present, one version bump per committed patch. |
