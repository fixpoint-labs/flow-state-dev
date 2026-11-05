# Checker · every roster read in the three workforce apps

Retained design evidence for FIX-2412, not production code. Throwaway.

**Question.** The spec says Kitchen Sink, Shift Manager and the Teammates lab read the roster
once and never again, names the reads that move to the roster watch, and names the three that
stay one-shot. Is that the whole list?

**Run** (from the repository root, no install needed):

```bash
node specs/issues/FIX-2412/poc/roster-reads/check.mjs
FIX2412_CONTROL=plant node specs/issues/FIX-2412/poc/roster-reads/check.mjs   # must exit 1
```

**What it does.** Scans every non-test source file under Kitchen Sink's `app`, `components` and
`lib`, `packages/shift-manager/src` and `labs/teammates/src`. A site is a call of the workforce
client's `roster()`, the Teammates adapter's `listWorkers`, or a use of Kitchen Sink's
`SHELL_COORDINATORS`. Every site must be classified, and every classified site must still be
found.

**Result, 2026-11-04** (`main` at 5eaaa9f6): 286 files scanned, 13 sites: 9 move to the watch,
1 is removed (`SHELL_COORDINATORS`), 3 stay one-shot (Shift Manager's snapshot, which FIX-2409
refreshes; the Teammates adapter's pick of a conversation to read the message log through; and
its hire finding the row it wrote). The control plants an unclassified read and exits 1.

**Limit.** It finds a call by name. A roster read made through another name (a helper that
wraps `roster()`) would be found at the wrapper only.
