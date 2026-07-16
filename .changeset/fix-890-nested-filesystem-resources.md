---
"@flow-state-dev/engine": minor
"@flow-state-dev/cli": minor
---

Filesystem content and state stores now persist resource keys as a nested file tree with `.md` and `.json` leaves instead of flat percent-encoded filenames. Existing flat `content/` or `state/` data is not read automatically; move or delete those subtrees before upgrading.
