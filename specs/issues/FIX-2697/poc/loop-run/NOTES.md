# Loop-run notes

The files under `concepts/` are the loop's output as it closed, kept unedited as evidence. These are
defects found in that output after the run, by review on the evidence PR. Items 1 and 2 are gaps in
the loop, not only in this page, and each is fixed in the loop (`.agents/workflows/page-loop.js`) by
the FIX-2697 goal sub-PR. Item 3 is a defect in the page that the loop recorded and, by the editor's
contract, did not act on.

1. **A Reference row kept a claim the fact check had corrected.** The row handed to R-01 says
   block-level schema defaults come "from the flow's scope schema, not the block's". Pass 5 marked
   that untrue. Defaults come from the flow's merged schema: its own `stateSchema` plus every scope
   schema its reachable blocks declare. Writes validate against the flow's own `stateSchema`. The
   fact sheet (`state-and-scopes.facts.md`, line 21) and the page were corrected; the row was not.
   Loop fix: pass 5 checks the Reference rows as well as the page.
   Fixed: pass 5 runs after pass 6 and is given its rows, numbered; a row it finds untrue is
   recorded corrected, and one it names but gives no corrected text for stops the run.

2. **The retired-terms check passed without reading the page.** `check-retired-terms` scans
   `git ls-files`, and the page was untracked during the run. So every pass-4 round recorded a
   pass that could not have failed, while line 141 kept the retired word "person" (docs-editor's
   round-3 note). Loop fix: pass 4 runs the check on the page's own path and fails closed when the
   page is outside what it scanned.
   Fixed: pass 4 runs the check's own area table and census on the page path alone, and prints
   `NOT SCANNED` and fails when the page is in no area the check scans. Under `specs/` (the
   `history` area) that is every page, so the file scout asks the same of the target first and a run
   there stops before any agent writes. Read on the page,
   the check still would not have counted "person": that word is retired on Workforce's ground
   only, and this page is not on it. The editor's vocabulary rule is what caught it.

3. **The example contradicted its own code, and the loop shipped it.** Line 120 says "When Alice's
   request changes `refundLimit` or `refundsApproved`, Bob's next request reads the new value." The
   page's only code that writes org state is `checkRefund`, which writes `refundsApproved` and never
   `refundLimit`; line 13 leaves `refundLimit` to an admin. A reader who looks for the write that
   changes `refundLimit` will not find one. `docs-editor` found it in round 3, marked it taste-level,
   and returned SHIP, so no round took it: the loop sends a REVISE's findings back and records a
   SHIP's. Pass 5 did not catch it either. It checks the page against the code, and this is the page
   disagreeing with itself. Left for FIX-2701, which writes the real C-07: its fix is the editor's,
   "When Alice's refund raises `refundsApproved`, Bob's next request reads the new count."
