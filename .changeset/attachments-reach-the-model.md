---
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/core": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/bullmq": patch
---

A message's files reach the model, and the conversation shows them on the person's line (FIX-2517).

- **client:** `flow(address).send(action, input, { sessionId, attachments })` sends the message's files beside the input. Each is the `FileContent` that `upload` returned, in the order attached. The flow's input schema never sees them.
- **react:** `useSession().sendAction(action, input, { userMessage, attachments })` sends them the same way. The line the view shows at once holds the files after the text, as the server's copy will.
- **engine:** an action with `userMessage` takes files. The user line it writes holds a `file` part per file after the text, as references, so a reload shows them. An action without `userMessage` refuses files with 400 `attachments_not_accepted`. A message over the limits answers 400 `attachment_limit` (with the `index` of the file that went over and the `limit`), a type off the list answers 400 `attachment_type_refused`, and a file named as another type than it was uploaded as answers 400 `attachment_invalid`. Nothing is claimed or run on a refusal.
- **engine:** a generator with `history` gets the files as image parts (PDFs as file parts) with the bytes inline, on the person's turn. Later turns still carry earlier files: counting back from the newest message, up to 10 images and 5 documents, the same limits as one message. An older file is named on its turn as `[image: shot.png, not re-sent]`. A file that can no longer be read is named as `no longer available` instead of failing the call. Re-sent files are billed as input on every call; prompt caching (on by default) keeps that cost down.
- **engine:** retrying a turn (`POST …/requests/:id/retry`) carries its files: the retried line, its record and the model get the same references.
- **core:** `ModelResolver.prepareMessages(messages)`, optional: a generator passes the messages of every model call through it. The engine's run sets it to read the person's files at the call, so a run's records (a generator's trace, a tool loop's prelude) hold references and never the bytes. A custom model resolver needs nothing new.
- **core:** `ctx.request.attachments` lists the request's files as references, for a block that hands files on itself. Empty when the message carried none. A generator whose `user` slot repeats the person's words no longer sends the turn twice when that turn carries files.
- **contracts / core:** `attachmentLimitRefusal(files)` in `@flow-state-dev/core/attachments` checks one message against the limits set, the same check the server makes, so a composer can refuse before send.
- **bullmq:** a queued job carries the request's files to its worker.

Docs: a new guide page, "A user turn can carry files": sending files from the client and React, what the model receives, the history rule (newest files up to one message's limits, older ones named), the limits and the named refusals, `ctx.request.attachments`. packages/client/README.md (`attachments` on `send`), packages/react/README.md (`attachments` on `sendAction`), packages/engine/README.md (the user line's file parts and the refusals), packages/core/README.md (`ctx.request.attachments`, `attachmentLimitRefusal`), packages/contracts/README.md (`attachmentLimitRefusal`).
