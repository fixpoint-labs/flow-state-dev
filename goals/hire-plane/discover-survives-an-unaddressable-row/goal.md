# hire-plane › discover survives an unaddressable row

**Issue:** FIX-1541
**Outcome:** A session asking the discovery door who it can hand work to still gets its seats when one stored hire can never be a seat. An app with no authentication runs as the development organization, whose id cannot be a seat address, so a runtime hire there leaves a row that can never be listed. Before, that one row blanked the whole seat listing for the org. Now the row is left out and every other seat is listed. The same holds for a seat id carrying the user-owned `~` marker in a signed-in org. A row stamped for a different organization is still withheld, not re-bound to the reading org.
**Input:** `fixtures/input.json` — the dev user, the dev hire's seat id, a file-declared seat and its purpose, the signed-in org, user, seat id and instructions, the `~` seat id, and the stray org and seat id. Held-out: every id and purpose is read from the fixture and graded against the discovery door's output. Swapping any of them must still pass.
**Signal:** against `createFlowState`'s HTTP router, one in-memory store shared by a dev app (no resolver) and a signed-in app, no model. The door is `discoveryTools` over `workforceManifestSources` with a hired-roster key, which is what `createWorkforceCapability` builds, run as an action.
(a) The dev app's `list` and `hire` actions complete with no identity, and the hire leaves a roster row under `DEFAULT_ORG_ID`.
(b) The dev app's `discover` completes. Its seats domain carries no `problem` and lists the file-declared seat with the fixture's purpose.
(c) The signed-in org hires one seat, and its cell also holds a `~` row and a row stamped `owningOrgId: <stray org>` with an inventory row of its own. `discover` as that org carries no `problem` and lists `<org>.<seat>` with the fixture's instructions.
(d) No entry `<org>.<stray seat>` is listed.

**Anti-game:** a hollow pass would check that `discover` completed, which holds on the bug too: the door degrades a throwing domain to `{ entries: [], problem }` and the action still completes. So the check MUST see the seats domain carry no `problem` AND list the specific seat with the specific purpose from the fixture. Leg (d) has an inventory row for the stray address on purpose, so a fence that re-bound the row to the reading org would list it and fail.
**Model:** n/a — handlers only. The property is which stored rows the door lists.
**Run:** `pnpm tsx goals/hire-plane/discover-survives-an-unaddressable-row/run.mts` (build `@flow-state-dev/workforce` first; the goal imports its `dist`).
**Controls:** none in the runner. The red state is a source revert, so it fails for the reason the bug fails.
- Revert `packages/workforce/src/manifest-sources.ts` to `9041a2c28` (the hired-roster merge with no per-row guard), rebuild workforce. Must FAIL legs (b) and (c) only.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-23 | `9041a2c28` + this change, with `manifest-sources.ts` reverted to `9041a2c28`, then restored | n/a | FAIL (expected) | **Legs (b) and (c) only:** `[b] the dev org's seats domain degraded to a problem: Organization id "__fsd_default_org__" must be lowercase letters, digits, and single hyphens ...`, `[b] the file-declared seat was not listed with its purpose: []`, `[c] acme's seats domain degraded to a problem: seat id "~support.bo" starts with "~" ...`, `[c] acme.support.ada was not listed with its instructions: []`. Leg (a) completed, so the dev hire really does write under the default org through the HTTP path. Leg (d) held. |
| 2026-09-23 | `9041a2c28` + this change (fix present) | n/a | PASS | Exit 0. Dev roster row stored under `__fsd_default_org__`; dev discover listed `["eng.lead"]` with no problem; acme discover listed `["acme.support.ada"]` with no problem, beside a `~support.bo` row and a row stamped for globex. |
