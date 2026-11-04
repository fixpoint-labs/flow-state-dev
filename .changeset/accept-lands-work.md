---
"@flow-state-dev/workspace": minor
"@flow-state-dev/harness-manager": minor
---

An accepted coding run's work can now land somewhere: a pushed branch with a pull request, or a merge into the person's checkout (FIX-2543).

- **workspace:** `WorkspaceHost.land(target, request)` (implemented by `localWorkspaceHost` for a repository in `localRepositories`). `{ kind: "pull-request", title, body }` pushes the run's branch to the repository's pinned remote, the same hardened way a fetch runs, never force-pushing, then opens the pull request through `gh`, or returns the one already open. `{ kind: "merge" }` merges the branch into the base where it's checked out, refuses a dirty checkout, and aborts a conflict, naming the files. A failure is a `WorkspaceRefusedError` with a new `reason`, and the run's branch and checkout are never touched. New exports: `LAND_TIMEOUT_MS`, `Landed`, `LandRequest`, `LandTarget`.
- **harness-manager:** with `reviewChanges`, an accept can name `land: "pull-request" | "merge"` (`harnessReviewAnswerSchema`). The review's data lists the ways this host offers (`lands`) and, after a failure, `landFailed`. A failed landing asks the review again with the error, so the person can retry or pick the other way. The output gains `landed`, `null` unless the work landed. A pull request is written to the run session's `observed-pull-requests` record. `ReviewDetail` gains optional `lands` and `landFailed`, and `ReviewLand` is exported from the `browser` entry. A plain `{ verdict: "accepted" }` works as before.
