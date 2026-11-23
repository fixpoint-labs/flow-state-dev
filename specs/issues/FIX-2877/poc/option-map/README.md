# POC · the option map

Retained design evidence for [FIX-2877](../../SPEC.md), not production code. Throwaway. Nothing
imports it, it edits nothing, and it needs no install.

**Question.** Does every piece of Shift Manager's own coding flow have a place on the shared
`coder` flow: one the kit already has, one of the three options [D1](../../DECISIONS.md#d1) adds,
or a reason it goes? And are Teammates' four default-coder knobs and Shift Manager's two harness
lists where the issue says?

**Run** (from the repository root, under a second):

```bash
node specs/issues/FIX-2877/poc/option-map/check.mjs                         # PASS
OPTION_MAP_CONTROL=1 node specs/issues/FIX-2877/poc/option-map/check.mjs    # must FAIL
```

**What it checks.**

- **Totality.** It reads every option key of `CoderWorkerFlowOptions` and `CoderHarness`, the
  settings the fork adds (`harness`, `document`), and every action its `defineFlow` declares, and
  gives each exactly one class: `HAS` (the kit option it maps to), `GAINS` (the D1 option it
  lands in) or `DROP` (why it goes). An unclassified piece fails, and so does a classified one the
  fork no longer has.
- **The kit side.** Each `HAS` names an option the kit's `CoderFlowOptions` has today, and each
  `GAINS` names one it lacks.
- **The sites.** Eight regexes find each knob and list on the tree.
- **Control.** `OPTION_MAP_CONTROL=1` plants an option key the map does not know. It must fail
  with `UNCLASSIFIED: plantedOption`.

**Result on `main` `26e76736b` (2026-11-23).** 25 pieces: 14 `HAS`, 7 `GAINS`, 4 `DROP`; 8
sites found. PASS. The control exits 1 with `UNCLASSIFIED: plantedOption`.

The 7 `GAINS` are fork keys, not options. They land in D1's three: `phase`, `answerPhase` and
`answerWorkspace` in `modes` (Shift Manager's `implement` and `answer` entries); `approveTools` in its own; `resources`, `setting.document` and
`[INSPECT_ENTRY]` in the app's worker extension.

The checker does not list readers of the symbols that go (`coderHarnessNames`, `HARNESS_SETTING`,
`workerHarnesses`, `JUDGE_MODEL`, the fork's `CODER_FLOW`). The spec's
[What changes](../../SPEC.md#what-changes) lists them, by grep.

Once FIX-2877 is implemented the fork is gone and this check fails by design: it describes the
tree the spec was written against.
