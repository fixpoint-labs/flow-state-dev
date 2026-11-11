---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

The model can read a document an earlier turn sent, on request, and a long chat stops re-sending every recent document (FIX-2636).

- **core:** `attachmentsCapability` (`@flow-state-dev/core/attachments`) goes in a generator's `uses`, beside `recordAttachments` as a step before it. It gives the model a `readAttachment` tool that takes a document's id or its file name, a list of the session's newest documents in context, and a history rule: an earlier turn's document is named with its id instead of being sent again. The tool reads only this conversation's files. Its recorded output holds the file's reference, never its text. Images are not read on request, and still follow the newest-files window.
- **core:** `ItemQuery.earlierDocuments` (`"window"` or `"named"`) chooses how a `history()` read carries an earlier turn's documents. The default, `"window"`, is unchanged. The capability sets `"named"`.
- **engine:** a flow without the capability sends the same calls as before.

Docs: the "A user turn can carry files" guide page (a *Let the model read an earlier file* section beside the session file list section), packages/core/README.md (`attachmentsCapability` and `readAttachment` in the `@flow-state-dev/core/attachments` subpath), the session-items reference page (the `earlierDocuments` key on `ItemQuery`)
