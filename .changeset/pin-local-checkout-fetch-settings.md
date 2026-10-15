---
"@flow-state-dev/workspace": patch
---

A repository listed in `localWorkspaceHost`'s `localRepositories` now keeps its pinned remote URLs and branch upstreams in `<root>/.fetch-pins/`, across restarts, so a run that rewrites the repository's config can't aim a later host's fetch. A remote that no longer matches its pin is not fetched, and the warning names the pin file to delete to accept a deliberate change. A fetch that fails or is skipped now starts the run from the local base instead of the remote-tracking ref (FIX-1934).
