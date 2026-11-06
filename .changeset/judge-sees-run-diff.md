---
"@flow-state-dev/harness-manager": patch
---

A run's judge now sees what its commits changed. The judge's input gains `diff`: each file the commits changed against the run's base, with its added and removed lines (up to 200 files listed, totals over all of them), or `null` when the run has no branch or its commits couldn't be read. `goalJudge` hands it to the evaluation model, so a task that asked for a change is judged on the branch rather than on a commit subject (FIX-2577). A custom judge can read `input.diff`; one that ignores it is unaffected.
