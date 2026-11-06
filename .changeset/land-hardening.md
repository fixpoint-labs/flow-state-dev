---
"@flow-state-dev/workspace": patch
"@flow-state-dev/harness-manager": patch
---

Landing an accepted run is safer, and is offered only where it can work (FIX-2543).

- **workspace:** a local merge never runs a program set in the checkout's own git config, which a run shares: fsmonitor, filters, merge drivers and signing programs fall back to your global or system config, or are off. `gh` runs outside every checkout, with `--repo` taken from the pinned remote URL and an explicit `--head`, so it never pushes or reads a run's config; a remote that names no GitHub repository is refused as `no-pull-request-repo` before anything is pushed. Set `pullRequestRepo` on `localWorkspaceHost` when the pinned URL doesn't name the repository itself. A merge that fails is undone under its own time limit and checked; if the checkout couldn't be put back, `merge-failed` says so. New: `WorkspaceHost.landWays(target)`, the landings that will work for a run (none for a run cloned from a remote).
- **harness-manager:** the review offers only the landings the host's `landWays` answers, so a run that can't be landed keeps the plain Accept. The workspace config gains `pullRequestRepo`.

Docs: apps/docs/docs/orchestration/harness-manager.md
