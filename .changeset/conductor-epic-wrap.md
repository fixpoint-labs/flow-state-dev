---
---

Internal (process): records the LAB-68 Conductor epic wrap — cycle 6 of the cycle ledger and its per-instance evidence file. No package surface changes.

The epic's four implementation PRs are open and unmerged, so the wrap is written without an escape column and says so: cycles 4 and 5 score findings that reached `main`, and nothing here did. Both artifacts name what must be re-scored once the chain merges.

Two things came out of it that are not in the ledger's existing classes. `wrong-extent` — a fix aimed at the right defect but covering less of it than the defect covers — is invisible to the test you would naturally write, because that test is written against the target; it recurred six times plus one rule wrong in three successive directions, including inside the fix for it, by the author who had named the class two rounds earlier. And a guard table of broken worlds, run before dispatch with each entry naming the branch it must reach, caught two defects nobody was looking for while remembered rules were half-applied six times. The proposed upstream fix is that pattern, put to the owner rather than taken: [`docs/internal/cycle-ledger.md`](../docs/internal/cycle-ledger.md), [`docs/internal/epic-wraps/conductor-68.md`](../docs/internal/epic-wraps/conductor-68.md).
