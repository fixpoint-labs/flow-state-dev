# POC · the claim census, and who calls what goes

Retained design evidence for [FIX-2627](../../SPEC.md), not production code. Throwaway. Nothing
here is imported by a package, an app or a test, and neither script edits the tree.

**Questions.** (1) Once workforce runs FIX-2626's claim pass, which files in the repository's
`workforce/` folders would be refused, and so stop their app or goal starting? (2) How many
files outside `packages/workforce` call what this issue makes internal or removes?

**Run** (from the repository root; no install needed, under a second each):

```bash
node specs/issues/FIX-2627/poc/claim-census/census.mjs
CENSUS_CONTROL=1 node specs/issues/FIX-2627/poc/claim-census/census.mjs
node specs/issues/FIX-2627/poc/claim-census/callers.mjs
CALLERS_CONTROL=1 node specs/issues/FIX-2627/poc/claim-census/callers.mjs
```

## What each checks

- **`census.mjs`** walks every folder named `workforce` holding `teams/` or `org/`, and the root
  above every `WORKER.md` (so deliberately bad trees, such as the pentest lab's refusal trees,
  are walked too). Each file gets exactly one class: a claim rule read off workforce's published
  shapes (`packages/workforce/test/published-tree-surface.test.ts`), an ignored name
  (`IGNORED_ENTRIES`), or UNCLAIMED. **Totality:** it fails if a `WORKER.md` lies outside every
  walked root, or a file is classified twice. **Control:** it copies teammates' tree, plants
  `notes.txt`, `flows/helper.mts`, `teams/x/notes.md` and `flows/workers/nested/deep.ts`, and
  fails unless exactly those four are UNCLAIMED. The last guards the worker-flow rule against
  absorbing a nested path.
- **`callers.mjs`** reads every source file outside `specs/` and `packages/workforce/` once, and
  counts the files naming `hireWorkforce`, `createWorkerInstallation`, `readDeclaredRoster`, a
  call to any of the loader's readers, or `@flow-state-dev/react/workforce`, grouped by where
  they live. **Control:** one planted caller per entry, each counted once.

The claim rules are this POC's reading of the published shapes, not workforce's code: the
implementation's claim pass is the authority, and its PR reruns the census against it.

## Result, 2026-11-11 (`main` at `2a68dc263`)

```
roots walked: 46 · files classified: 235
  TEAM.md 5 · WORKER.md 180 · generated module 4 · package 4 · resource 13 · skill 13
  team or worker block 2 · worker flow 7 · UNCLAIMED 7

UNCLAIMED (7):
  apps/kitchen-sink/workforce/hire.ts
  labs/claude-code-style/workforce/flows/dismissals.mts
  labs/claude-code-style/workforce/flows/harness-thread.mts
  labs/claude-code-style/workforce/flows/pins.mts
  labs/claude-code-style/workforce/flows/projects.mts
  labs/claude-code-style/workforce/flows/user-marks.mts
  packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/piece.mts
control ok: every planted stray reported, nothing else

createWorkerInstallation: apps, labs, shift-manager 12 · goals 52
readWorkforce (and the other readers): apps, labs, shift-manager 3 · goals 29
hireWorkforce: apps, labs, shift-manager 12 · scripts, docs 3 · goals 56 · other packages 2
readDeclaredRoster: goals 27 · apps, labs, shift-manager 9
@flow-state-dev/react/workforce: goals 1 · other packages 6
files calling any of them: 122 · apps, labs, shift-manager 21 · scripts, docs 3 · goals 90 · other packages 8
goal checks (goals/<area>/<goal>) with a caller: 72
control ok: each planted caller counted once
```

**What it changed:** the spec's order for the claim pass names all 7 files and who moves each,
not only claude-code-style's two; [D2](../../DECISIONS.md#d2)'s size is these counts.
