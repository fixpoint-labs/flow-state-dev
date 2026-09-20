---
"@flow-state-dev/workforce": minor
---

A workforce root spelled with a `..` that steps back through an earlier segment — `/srv/app/current/../workforce`, where `current` is a release symlink — is now refused wherever a reader opens a root; pass the path it resolves to instead (FIX-1375).
