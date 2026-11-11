# end-state inventory · FIX-2629 POC

Retained spec evidence, not production code. Excluded from production discovery: the
green fixture's files end in `.fixture` and are copied to a temporary folder at run time.

**The question.** Can a static check tell claude-code-style as it is on `main` from the
epic's proposed end state, and does FIX-2152 ER-1's path rule alone do it?

**Run:** `bash specs/issues/FIX-2629/poc/end-state-inventory/run.sh`

| Step | What runs | Expected |
|---|---|---|
| 1 | `POC_EXPECT=red` on this commit | L1 (ER-1's path classes) **green**, every other rule red |
| 2 | the lab rules on `green/`, the epic's examples as files | all green |
| 3 | step 2 with `src/glue.ts` planted (a client import, a subscribe, a row type) | L3 and L4 red |

**What it showed (2026-11-11, `origin/main` at `2a68dc263`).**

- L1 passes today: ER-1 classifies `src/adapter.ts` (1,642 lines) as UI by its path. A path
  inventory can't refuse the adapter, so the epic's control line ("the inventory refuses
  `adapter.ts`") can't fail under ER-1 as written. No inventory script exists on `main`
  either (`git grep` over `labs/`, `scripts/`, `packages/fsdev/`).
- L2: 5 flows (cap 3), `harness-thread.mts` 346 lines (cap 199).
- L3: `src/adapter.ts` imports five client values and makes 3 `.subscribe(` and 10 `.flow(`
  calls. No other UI file reaches the server once comments are stripped.
- L4: 9 hand-written types in `src/adapter.ts` (`LabSession`, `LabProject`, `LabTask`,
  `TaskWork`, `WorkingNow`, `RepositoryCheck`, `LabAdapter`, `Item`, `LabConnection`).
- H: 17 lines. The install wiring in three hosts (claude-code-style 2, teammates 2, DevTeam's
  team host 3), and `as never` in the two lab hosts (3 and 7). DevTeam's host has 20 more
  `as never`, mostly not install wiring, so they are counted elsewhere, not graded.
- S: 59 lines naming an own-session helper, in 10 files.
- The green fixture passes L1 to L4, and the plant turns L3 and L4 red.

**One script, not two.** FIX-2628's draft spec builds a lab inventory of its own (no
`adapter.ts` by name, no workforce project identifier, nothing app-owned in `workforce/`).
L3 and L4 are meant to join it, so the lab keeps one inventory.

**Limits.** L4 reads an allowlist of app-computed types; a reviewer adds a name to it, and
FIX-2628's merged spec supplies the real list. L3 and L4 read text, not types. L3 catches named, default and
namespace imports and `export … from` re-exports of the client; a dynamic `import()` or a type
built by intersection still passes. A `git grep` error (not "no match") fails the run rather than
reading as a pass, and the plant control must turn exactly L3 and L4 red (`POC_EXPECT=plant`). The browser legs are what catch a
screen still assembling rows; this check is their static floor.
