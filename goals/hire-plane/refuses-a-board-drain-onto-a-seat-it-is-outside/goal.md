# hire-plane › it refuses a board drain onto a seat it is outside

**Issue:** FIX-1534
**Outcome:** A task board hands a claimed row to a hired seat only when the session running the drain is inside that seat's pin. A board in another organization, or a teammate's board aimed at someone's private seat, is refused before anything is written: the seat never runs, no session is minted on it, and the row is settled as errored instead of sitting claimed by a child that was never going to run it. The refusal reads exactly like an address the process does not hold. The owner's drain through the same board and seats runs.
**Input:** `fixtures/input.json` — two orgs, three users, an org-pinned seat address, a user-pinned seat address, an unregistered address, and the marker the seat writes. Held-out: every id and the marker are read from the fixture and graded against the ledger rows, session records and `seen/*` rows the seat writes. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router, in-memory stores, no model. One org-scoped ledger, the same logical board on the board flow and on the seat kind. Each leg boots a fresh process, because a teammate shares the owner's org ledger.
(a) The owner's drain completes both rows, and both seats write the fixture marker as the owner.
(b) The other organization's drain leaves both rows `errored` with no `claimedBy`, mints no session on either seat for that user, and writes no marker in either organization.
(c) The teammate's drain leaves the private seat's row the same as (b), and completes the org seat's row with the marker written as the teammate.
(d) The seam's sentence for a pinned-out seat equals the sentence for the unregistered address once the address is blanked, and both are `flow-not-found`.

**Anti-game:** a hollow pass would assert only that the seat's marker is absent. That holds without this fix: admission refuses the child before any block, so the seat never ran even when the row was stranded. The check MUST grade the row (`errored`, unheld) and the absence of a minted session, MUST see the owner's drain write the marker so absence means refusal, and MUST see the teammate's org seat run so the refusal is by pin and not by board.
**Model:** n/a — handlers only. The property is which rows a board may hand to which seat, not model output.
**Run:** `pnpm tsx goals/hire-plane/refuses-a-board-drain-onto-a-seat-it-is-outside/run.mts` (with no `FSDEV_DEFAULT_MODEL` / `FSDEV_INTENT_*` in the env: this goal declares no intents, and the model resolver refuses an override that has nothing to apply to)
**Controls:** none in the runner. The red state is a source revert, so it fails for the reason a missing check fails and not because the runner skipped a leg.
- Revert the pin check in the dispatch seam, `packages/engine/src/context/create-request-host.ts`. Must FAIL legs (b), (c) and (d), and leave (a) green.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | `ffe2b6e26` + this change, with `create-request-host.ts` restored to `ffe2b6e26`, then restored | n/a | FAIL (expected) | **Legs (b), (c), (d); (a) green.** (b) `t-org-seat ended in_progress, not errored`, `is still claimed by {"sessionId":…,"requestId":…}`, `1 session(s) minted on acme.eng.lead for mallory@globex`, and the same three for `acme.~alice.research`. (c) the same three for the private seat as `bob@acme`. (d) `refusals differ`: the pinned-out rows carried no refusal. No leg reported a marker written, which is the anti-game above: admission alone kept the seat from running. |
| 2026-09-23 | `ffe2b6e26` + this change | n/a | PASS | Owner's drain ran `acme.eng.lead` and `acme.~alice.research` (marker `ACME-SEAT-RAN-MARKER`); globex's drain errored both rows unheld with no session minted and no marker; the teammate's drain errored the private row and ran the org seat; a pinned-out refusal read `… flow-not-found — … no flow instance "acme.eng.lead" is registered in this process, so the task entry "work" cannot be resolved`, the same sentence as `acme.eng.ghost`. |
