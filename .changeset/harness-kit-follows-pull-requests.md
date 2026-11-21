---
"@flow-state-dev/harness-manager": patch
"@flow-state-dev/workforce": patch
---

The harness kit can follow the pull requests its coding runs open. `harnesses({ onPullRequestRecorded })` takes a builder that the kit calls with the installation its coding flow is built on, for example `(installation) => followPullRequest({ providers: [github], installation, screens })` from `@flow-state-dev/workforce`. The kit hands the follower it returns to every harness manager it builds, so a run's session hears its pull request's reviews, comments and CI from the moment it opens. Without the option, nothing is followed, as before (FIX-2869).

`@flow-state-dev/workforce` adds a follower for a public repository. `reviewedPullRequestFollow(github, reviewers)` hears only the listed GitHub logins, whether they are in the project or not, and returns `undefined` (nothing followed) when nobody is listed, never a follower that hears every sender. `githubReviewers(value)` reads a comma-separated setting into `{ ids, bots }`: each login as GitHub sends a sender's id, and the ones listed as `name[bot]`. A bot is heard only when the GitHub service flow trusts it too, so pass `bots` as its `trustedBots`. `followPullRequest` takes `outsiders: true`, for use with a screen that names who is heard.

Docs: packages/harness-manager/README.md (the harness kit's options: `onPullRequestRecorded`), packages/workforce/README.md (following a pull request: `reviewedPullRequestFollow`, `githubReviewers`, `followPullRequest({ outsiders })`)
