# hire-plane › it repairs a seat whose kind was cut

**Issue:** FIX-1621
**Outcome:** An app ships a release that cuts a seat kind. Every stored seat hired into it stops coming back, and the start names each one. A person can now ask which stored seats don't come back and why, and clear each one on their approval: retire it, or re-hire it onto a kind the app still carries. The next start names no refused seat, the re-hired seats answer at their old addresses, and the team list shows only seats that are hired, including leaving out a seat fired before this change.
**Input:** `fixtures/input.json`: the organization and person, the cut kind and the kept kind, the setting the kept kind starts requiring, and five seat ids (one to retire, one to re-hire after its kind was cut, one the kept kind now refuses, one healthy, one fired before this change). Held-out: every id and kind is read from the fixture; swapping any of them must still pass.
**Signal:** one app opened four times, each start its own process, over one SQLite file; no model.
1. Start 1 (the release that carried both kinds) hires the five seats through the `hire` action. The fifth is then left the way an earlier fire left it: roster row gone, inventory row kept (`1:hired`, `1:fired-before-seeded`).
2. Start 2 (the cut kind gone, the kept kind requiring the setting) names exactly the three broken rows (`2:start-names-each`). `brokenSeats` lists exactly those three, two `kind-gone` and one `refused` (`2:read-lists-exactly`), with the same row and detail text the start printed (`2:read-agrees-with-start`). A retire raised as a `human_approval` and answered Deny changes the row and leaves it listed (`2:deny-changes-nothing`). Three asks (retire, two re-hires) are raised and left pending (`2:asks-pending`).
3. Start 3 is a restart with the asks still open; the start still names all three (`3:still-broken-after-restart`), and the person approves each through the resume route (`3:approved`).
4. Start 4 names **zero** problems (`4:no-refused-seat`), the read lists none (`4:read-empty`), the retired seat's inventory row is gone (`team-list:retired-row-gone`), the team list (inventory joined with roster) lists neither the retired seat nor the earlier-fired one (`team-list:no-cut-seat`) and lists the three seats still hired (`team-list:hired-seats-listed`), and each of those answers an `answer` run at its old address on the kept kind (`4:answers:<seat>`).

**Anti-game:** a hollow pass would grade what `fire` or `rehire` returned, or a mocked store. So every claim is read back by a later process from the SQLite file, the HTTP router or the start's own report: never a block's return value except the read's, which is the surface under test. The read is graded against the start's report line for line, so a read that guessed its own list fails.
**Model:** n/a. The blocks are model-free; the model-driven ask is FIX-1719's.
**Run:** `pnpm tsx goals/hire-plane/repairs-a-seat-whose-kind-was-cut/run.mts`
**Controls:**
- `GOAL_CONTROL=fire-keeps-inventory` — retire is fire as it was before this change: roster row deleted, address released, inventory row kept. Must FAIL `team-list:retired-row-gone` only. `team-list:no-cut-seat` still passes under it, because the team-list join hides a row with no roster row; that is the read side of the same rule, and why the inventory row itself is graded.

On today's `main` the run fails at start 2: `createSeatHireBlocks` has no `brokenSeats` or `rehire`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
