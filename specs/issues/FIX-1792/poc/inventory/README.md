# Checker · what converting `MAILBOX.md` touches

The factual base of [FIX-1792](../../SPEC.md), re-derived by a script rather than counted by hand.
Not production code; outside default discovery ([specs/README.md](../../../../README.md)).

## How to run it

```bash
node specs/issues/FIX-1792/poc/inventory/check.mjs            # the census and the inventory
node specs/issues/FIX-1792/poc/inventory/check.mjs --control  # must print CONTROL PASS
node specs/issues/FIX-1792/poc/inventory/check.mjs --after    # the end state; FAILS until P4 lands
```

**The census** parses every tracked `MAILBOX.md`, asserts the counts the spec states, and requires
each file to have a row with its target and what its goal or app uses it for. A file with no row
fails the run, and so does a board list that differs from its row.

**The inventory** lists every tracked file outside retained specs, internal docs and changesets
that names the removed surface by identifier, and every goal unit that names it or says "mailbox"
at all, and asserts **totality**: each one is classified. A goal is matched on the word because it
stops running when the mailbox flow goes, whatever it calls it. Package source and docs that say
"mailbox" without naming the removed surface are FIX-1796's sweep, not this one's.

`--control` plants an unclassified source file that imports `openMailboxes` and a goal that says
"mailbox" only in prose, requires the run to fail on both, and removes them. `--after` is the
implementation's check: only the refusal fixtures are still a `MAILBOX.md`, and nothing outside the
refusal's own files names a removed export.

## What was observed

On `cad4e2780` (`main`, 2026-10-06): **PASS**.

- **33** `MAILBOX.md` files, **15** with `boards:`, **16** boards (one file declares two),
  **3** with `boardActions:`, **0** with `mintFor:`, **2** with `flow:` (both `digest`, a kind of
  the tree's own), **2** with `routing:`, **2** with an empty `members:` list. The issue's 33 and
  15 hold; the epic's "15 boards" counts files, not boards.
- Targets: **14** coordinators whose board becomes the conversation's own, **2** that lead a
  workstream (the DevTeam's `feature` and `release`), **14** coordinators with no board, **2** kept
  as old files for the refusal goal check, **1** removed with the legs it served.
- **189** files outside `goals/` name the surface: 32 removed whole, 92 edited, 49 converted,
  5 carry a refusal, 6 are FIX-1793's, 4 are FIX-1796's, 1 unrelated. The whole-file removals are
  about 4,800 source lines, 6,700 test lines and 1,200 lines of docs and figures.
- **49** goal units: 29 convert, 11 rewrite an outcome the epic changes, 6 edit a field or a word,
  1 is FIX-1793's, 1 retires and 1 folds into this issue's goal check.
- **The control:** CONTROL PASS, both plants refused, and nothing left behind.
- **`--after` on today's `main`:** FAIL, 130 problems. That is the red state; it shows the end-state
  check reaches the code it covers.

The census found two things no hand count had: the board count is 16, not 15, and the two `flow:`
files name a kind of the tree's own, not the coordinator, so "`flow:` unchanged" in the concept's
table cannot apply to them ([DECISIONS.md](../../DECISIONS.md#decided-not-asked)).
