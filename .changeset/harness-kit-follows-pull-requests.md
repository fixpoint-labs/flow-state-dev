---
"@flow-state-dev/harness-manager": patch
---

The harness kit can follow the pull requests its coding runs open. `harnesses({ onPullRequestRecorded })` takes a builder that the kit calls with the installation its coding flow is built on, for example `(installation) => followPullRequest({ providers: [github], installation, screens })` from `@flow-state-dev/workforce`. The kit hands the follower it returns to every harness manager it builds, so a run's session hears its pull request's reviews, comments and CI from the moment it opens. Without the option, nothing is followed, as before (FIX-2869).

Docs: packages/harness-manager/README.md (the harness kit's options: `onPullRequestRecorded`)
