---
"@flow-state-dev/core": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/shift-manager": patch
---

See how much of each coding harness's subscription is used. Core adds the neutral usage window and the on-demand reader signature (`HarnessUsageWindow`, `HarnessUsageReading`, `HarnessUsageReader`). `@flow-state-dev/codex` adds `readCodexUsage`, which asks the Codex CLI's app-server for every window's percent used and reset time with no run (local only), and exports `findCodexProgram`. `@flow-state-dev/harness-manager` adds the per-person `harness-usage/**` record and `harnessUsageAction({ readers })`, the one query that returns each window with its age and whether it has rolled over, refreshing a reader at most once a minute. Shift Manager shows it on a new Usage view (FIX-2141).
