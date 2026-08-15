---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — read the repository from the host it actually lives on (LAB-86).

Conductor discovers a repository's host from the git remote and keeps it, but the GitHub client `openConductor` builds for the default observer was handed only the owner, the repo, and the token. Every read for a repository on GitHub Enterprise went to `https://api.github.com` instead — a 404 for a private Enterprise repo, and, worse because it looks healthy, an unrelated *public* repository whenever one exists under the same owner and name.

The REST base is now derived from the discovered host: `https://api.github.com` for `github.com`, and `https://<host>/api/v3` for anything else, which is the base GitHub's own docs say to substitute for Enterprise Server.

Two things this deliberately does not cover. The Enterprise **token** is LAB-85, and it gets more visible here rather than less: requests that never left for the Enterprise host now arrive at it, so an unusable credential surfaces as an auth failure instead of being masked by a wrong-host 404. And a GitHub Enterprise Cloud data-residency tenant serves its API from `https://api.<tenant>.ghe.com` rather than under `/api/v3` — conductor's config carries a host and no REST base to override it with, so that case needs a config field it does not have.
