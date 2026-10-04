# hire-plane › reload survives an unaddressable row

**Issue:** FIX-1536
**Outcome:** An app with no authentication that hires a seat at runtime does not take the rest of the roster down at the next boot. That hire lands under the development organization, and comes back as a seat at that organization's escaped address (FIX-1757; before it, the id could not be an address and the row came back as one named problem). Every other organization's seats still reload, register and answer. A row stamped for a different organization is still refused, not minted.
**Input:** `fixtures/input.json` — the signed-in org and user, the dev user, the two seat ids, the stray org and seat id, and a marker. Held-out: every id is read from the fixture and graded against the reload result and a real run on the reloaded seat. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router, one in-memory store shared by three app instances (dev, signed-in, restarted), no model.
(a) The dev app's `hire` action, run with no identity, completes and leaves a roster row under `DEFAULT_ORG_ID`.
(b) The signed-in app's `hire` action completes for the named org.
(c) `reloadHiredSeats` over `[DEFAULT_ORG_ID, <named org>]` resolves. It returns `<named org>.<seat>` and the dev row at the escaped default-org address, written out in the runner from the documented escape rule (not taken from `seatAddress`), and names no default-org problem. Both seats then answer an `answer` run over HTTP: the named seat on the restarted signed-in app, and the dev seat on a restarted app with no resolver, called with no identity at its escaped address.
(d) A row in the named org's cell stamped `owningOrgId: <stray org>` is a `cannot be registered under` problem, and no seat with its id is returned.

**Anti-game:** a hollow pass would check that `problems` is non-empty, which holds when reload names both bad rows and returns nothing else. So the check MUST see the named org's seat come back and answer a real run after the restart, MUST see the dev row named by its org and key, and MUST see the stray row refused rather than minted. It must not grade the address string alone.
**Model:** n/a — handlers only. The property is which stored rows come back as seats.
**Run:** `pnpm tsx goals/hire-plane/reload-survives-an-unaddressable-row/run.mts` (build `@flow-state-dev/workforce` first; the goal imports its `dist`).
**Controls:** none in the runner. The red state is a source edit, so it fails for the reason the bug fails.
- Break default-org admission: in `packages/engine/src/context/instance-pin.ts` `pinMismatchReason`, return `"owning-org"` whenever `pin.orgId === DEFAULT_ORG_ID`, then rebuild engine. Must FAIL leg (c) only, with the dev seat answering `404 Unknown flow` at its escaped address.
- (Historical, pre-FIX-1757) reverting `packages/workforce/src/roster/reload.ts` to `ffe2b6e26` failed leg (c) by rejecting the reload. Since the default org became addressable, that revert no longer turns this goal red.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | `636542bc6` with `reload.ts` reverted to `ffe2b6e26`, then restored | n/a | FAIL (expected) | **Leg (c) only:** `reload rejected, so no org's seats came back: Organization id "__fsd_default_org__" must be lowercase letters, digits, and single hyphens ...`. Legs (a) and (b) completed, so the dev hire really does write under the default org through the HTTP path. Restored with `git checkout HEAD -- packages/workforce/src/roster/reload.ts` and rebuilt. |
| 2026-09-23 | `636542bc6` (fix present) | n/a | PASS | Exit 0. Dev hire stored under `__fsd_default_org__`; reload over `[__fsd_default_org__, acme]` returned `["acme.support.ada"]` and 2 problems; `acme.support.ada` answered after restart; default-org row named as `organization "__fsd_default_org__", row "workforce/roster/lead"`; stray row refused as `owned by organization "globex" and cannot be registered under "acme"`. |
| 2026-10-04 | `d5225ecd8` + FIX-1757 (org escaped into the address) | n/a | PASS | Leg (c) re-pointed: the default org is now addressable. Reload returned `["%5F%5Ffsd%5Fdefault%5Forg%5F%5F.lead","acme.support.ada"]` and 1 problem (the stray row, refused as before); `acme.support.ada` answered after restart. |
| 2026-10-04 | FIX-1757 `a584e0a83` + this change, default-org admission broken in `instance-pin.ts`, then restored | n/a | FAIL (expected) | **Leg (c) only:** `%5F%5Ffsd%5Fdefault%5Forg%5F%5F.lead did not answer over HTTP on the resolver-less host: {"http":404,"detail":{"error":"Unknown flow \"%5F%5Ffsd%5Fdefault%5Forg%5F%5F.lead\""}}`. Restored and rebuilt. |
| 2026-10-04 | FIX-1757 `a584e0a83` + this change | n/a | PASS | Exit 0. The dev seat came back at `%5F%5Ffsd%5Fdefault%5Forg%5F%5F.lead` (expected address computed independently of `seatAddress`) and answered over HTTP with no identity on a resolver-less host; `acme.support.ada` answered on the signed-in host; stray row refused. |
