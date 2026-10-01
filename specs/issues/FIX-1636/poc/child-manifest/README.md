# child-manifest · is the plan's factual base what's actually on `main`?

Throwaway evidence for [FIX-1636](../../PLAN.md#checks). Not production code, not in any test
root, no dependencies beyond git and Node.

**Question.** The plan rests on counted facts: which children merged and where, which case in
the shared HTTP suite each one owns, and which of the epic's children are deliberately not
legs. Hand-written tables drift. Can one script re-derive them, fail on the one nobody listed,
and print the part-3 manifest?

**Run it** (from the repo root, after `git fetch origin main`):

```bash
node specs/issues/FIX-1636/poc/child-manifest/check.mjs                           # must pass
node specs/issues/FIX-1636/poc/child-manifest/check.mjs --control=unowned-case    # must fail
node specs/issues/FIX-1636/poc/child-manifest/check.mjs --control=bad-sha         # must fail
node specs/issues/FIX-1636/poc/child-manifest/check.mjs --control=unlisted-child  # must fail, needs LINEAR_API_KEY
```

It is a consistency gate, not a generator: the merge ranges and case owners are kept by hand, and it fails when they disagree with `main` or Linear. With `LINEAR_API_KEY` set it also checks the child set against Linear. Without it, that
assertion is skipped and says so.

**What it showed, on `main` at 71bec56b4 (FIX-1634's last PR merged at 17c7e727a):**

| Run | Result |
|---|---|
| As written | PASS. 16 merged children on `main`; 8 suite cases, each owned by exactly one child; 19 Linear children and sub-issues classified, every merged one Done, FIX-1636, FIX-1658 and FIX-1665 on the not-a-leg list |
| `unowned-case` | FAIL, names the planted case as owned by nobody |
| `bad-sha` | FAIL, names the planted commit as not on `main`, and as not a Linear child |
| `unlisted-child` | FAIL, names the planted Linear child as neither merged nor listed |

Two things it found that the plan now carries: FIX-1256's two `labs/trading-desk` tests have
since been removed from `main` (its engine tests remain), and FIX-1647, FIX-1648 and FIX-1654
joined the epic after the closure's blocked-by list was wired, so Linear does not show them
blocking FIX-1636. All three are Done, so neither changes when the run may start.
