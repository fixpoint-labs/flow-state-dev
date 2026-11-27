---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": minor
---

One way to hand the harness manager a workspace (FIX-2933).

- **New: `localRepoWorkspaceHost({ root, repo, baseRef?, setup?, pullRequestRepo?, provisionTimeoutMs? })`** in `@flow-state-dev/workspace` returns a workspace host whose every run is a worktree of one repository on this machine, its branch kept in that repository. A relative `repo` is resolved. A host whose source changes per run, or that cuts from several repositories, still calls `localWorkspaceHost`.
- **Breaking:** `harnessManager({ workspace })` takes a `WorkspaceHost` only. The `{ root, sourceRepo, baseRef }` object form is gone: pass `localRepoWorkspaceHost({ root, repo: sourceRepo, baseRef })`. `WorkspaceConfig` and `hostForConfig` are removed, with no alias. A mode's `doneWhen.validate` receives the host.
- **Breaking:** in `@flow-state-dev/harness-manager/checkout`, `checkoutPathFor(root, location)` takes the host's root, and `provisionCheckout(host, answer, location)` takes the host and the run source's answer.

Docs: packages/workspace/README.md (the new helper) · packages/harness-manager/README.md (its `workspace: { root, sourceRepo, baseRef }` example becomes `localRepoWorkspaceHost({ root, repo, baseRef })`)
