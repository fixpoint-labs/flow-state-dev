---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": patch
---

A repository listed in `localRepositories` now fetches the base's upstream before it cuts a new run's branch, and cuts from whichever of local and upstream is newer. A base whose local and upstream copies have each moved is refused as `base-diverged`; a failed fetch falls back to the last-fetched copy with a warning. `place.repo.baseCommit` is now set for these repositories. The run record keeps it as `baseCommit`, and `readRunCommits` takes it as a third argument and leaves out the commits it has (FIX-1927).
