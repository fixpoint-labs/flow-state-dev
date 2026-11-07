# vocabulary › one glossary › it retires a word in one place

**Issue:** FIX-2601
**Outcome:** The owner retires, keeps or brings back a word by editing one entry in `docs/contributing/glossary.mjs`, and the sweep, the Workforce guard and the side-chain check all enforce that edit on their next run. Moving the rules into the glossary lost none of them.
**Input:** Words generated at run time, so no rule can already know them. One entry retires the first by name; a second names the side-chain check's matcher for the second. The first is planted in `packages/core/src/`, `packages/engine/src/` and on a published page under `apps/docs/docs/`; the second in a `.ts` file under `packages/orchestration/src/`; a third word, which no entry retires, beside them. Each run is a different input.
**Signal:** Lever leg: the sweep and the guard each report the first word in all three plants, under the new entry, and the side-chain check reports the second; nobody reports the third, and the text checks don't report the second. With the entries removed and the plants left in, all three checks pass. Parity leg: on the same commit, the pre-move check files and the ones that read the glossary print the same counts (the sweep's hits, kept, marked, open and open-by-rule; the guard's stripped per exception and counted per term; the side-chain check's findings) and the same `--control` verdicts and exit codes.
**Anti-game:** Every leg runs in a throwaway copy of the commit (`git archive`, then a fresh repository), running the checks as CI does: tracked files, added lines against the copy's `main`. The lever leg's diff in that copy must touch only the glossary and the plants. It asserts on the checks' own output, never on their fixture tests, which pass while CI reads another list. The parity leg floors the guard's count lines and control verdicts with `tell.over`, so a check that printed nothing is CAN'T TELL, not PASS. The resource entry's new message is the one intended difference, and it prints only on a hit.
**Model:** n/a — model-free.
**Run:** `pnpm tsx goals/vocabulary/one-glossary/retire-a-word-in-one-place/run.mts` (reads `HEAD`; `--at <ref>` reads another commit)
**Controls:** `--at 0f1056861c07f2e39c11bc2a1e3c37231b757de0`, the commit before the move. No check reads the glossary there, so the lever leg must FAIL on "the plant is refused" for every plant, and the parity leg is skipped.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
