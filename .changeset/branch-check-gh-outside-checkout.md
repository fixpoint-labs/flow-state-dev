---
"@flow-state-dev/workspace": patch
"@flow-state-dev/harness-manager": patch
---

The turn-end pull-request check no longer runs `gh` inside a run's checkout (FIX-2890).

- `recordBranchPullRequests` takes a new `repository` option (`host/owner/name`). `gh` runs in an empty directory and is told that repository, the way landing a run already does, so a run can't steer which repository the host's credentials are used against by changing its checkout's remotes. Without `repository`, nothing is asked and the check returns `unavailable`. Before, `gh` read the repository from the checkout.
- New optional `WorkspaceHost.pullRequestRepository({ cwd, baseRef })`: the GitHub repository the host pinned for a checkout's base, or `undefined`. `localWorkspaceHost` implements it. The harness manager passes it to the check.
- New optional `HarnessSessionWorkspace.pullRequestRepository(place)`. A session workspace without it skips the turn-end check, with a note. Implement it with the host's `pullRequestRepository` to keep the check.

Docs: packages/workspace/README.md (`recordBranchPullRequests` options, `WorkspaceHost.pullRequestRepository`) and packages/harness-manager/README.md (`HarnessSessionWorkspace.pullRequestRepository`)
