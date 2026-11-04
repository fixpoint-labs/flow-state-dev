# FIX-2541 POC · the closure's asks

The epic's D2 makes the closure's scripts this issue's spec POC, so the cut run can happen
before the closure is unblocked. This directory is that POC, in two halves.

**Built and checked: the graders and the verdict rules** (`asks.mts`). One grader per ask,
each over one recorded turn, and the three rules that turn runs into verdicts: 3 of 3 to pass
in an app, the per-ask control, and the cut (an ask passes in every app where it runs).

**Not built yet: the four app drivers.** Each serves its app on a fresh store, puts the ask to
the worker named in `SPEC.md → Who is asked`, and records a `Turn` from the app's public API.
They are the load-bearing half: the cut run cannot start without them. Each one follows its
app's existing goals (`goals/claude-code-style-lab/lab.mts`, `goals/teammates-lab/lab.mts`,
`goals/lib/kitchen-sink.mts`, `goals/lib/shift-manager.mts`).

```bash
# the graders refuse each planted hollow turn, and the verdict rules read a sheet as SPEC.md says
node specs/issues/FIX-2541/poc/closure-asks/check.mts
```

Throwaway at the line level. At implementation the graders move to `goals/` as the closure's
goal check, beside the drivers.
