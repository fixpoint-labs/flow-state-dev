---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — the local source is reachable, and reading a checkout no longer demands a GitHub credential.

The README documents reading a local checkout as the mode that makes the process runnable without GitHub: no issues burned, no pull requests opened, a kill-mid-gate restart you can actually try. Nothing could get to it. `resolveConductor` raised on an absent `GH_TOKEN`/`GITHUB_TOKEN` whatever the caller intended to read from, so the resolved config the runtime needs could not be produced at all without a credential; and `localObserver` was exported from no entry point, so even with one, the only way to name the observer was to reach past the package's exports.

Both are now open:

- **The token is required where GitHub is read, not where config is resolved.** `resolveConductor` reports an absent token as `token: null` — a resolvable state, since a world read from a checkout touches no GitHub API — and `openConductor` raises the same `ConductorConfigError` when it has to build its default GitHub observer without one. The property that raise exists for is kept: it fires while the session is assembling, one call after resolution, so a credential-less GitHub run still stops before a work item is managed. What changed is which configurations it applies to. It is also the one discovery with no `conductor.config.ts` override, which is why nothing a project could write got past it.
- **`localObserver` is exported at `@flow-state-dev/conductor/local`**, a subpath for the same reason `@flow-state-dev/conductor/testing` is one. GitHub stays internal, deliberately: it is what `openConductor` builds when no observer is passed, so no caller ever names it. A seam implementation is reachable exactly when a caller has to state it.

`ResolvedConductor.token` is now `string | null`. The only reader is the GitHub client construction above.

A neighbour, checked and left alone: `repo` is discovered by parsing the remote's URL as a GitHub one, so a checkout with no GitHub remote cannot discover it either — but that field *does* have a config override, so declaring it keeps the local path open. `baseBranch` is the same shape. Neither blocks the way the token did.
