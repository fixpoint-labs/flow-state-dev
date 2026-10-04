---
"@flow-state-dev/workforce": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/devtool": patch
---

Channels are now mailboxes, everywhere: `MAILBOX.md` records under `teams/<team>/mailboxes/`,
kinds under `workforce/flows/mailboxes/`, the `mailbox` kind, `mailbox-post` items,
`inventory/mailboxes/` rows, the `post-to-mailbox` tool, the `mailboxes` discovery domain,
and every export (`mailboxFlow`, `openMailboxes`, `MailboxManifest`). The old names are
not read: an old file is reported by name, and a store written before this release does
not open. Start from an empty store (FIX-1748).
