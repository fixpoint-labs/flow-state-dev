# hire-plane › it keeps a hired seat with its owner

**Issue:** FIX-1529
**Outcome:** A seat hired for one person in one organization stays there. A teammate cannot list, open, or run it. Another organization cannot either, including after the process restarts and the row is read back. The org roster's browser collection does not hand back that person's private row, and a flow whose collection pattern could resolve onto those rows is not admitted.
**Input:** `fixtures/input.json` — two orgs, three users, two seat ids, the private marker, and the wide pattern. Held-out: every id and the marker are read from the fixture and graded against HTTP responses and the `seen/*` rows the actions write. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router, in-memory stores, no model.
(a) The owner opens the seat and the action writes the fixture marker into her organization's `seen` row.
(b) The teammate's `POST` to open that seat is `404`, and so is the other organization's. Neither write creates a `seen` row.
(c) `GET /api/flows` for the owner lists the seat. The same call for the other organization, and with no identity, does not. A shared app flow stays listed for the other organization, and that organization can run it.
(d) After the seat is released and registered again under the other organization's pin, the owner's old session resumes as `404` and the marker is not written again.
(e) A private roster row holding the marker is invisible to the teammate's read through the browser collection: the action records `undefined`, and the marker is absent.
(f) Registering a flow that declares the fixture's wide pattern throws, and no `seen` row from that flow contains the marker.
(g) A stored row whose `owningOrgId` is the other organization is a reload problem. Opening the address it would have minted is `404`.

**Anti-game:** a hollow pass would assert that `ownerPin` is set, or that some request returned 404, without an owner run that actually writes the marker — both hold if every address 404s, and the pin field holds if admission never consults it. So the check MUST see the marker written by the owner, MUST see that same marker absent from the teammate's and the other organization's reads, MUST see the shared app flow still run for the other organization, and MUST grade the catalog by who is asking. It must not grade `pinOf` or the address string.
**Model:** n/a — handlers only. The property is who can open and read the seat, not model output.
**Run:** `pnpm tsx goals/hire-plane/keeps-a-hired-seat-with-its-owner/run.mts`
**Controls:** none in the runner. The red state is a source revert, so it fails for the reason a missing fence fails and not because the runner skipped a leg.
- Drop the collection pattern check in `packages/engine/src/context/resource-registry.ts`. Must FAIL leg (e) only.
- Make `rosterPatternOverlapsPrivate` return false in `packages/core/src/types/collection-patterns.ts`. Must FAIL leg (f) only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | `ef5228f8b` with the collection pattern check removed from `packages/engine/src/context/resource-registry.ts`, then restored | n/a | FAIL (expected) | **Leg (e) only.** `browser read returned` the JSON row whose `instructions` were `ACME-ONLY-ROADMAP-MARKER`, and `browser read contained the marker`. No other goal leg failed. Same revert, outside the goal: fence D expected instructions `undefined` and received `ALICE-PRIVATE: my research assistant`; the resource-collection pattern case expected `getOptional` of `positions/AAPL/history` to be undefined and received the collection ref. Restored with `git checkout -- packages/engine/src/context/resource-registry.ts`. |
| 2026-09-23 | `ef5228f8b` with `rosterPatternOverlapsPrivate` forced to `return false`, then restored | n/a | FAIL (expected) | **Goal leg (f) only:** `pattern workforce/[area]/[owner]/[seat] was admitted`. The other goal legs stayed green. Blast radius outside the goal, because that predicate is also the gate for a literally deep roster pattern: the engine fence test that registers `workforce/roster/**` failed at its first assertion (`expected to throw`), so the wide-pattern expects later in that same test did not run. The workforce test that defines `workforce/roster/**` failed the same way. The other 12 fence tests and the other 7 hire-plane tests stayed green. Restored with `git checkout -- packages/core/src/types/collection-patterns.ts`. |
| 2026-09-23 | `ef5228f8b` (fence restored; this goal is the check that ran against it) | n/a | PASS | `pnpm tsx goals/hire-plane/keeps-a-hired-seat-with-its-owner/run.mts` exit 0. Owner wrote `ACME-ONLY-ROADMAP-MARKER` at `acme.~alice.research`; teammate and globex got 404; catalog listed the seat for the owner only; resume after re-pin was 404; browser read was `undefined`; `workforce/[area]/[owner]/[seat]` was refused; a row owned by globex was a reload problem and did not open. Shared app still ran for globex. After the restore, fence 13 and workforce hire-plane 8 were green. |
