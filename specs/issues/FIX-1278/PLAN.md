# FIX-1278 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Surface

- **S1 · `scripts/validate-package-boundaries.mjs`.** Add `"store-postgres"` to `packages`,
  right after `"store-sqlite"`. Add a `"store-postgres"` rule (D1) with the explaining comment,
  next to the `"store-sqlite"` rule. Add `"store-postgres"` to `contracts.deny` (E1).
- **S2 · every comment that says `store-postgres` can't import the engine (E2).** Comment
  edits only. On `4cc9e8b1c` there are eight:
  - `store-postgres/src/resource-state-store.ts` (~L131), `pg-store.ts` (~L227),
    `session-store.ts` (~L64);
  - `engine/src/stores/resource-state-predicate.ts` (~L41), `scope-write-predicate.ts` (~L11),
    `scope-keys.ts` (~L328, the parentage predicate), `shared.ts` (~L15), `list-order.ts` (~L8).

  Where a restatement has another real reason (a SQL adapter needs the predicate as one SQL
  statement), keep that reason and drop only the Postgres type-only one. Comments that name
  SQLite alone (`scope-keys.ts` ~L293, everything under `store-sqlite/src`) are still true and
  stay put.
- **Removals:** none.

## Order

1. S1. Run the validator. It must exit 0 with no source changes (BR-4).
2. Plant checks (below), then remove the plants.
3. S2, skipping any site FIX-1277 has already deleted or rewritten.
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

# S2 is complete: no comment left claims Postgres is type-only on the engine
grep -rn -i "type-only" packages/store-postgres/src packages/engine/src/stores
#   every remaining hit names SQLite alone

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
  predicate and very likely the comment S2 edits. Two other S2 sites (`scope-write-predicate.ts`,
  `pg-store.ts`) sit next to version-check code FIX-1277 may also touch. Every overlap is a
  comment.
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

Recorded verbatim for the implementer to weigh against real code. Not folded into the design.

- **cursor[bot], [SPEC.md:46](https://github.com/fixpoint-labs/flow-state-dev/pull/2473#discussion_r4149154523):**
  "**Simplify (optional):** This section largely duplicates DECISIONS → D1 and Settled. For a
  change this small, consider keeping the hit table in one place (Settled is a good home) and
  reducing this to a short pointer: \"mirrored SQLite rule → two engine value-import hits →
  chose explain-asymmetry branch (D1).\" Same facts, less drift risk when someone edits one file
  and not the other."
- **cursor[bot], [BUSINESS-RULES.md:9](https://github.com/fixpoint-labs/flow-state-dev/pull/2473#discussion_r4149154529):**
  "**Simplify (optional):** BR-3 doesn't get a dedicated plant in PLAN (\"existing cycle code
  once in graph\"). If the goal is a minimal BR table, BR-1 + BR-2 + BR-4 + BR-7 already carry
  the issue; cycle parity might be a single sentence in SPEC's people table rather than a row
  proved only by inference. Not wrong—just low signal relative to BR-1's silent-skip guard."
- **cursor[bot], [PLAN.md:58](https://github.com/fixpoint-labs/flow-state-dev/pull/2473#discussion_r4149154537):**
  "**Simplify (optional):** The FIX-1277 block is useful for sequencing, but it re-states D1 /
  \"SQLite-only type-only\" premise already in DECISIONS and SPEC. A one-liner here (\"1277 may
  conflict on S2 comments; land 1278 first or drop S2 if 1277 removed them\") with a link to
  DECISIONS might be enough unless you expect many spec readers who never open DECISIONS."
- **cursor[bot], [SPEC.md:75](https://github.com/fixpoint-labs/flow-state-dev/pull/2473#discussion_r4149154544):**
  "The proposed script comment still has `<why, one or two lines>` in the diff-shaped block.
  Fine for spec phase; implementer should replace with the concrete wording DOCS.md describes
  (trace store + live-tail helpers vs SQLite local copies) so the spec diff doesn't read like a
  placeholder at merge time for the implementation PR."
- **Second-look review, [PR conversation](https://github.com/fixpoint-labs/flow-state-dev/pull/2473#issuecomment-5919379746), item 1:**
  "Rewrite the S2 comments rather than just deleting the claim. The
  `store-postgres/src/resource-state-store.ts` comment justifies restating the predicate by
  saying the engine dependency is type-only. After D1 that reason holds for SQLite only.
  Postgres could import `resourceStateConflict` directly, and the rewritten comment should say
  so. Otherwise it reads as if the duplication is forced."
- **Same review, item 2:** "make the explaining comment above the Postgres rule, or the
  Follow-ups entry, say that `scheduled` imports are unchecked for both adapters. A reader of
  the rule then won't infer \"Postgres is fully checked\"."
- **Same review, minor:** "BR-6 (`contracts` denies `store-postgres`) is behaviourally
  vacuous. `contracts.allow` is empty, so the import is already rejected. Keeping the deny
  entry for the clearer message is fine."

## Follow-ups

- The validator's package list is hand-maintained, so a new package is unchecked until someone
  adds it. `vercel`, `scheduled` and the adapters are examples today. A totality assertion
  ("every `packages/*` is listed or explicitly exempt") would close the class. That's out of
  scope here. It would also let the cycle check see cycles through `scheduled` and `vercel`,
  which it misses today for both adapters (BR-3).
- Per the FIX-1278 comment thread: once FIX-1436 lands, the script should ban `client` → `core`
  entirely. That is also not this issue's.
