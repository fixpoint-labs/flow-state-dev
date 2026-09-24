# hire-plane › it keeps a private team in the org it was built in

**Issue:** FIX-1538 (the assembled proof of epic FIX-1528, ER-15)
**Outcome:** A seat Alice hires for herself while signed in to Acme stays in Acme and stays hers, at every door and in what it saves. Alice signed in to Globex, and Bob in Acme, cannot list, open, run, resume, drain work onto, or see it in the debug listing. What the seat saved for her is read back by her own next Acme run, and not by her Globex seat or Bob's Acme seat of the same kind, which both start empty.
**Input:** `fixtures/input.json`: two orgs, the owner and a teammate, the seat id, the owner's hire instructions and the marker she saves. Held-out: every id, the instructions and the marker are read from the fixture and graded against HTTP responses, the task ledger, the session store and the `seen/*` rows each run writes. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router and worker pool, in-memory stores, debug endpoints on, no model. Each person hires a private `research` seat through the app's owner-private roster collection; the host reloads the roster with `reloadHiredSeats` and registers each seat under the pin copied from its row. Callers: Alice in Acme (owner), Alice in Globex, Bob in Acme.
(a) The owner opens her private seat and its `save` action writes the marker to a shared user-scoped collection and to her user state.
(b) `GET /api/flows` lists the seat for the owner and for neither other caller.
(c) Opening a session on it is `404` for both others.
(d) A session-less action on it is `404` for both, and no `seen` row is written.
(e) An action on the owner's session is refused for both, and no `seen` row is written.
(f) A board in Globex drained by Alice, and a board in Acme drained by Bob, onto the seat: the row ends `errored` and unheld, no session is minted on the seat for that (user, org), and the seat's worker never runs.
(g) Neither other caller's debug resource listing contains the owner's private roster row; the owner's does.
(h) The owner's next run on the seat, in a fresh session, reads the marker from the collection and from user state.
(i) Alice's own Globex seat of the same kind reads no marker.
(j) Bob's Acme seat of the same kind reads no marker.

**Anti-game:** a hollow pass would grade 404s and empty reads alone, which all hold if every seat is unreachable or stores nothing. So the check MUST see the owner's own save complete and her next run read the marker back from both halves (h), MUST see her debug listing contain her row (g), and MUST mint the three seats from real roster rows through `reloadHiredSeats` rather than hand-writing a pin. It must not grade storage keys, `ownerPin`, or the address string. (i) and (j) grade what a seat's own run read, not what the store holds.
**Model:** n/a (handlers only). The property is which cell a seat's run reads, and who reaches the seat, not model output.
**Run:** `pnpm tsx goals/hire-plane/keeps-a-private-team-in-the-org-it-was-built-in/run.mts` (after `pnpm --filter "@flow-state-dev/workforce..." build`)
**Controls:** none in the runner. The red state is a source revert of the key derivation in `packages/engine/src/stores/scope-keys.ts`, then an engine rebuild, so it fails the way a missing cell fails.
- Make `sharedUserKey` return today's key (the bare person) for a pinned flow. Must FAIL leg (i) only: (h) stays green because the owner still reads her own writes, and (j) stays green because Bob's person key was never Alice's.
- Drop the person from the cell, keying it by org alone. Must FAIL leg (j) only.

The door legs (b)–(g) have their own source-revert controls in the sibling goals that introduced them; neither control above touches a door, so they stay green here by design.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-24 | `7f51403a4` with `sharedUserKey` returning the bare person for a pinned flow, engine rebuilt, then restored | n/a | FAIL (expected) | **Leg (i) only:** `globex.~alice.research read {"seat":"globex.~alice.research","as":"alice@globex","notes":["ACME-ALICE-SAVED-MARKER"],"state":"ACME-ALICE-SAVED-MARKER"}`. Legs (a)–(h) and (j) stayed green. Same revert, outside the goal: engine 10 of 2687 failed, all in the two new seat-cell suites; scheduled 2 of 81 failed, both in the new seat-schedule suite. No pre-existing test failed. |
| 2026-09-24 | `7f51403a4` with the person dropped from the cell (org alone), engine rebuilt, then restored | n/a | FAIL (expected) | **Leg (j) only:** `acme.~bob.research read {"seat":"acme.~bob.research","as":"bob@acme","notes":["ACME-ALICE-SAVED-MARKER"],"state":"ACME-ALICE-SAVED-MARKER"}`. Legs (a)–(i) stayed green. |
| 2026-09-24 | `7f51403a4` (derivation restored, engine rebuilt) | n/a | PASS | Exit 0. alice@acme saved `ACME-ALICE-SAVED-MARKER`; for alice@globex and bob@acme the seat was unlisted, open 404, run 404, resume refused, drain errored unheld with no session minted, debug listing without the private row. The owner's next run read the marker from notes and state; `globex.~alice.research` and `acme.~bob.research` read `notes: []`, `state: null`. |
