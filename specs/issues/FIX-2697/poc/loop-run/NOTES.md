# Loop-run notes

The files under `concepts/` are the loop's output as it closed, kept unedited as evidence. These are
defects found in that output after the run, by review on the evidence PR. Each one is a gap in the
loop, not only in this page, and each is fixed in the loop (`.agents/workflows/page-loop.js`) by the
FIX-2697 goal sub-PR.

1. **A Reference row kept a claim the fact check had corrected.** The row handed to R-01 says
   block-level schema defaults come "from the flow's scope schema, not the block's". Pass 5 marked
   that untrue. Defaults come from the flow's merged schema: its own `stateSchema` plus every scope
   schema its reachable blocks declare. Writes validate against the flow's own `stateSchema`. The
   fact sheet (`state-and-scopes.facts.md`, line 21) and the page were corrected; the row was not.
   Loop fix: pass 5 checks the Reference rows as well as the page.

2. **The retired-terms check passed without reading the page.** `check-retired-terms` scans
   `git ls-files`, and the page was untracked during the run. So every pass-4 round recorded a
   pass that could not have failed, while line 141 kept the retired word "person" (docs-editor's
   round-3 note). Loop fix: pass 4 runs the check on the page's own path and fails closed when the
   page is outside what it scanned.
