---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
"@flow-state-dev/vercel": patch
"@flow-state-dev/workforce": patch
---

A lost schedule index heals itself, and GitHub polling says why it stops (FIX-2920).

- **Kits get a start-up hook.** A kit's `install` may return `onStarted(host)`. It runs once per process, once the app serves (its router is built, or a job-queue worker starts processing), and never on `getRuntime()` alone. `host.userCells()` lists every user cell in the store and `host.readUserResources(cell, prefix)` reads one.
- **`ScheduleIndex.ensure(entry)` is required.** It inserts an entry only when the index holds none for its cell and key, so a row still there keeps its due fire. The SQLite, Postgres and Vercel indexes implement it, and the conformance suite checks it. A custom `ScheduleIndex` must add it. `reassertSchedules` puts every enabled schedule of one cell back into an index through it.
- **The workforce kit heals its indexes.** Once the app serves, every user's enabled clock routines and poll schedules go back into `routines.index` and `routines.poll.index`. A deleted or reset index file no longer leaves routines that never fire.
- **GitHub polling says why it stops.** `readOperatorGitHubToken` is `operatorGitHubToken` plus where the token came from (`GITHUB_TOKEN`, which wins, or `gh auth token`) and why `gh` gave none. `checkGitHubToken` makes one `GET /user` call and returns the login, or why GitHub refused. A failing poll logs its reason once, and logs again when it works.
- **The local cron logs a lease renewal that throws**, instead of idling without a word.

Docs: apps/docs/docs/reference/schedules.md (`ensure` on the `ScheduleIndex` contract, and `reassertSchedules`), packages/scheduled/README.md (the new export), apps/docs/docs/build/webhooks/github-reviews.md (`readOperatorGitHubToken` and `checkGitHubToken` beside `operatorGitHubToken`), apps/docs/docs/concepts/kits-and-slots.md (the `onStarted` hook)
