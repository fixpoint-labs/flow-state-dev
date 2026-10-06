---
"@flow-state-dev/workforce": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/devtool": patch
---

Channels are now mailboxes everywhere (`MAILBOX.md` under `teams/<team>/mailboxes/`, the `mailbox` kind, `mailbox-post` items, the `post-to-mailbox` tool, the `mailboxes` discovery domain, and every export, such as `mailboxFlow`), and the old names are not read, so an old file is reported by name and a store written before this release does not open: start from an empty store (FIX-1748).
