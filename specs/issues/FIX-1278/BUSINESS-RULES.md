# FIX-1278 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A file under `packages/store-postgres/src` imports `@flow-state-dev/client` or `@flow-state-dev/react` | `node scripts/validate-package-boundaries.mjs` exits 1 and names the file | Plant check, [PLAN → Checks](PLAN.md#checks) step 2 |
| BR-2 | `store-postgres` imports a workspace package the script tracks and its rule doesn't allow (e.g. `testing`, `orchestration`) | Exit 1, "not allowed to import" | Plant check with `@flow-state-dev/testing` |
| BR-3 | An import makes a cycle through `store-postgres` | The cycle check reports it | Covered by the existing cycle code once the package is in the graph. No new check |
| BR-4 | `store-postgres` value-imports `@flow-state-dev/engine` | Passes, as it does today (D1) | Unplanted branch run exits 0 |
| BR-5 | `store-sqlite` does anything | Same verdict as before. Its rule is untouched | `git diff` shows no change to the `"store-sqlite"` rule. Existing sqlite type-only imports still pass |
| BR-6 | `contracts` imports `store-postgres` | "forbidden import" (E1) | Diff review |
| BR-7 | The PR lands | No runtime line changes. Only the script and two comments differ; typecheck and both store test suites are green | `git diff --stat`, `pnpm typecheck`, both `--filter` test runs |

**Failure taxonomy.** The one failure this issue guards against is a silent pass: the script
never reads `store-postgres`. BR-1's plant is the check for it. A rule-key typo, such as a
package listed but no rule entry, crashes the script (`rules.allow` of undefined) instead of
passing. That is loud, so it needs no special handling.
