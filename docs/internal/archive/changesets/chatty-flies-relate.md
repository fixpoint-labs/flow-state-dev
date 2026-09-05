---
---

Internal review-feedback refinements to the unreleased PTY-backed `claude --remote` resolver (covered by `claude-code-pty-resolver.md`); no release impact.

- Relabel a `script(1)` spawn `ENOENT` so `claudeRemoteDispatch` no longer misreports it as a missing `claude` CLI (private helper; no public API change).
- `unref()` the SIGKILL fallback timer so an early-banner resolve doesn't hold the event loop open.
- Drop a redundant `key === p` env-scrub check subsumed by `startsWith`.
