---
"@flow-state-dev/workforce": patch
"@flow-state-dev/workspace": patch
---

`projectWorkspace({ checkouts })` sends listed shared projects' coding runs to a checkout on the server's machine instead of a clone (FIX-1906). Each entry names a `remote`, an absolute `checkout`, the `projects` it serves by `{ orgId, id, tenantId? }`, and an optional `baseRef`. A run is mapped only when its project is shared and listed with the run session's verified organization (and tenant, exactly), and the project's `repository` equals the entry's `remote`; every other run gets the answer it would without `checkouts`. Entries are checked when `projectWorkspace()` is called. The new `ProjectCheckout` and `ProjectWorkspaceOptions` types are exported.

`localWorkspaceHost` accepts kept files beside a repository listed in `localRepositories`: the place is laid out like a remote run's, the worktree in `checkout/` and the files in `project/`, and `locate()` agrees. A local repository answered with no kept files is provisioned exactly as before. A `baseRef` the local repository lacks fails naming it before anything is made.
