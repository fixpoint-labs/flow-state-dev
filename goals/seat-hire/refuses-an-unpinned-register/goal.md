# seat-hire › it refuses an unpinned register

**Issue:** FIX-1529 (soft-fence on FIX-1525 / FIX-1526)
**Outcome:** A hired seat cannot join the live roster without an owner pin `{ orgId, userId? }` taken from the hire row's roster owner. An unpinned register leaves the address empty. A hire that succeeds pins the org that owns the roster row. A seat whose address reads like another org still carries the pin it was given, not the name in the address.
**Input:** `fixtures/input.json` — two organizations (`orgId`, `otherOrg`), a manager seat, the seat a hire mints, a different seat used only for the unpinned refuse, and a foreign seat id whose address starts with the other org. Held-out: swapping those strings must still pass a correct implementation. The two orgs must differ, or the pin-vs-address leg has nothing to grade. The unpinned seat must not be the hired seat, or a control that admits it would take the hire's address.
**Signal:** Three legs on one run. (a) `registerHiredSeat` with no pin throws and the live roster does not gain the seat. (b) A manager seat names `hire` under `orgId`; the register callback receives `{ orgId }` from that roster cell, the address `${orgId}.${seatId}` is live, and the hire's return names that address. (c) The same register path admits a seat whose id is `${otherOrg}.${foreignSeat}` with pin `{ orgId }`; the recorded pin is `orgId`, not `otherOrg`. PASS prints the hire address and both pins.
**Anti-game:** A hollow pass would assert that `registerHiredSeat` throws while hire still calls `register(seat)` with no pin — so this check MUST grade the pin the hire tool actually handed the live roster, not only the helper. A hollow pass would also assert `pin.orgId` equals the first segment of the address — true on every ordinary hire, and true of a writer that parses ownership off the id — so leg (c) MUST use an address whose first segment is the other org. The check MUST grade the live map (empty after the refuse, present after hire), not the error string alone.
**Model:** n/a — the hire tool is a handler; the generator is only how a seat names it.
**Run:** `pnpm tsx goals/seat-hire/refuses-an-unpinned-register/run.mts`
**Controls:**
- `GOAL_CONTROL=unpinned-ok` — skip the refuse and admit with no pin. Must FAIL, naming leg (a).
- `GOAL_CONTROL=pin-from-address` — admit the foreign seat with a pin parsed from its id. Must FAIL, naming leg (c).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | this PR (`goals/seat-hire/refuses-an-unpinned-register`) | n/a | **PASS** | Unpinned `acme.eng.stray` stayed empty. Hire of `acme.eng.ada` through the manager's `hire` tool pinned `{"orgId":"acme"}` from the roster cell. `globex.eng.lead` carried `{"orgId":"acme"}`, so the address's first segment did not win. |
| 2026-09-23 | same | n/a | **FAIL (expected)** | `GOAL_CONTROL=unpinned-ok` — admitted with no pin. Red on leg (a) only: *registerHiredSeat admitted a hired seat with no pin*; *acme.eng.stray is live after an unpinned register*. Hire of `eng.ada` stayed green. |
| 2026-09-23 | same | n/a | **FAIL (expected)** | `GOAL_CONTROL=pin-from-address` — foreign seat pinned from its id. Red on leg (c) only: *globex.eng.lead recorded pin {"orgId":"globex"}, wanted { orgId: "acme" }*. |
