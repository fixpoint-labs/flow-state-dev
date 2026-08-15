---
---

Internal (`@flow-state-dev/conductor`, private and unpublished): three review
fixes in dispatch and the GitHub write path.

Branch provisioning derived create-vs-re-enter from `git ls-remote --exit-code`
by testing for any non-zero exit. Only exit 2 means "the remote answered and has
no such branch"; auth failures, transport errors, and server errors exit 128.
Reading one of those as absence selects the creation plan, whose
`checkout -B <branch> <remote>/<base>` resets the branch — so a transient probe
failure during a re-entry discarded the commits already on it. Provisioning now
accepts exit 2 as absence and raises `WorkspaceProvisionError` on every other
non-zero exit, before any fetch or checkout runs.

`ConductorConfig.remote` was honoured when resolving the repository and the base
branch, but branch provisioning still hardcoded `origin`. `branchPlan` and
`provisionWorkspace` take the remote and use it for the probe, the fetch, and
the tracking ref. The rule it carries is unchanged: every checkout is a
`-B <branch> <remote>/<ref>` off a remote-tracking ref, never a local branch, so
parallel worktrees still cannot collide on a shared ref.

`setLabels` caught every error from a label removal, not just the 404 that means
the label was already absent. A 401, 403, 429, or 5xx was swallowed, the label
read that followed still succeeded, and the call resolved as though the removal
had landed. Only a 404 is tolerated now; everything else is rethrown.

No public API surface changes.
