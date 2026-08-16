---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — one spelling of a hostname, so a public repo is not mistaken for an Enterprise one (LAB-86).

Deriving the REST base from the discovered host (LAB-86) compared it to `github.com` exactly, and the host is whatever the git remote spelled. A remote written `git@GitHub.com:owner/repo.git` — an ordinary public-GitHub remote, and the spelling a copy-pasted URL or a GUI client produces — was therefore classified as Enterprise, and every read went to `https://GitHub.com/api/v3`, which is not an API. That configuration worked before the host was read at all, so this is a regression rather than a gap.

The host is canonicalized before the base is chosen: lowercased, and a rooted FQDN's trailing dot dropped. A **port is left alone** — `github.com:8443` is a different endpoint rather than a spelling of `github.com`, and public GitHub's API is not behind it.

Canonicalization stays at the comparison rather than moving to `parseRepoRef`, deliberately. The parsed host is also interpolated into the default `orgId`, which is the storage address every managed work item is written under, so normalizing at the parse site would silently re-address an existing install's state directory and bring conductor up with an empty registry.
