---
"@flow-state-dev/harness-manager": patch
---

`readRecordedWork` file rows now carry `applied`: how many of the run's operations on that path landed. `0` means every attempt failed, so a page can count edits without counting failed tries. `null` on rows recorded before the count was kept.
