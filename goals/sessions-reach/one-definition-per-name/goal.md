# sessions-reach › it one definition per name

**Issue:** FIX-2943 (epic FIX-2941)
**Outcome:** A block in one flow reads and writes another flow's session copy of a definition both flows declare. A flow that declares the same session-scoped name with another shape is refused at start, and the error names both flows and the name. Two flows that declare one index name at two versions on collections isolated to their flows start.
**Input:** `fixtures/default.json`: the em and coder flows on `work`, a clashing `reviewer`, and an isolated index `byOwner` on `tasks/**`. Held-out: `GOAL_FIXTURE=alternate.json` (other flow names, definition `ledger`, index `byStatus` on `entries/*`) must give the same verdict. Both reaching flows include one declaring block, so any pair of flows that share a declaring block is the case under test.
**Signal:**
- **reach:** the visitor flow, in its own session, writes the owner's session copy through `ctx.resources.at({ session })`, and the owner flow reads the write back from its own copy. Then the owner writes and the visitor reads it back. The visitor's own copy does not get the write.
- **clash:** start is refused, and the error names both flows and the definition.
- **isolated:** both flows start, and each writes and reads back its own row.
**Anti-game:** Every assertion reads a row back through a real flow's action, or reads the start-up error. Nothing reads the registry, the store or the index table. The refusal is matched on the flow names and the definition from the fixture, not on a fixed string.
**Model:** n/a
**Run:** `pnpm tsx goals/sessions-reach/one-definition-per-name/run.mts`
**Controls:**
- `GOAL_CONTROL=skip-session-scope`: the start-up check skips session scope. Must FAIL `clash` (the app starts), and nothing in `isolated`.

The spec's type leg (`ctx.resources.at({ session }).worke` fails to compile) and the reach leg both need `ctx.resources.at`, which FIX-2942 adds. Until it merges, `reach` fails with `ctx.resources.at is not available`. That is the expected verdict for this issue alone, and this check passes in full only once both are on `main`. FIX-2942 adds the type leg beside its accessor.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-27 | bf764dcc (main, before this change) | n/a | FAIL (expected) | `reach` (no `.at`), `clash` (the app starts with two shapes under `work`), `isolated` (`byOwner` at versions 1 and 2 refused) |
| 2026-11-27 | fix/fix-2943 on bf764dcc | n/a | FAIL (expected) · `skip-session-scope` | `reach` (no `.at`) and `clash`; `isolated` passes |
| 2026-11-27 | fix/fix-2943 on bf764dcc | n/a | FAIL · reach only | `clash` and `isolated` pass. `reach` waits for FIX-2942's `ctx.resources.at` |
| 2026-11-27 | fix/fix-2943 on bf764dcc | n/a | FAIL · reach only · `alternate.json` | Same verdict with `ledger`, `planner`/`builder`/`auditor`, `byStatus` |
