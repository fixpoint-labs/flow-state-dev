---
"@flow-state-dev/core": minor
---

A flow can keep a list of the files its session was sent, by including one block (FIX-2634).

- **core:** `recordAttachments`, a handler block in `@flow-state-dev/core/attachments`. Add it as a `.tap` step (`sequencer(...).tap(recordAttachments).step(assistant)`). It declares the session's `attachments` collection itself, so including it is the only wiring. Each turn it writes one entry per file the turn sent, keyed by blob id: `ref` (the file's `fsd-blob:` reference), `filename`, `mediaType`, `requestId` (the turn that sent it) and `recordedAt`. No bytes, no size. A turn with no files writes nothing; a retried turn lists no file twice.
- **core:** the collection is `writable: false`: no block or model tool can edit, replace or delete an entry. The app reads it like any collection (`client.resources.listCollectionResources(sessionId, "attachments")`, `useResourceCollectionList(session, "attachments")`); the model does not. Deleting the session deletes the list.
- **core:** a flow without the block is unchanged: its files are still claimed, shown on the user line, sent to the model and deleted with the session. It has no list.
- **core:** also exported: `attachmentsCollection`, `attachmentResourceStateSchema`, `AttachmentResourceState`, and `ATTACHMENTS` (the collection's accessor key, `"attachments"`).

Docs: the guide page "A user turn can carry files" gains a "Keep a list of a session's files" section: including `recordAttachments`, what an entry holds, reading the list from the app, that it goes with the session and that a flow without it keeps its files. packages/core/README.md: the `@flow-state-dev/core/attachments` subpath now carries `recordAttachments` and its collection.
