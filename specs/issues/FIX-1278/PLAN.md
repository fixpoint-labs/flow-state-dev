# FIX-1278 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Surface

- **S1 · `scripts/validate-package-boundaries.mjs`.** Add `"store-postgres"` to `packages`,
  right after `"store-sqlite"`. Add a `"store-postgres"` rule (D1) with the explaining comment,
  next to the `"store-sqlite"` rule. Add `"store-postgres"` to `contracts.deny` (E1).
- **S2 · `packages/engine/src/stores/resource-state-predicate.ts` (header, ~L39-44)** and
  **`packages/store-postgres/src/resource-state-store.ts` (~L131-138).** Correct the "engine
  dependency is type-only by package boundary" wording so it no longer covers Postgres (E2).
  These are comment edits only.
- **Removals:** none.

## Order

1. S1. Run the validator. It must exit 0 with no source changes (BR-4).
2. Plant checks (below), then remove the plants.
3. S2, unless FIX-1277 has already deleted those comments.
4. Run the full checks and paste their output in the PR.

## Checks

```bash
# goal: the validator reaches store-postgres (red state first)
node scripts/validate-package-boundaries.mjs                          # exit 0 (BR-4)
printf 'import { x } from "@flow-state-dev/react";\n' > packages/store-postgres/src/__probe.ts
node scripts/validate-package-boundaries.mjs; echo $?                 # 1, names __probe.ts (BR-1)
printf 'import { x } from "@flow-state-dev/testing";\n' > packages/store-postgres/src/__probe.ts
node scripts/validate-package-boundaries.mjs; echo $?                 # 1, "not allowed" (BR-2)
rm packages/store-postgres/src/__probe.ts
# control: on main the react plant exits 0, which is the gap this closes

# nothing changed
pnpm typecheck                                                        # includes the validator
pnpm --filter @flow-state-dev/store-postgres test
pnpm --filter @flow-state-dev/store-sqlite test
git diff --stat origin/main...                                        # S1 + S2 files only (BR-7)
```

The spec phase already ran the red and control halves on `67a3bb9b3`
([DECISIONS → Settled](DECISIONS.md#settled)). Re-run them on the branch.

## Guardrails

- **Don't touch runtime code in `store-postgres`.** If a hit appears that D1's rule doesn't
  cover, stop and raise it. Don't rewrite imports to get green. Because: the desk's fence is
  behaviour-preserving, and a guard tuned to pass is the tenet-7 failure this issue exists to
  prevent.
- **Match the rule by directory key, not package name.** `@flow-state-dev/store-postgres`
  resolves through the default scope path. Don't add a `PACKAGE_NAME_TO_KEY` entry. Because:
  that map is only for names that differ from their directory, and its header says so.
- **Leave `store-sqlite`'s rule alone.** Because: D1 explains the asymmetry, it doesn't remove
  it.
- **No changeset.** The script is repo tooling and the comments aren't user-facing (BP-022).

## Overlap with FIX-1277 (for sequencing)

FIX-1277 (one version-check predicate across the engine, `store-postgres` and `store-sqlite`)
is independent of this issue. The foreseeable touch points:

- **`packages/store-postgres/src/resource-state-store.ts`** and
  **`packages/engine/src/stores/resource-state-predicate.ts`.** FIX-1277 rewrites the restated
  predicate and very likely the comment S2 edits. This is the only file overlap.
- **Its premise.** FIX-1277's issue says the engine is a type-only dependency "for the store
  packages". After D1 that is true for SQLite only. Postgres could import the engine's
  predicate directly, but SQLite still can't, so FIX-1277's `contracts` idea stays the route to
  a single copy. Both stores' `allow` sets already include `contracts`, so FIX-1277 needs no
  validator change for that route. Neither store declares `@flow-state-dev/contracts` in its
  `package.json` today, which is FIX-1277's concern, not this issue's.
- **Suggested order:** FIX-1278 first. It is tiny, and FIX-1277's rebase is at most a comment
  conflict. The other order also works: drop S2 if FIX-1277 deleted those comments.

## Docs

No site docs or README change. See [DOCS.md](DOCS.md).

## POC

None. The factual base is two validator runs, recorded in Settled.

## Notes from review

(none yet)

## Follow-ups

- The validator's package list is hand-maintained, so a new package is unchecked until someone
  adds it. `vercel`, `scheduled` and the adapters are examples today. A totality assertion
  ("every `packages/*` is listed or explicitly exempt") would close the class. That's out of
  scope here.
- Per the FIX-1278 comment thread: once FIX-1436 lands, the script should ban `client` → `core`
  entirely. That is also not this issue's.
