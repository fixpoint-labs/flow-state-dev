# hire-plane › reload survives an unaddressable row

**Issue:** FIX-1536
**Outcome:** An app with no authentication that hires a seat at runtime does not take the rest of the roster down at the next boot. That hire lands under the development organization, whose id cannot be a seat address, so it can never come back as a seat. It comes back as one named problem, and every other organization's seats still reload, register and answer. A row stamped for a different organization is still refused, not minted.
**Input:** `fixtures/input.json` — the signed-in org and user, the dev user, the two seat ids, the stray org and seat id, and a marker. Held-out: every id is read from the fixture and graded against the reload result and a real run on the reloaded seat. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router, one in-memory store shared by three app instances (dev, signed-in, restarted), no model.
(a) The dev app's `hire` action, run with no identity, completes and leaves a roster row under `DEFAULT_ORG_ID`.
(b) The signed-in app's `hire` action completes for the named org.
(c) `reloadHiredSeats` over `[DEFAULT_ORG_ID, <named org>]` resolves. It returns `<named org>.<seat>`, names the dev row by org and key in `problems`, and the returned seat registers on the restarted app and completes an `answer` run.
(d) A row in the named org's cell stamped `owningOrgId: <stray org>` is a `cannot be registered under` problem, and no seat with its id is returned.

**Anti-game:** a hollow pass would check that `problems` is non-empty, which holds when reload names both bad rows and returns nothing else. So the check MUST see the named org's seat come back and answer a real run after the restart, MUST see the dev row named by its org and key, and MUST see the stray row refused rather than minted. It must not grade the address string alone.
**Model:** n/a — handlers only. The property is which stored rows come back as seats.
**Run:** `pnpm tsx goals/hire-plane/reload-survives-an-unaddressable-row/run.mts` (build `@flow-state-dev/workforce` first; the goal imports its `dist`).
**Controls:** none in the runner. The red state is a source revert, so it fails for the reason the bug fails.
- Revert `packages/workforce/src/roster/reload.ts` to `ffe2b6e26` (the manifest build outside the per-row guard), rebuild workforce. Must FAIL leg (c) only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | `636542bc6` with `reload.ts` reverted to `ffe2b6e26`, then restored | n/a | FAIL (expected) | **Leg (c) only:** `reload rejected, so no org's seats came back: Organization id "__fsd_default_org__" must be lowercase letters, digits, and single hyphens ...`. Legs (a) and (b) completed, so the dev hire really does write under the default org through the HTTP path. Restored with `git checkout HEAD -- packages/workforce/src/roster/reload.ts` and rebuilt. |
| 2026-09-23 | `636542bc6` (fix present) | n/a | PASS | Exit 0. Dev hire stored under `__fsd_default_org__`; reload over `[__fsd_default_org__, acme]` returned `["acme.support.ada"]` and 2 problems; `acme.support.ada` answered after restart; default-org row named as `organization "__fsd_default_org__", row "workforce/roster/lead"`; stray row refused as `owned by organization "globex" and cannot be registered under "acme"`. |
