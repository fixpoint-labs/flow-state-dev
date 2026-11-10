---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/claude-code": minor
"@flow-state-dev/codex": minor
"@flow-state-dev/cursor": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/react": minor
"@flow-state-dev/workspace": minor
---

A turn's images reach Claude Code, Codex and Cursor (FIX-2519).

- **core:** `HarnessRunInput` takes `attachments`, the turn's files as stored references (`FileContent` whose `data` is `fsd-blob:<id>`); `harnessRunInputSchema` refuses bytes in their place. A harness block declares the types it takes on `accepts`. From `@flow-state-dev/core/harness`: `readHarnessAttachments(ctx, files)` reads the bytes through the engine for the conversation the request runs in, `refuseUnacceptedAttachments(harness, accepts, files)` refuses a type a harness can't take, and the two named errors, `HarnessAttachmentRefusedError` and `HarnessAttachmentUnavailableError`.
- **engine:** a block's context can read the request's files for a harness, for its own conversation and person only. A server with no blob store reads none, and the harness refuses the turn.
- **claude-code:** a turn with images sends one user message on the SDK's streaming input: the prompt's text, then each image as a base64 image block. Takes PNG, JPEG, WebP and GIF.
- **codex:** a turn with images writes them to a folder of the turn's own under this user's private temp folder (`<tmpdir>/fsd-codex-<uid>/turn-…`), never the checkout, and hands Codex their paths as `local_image`. The folder is removed when the turn ends, however it ends. A host whose sandbox limits what Codex reads must allow that folder. Takes PNG, JPEG, WebP and GIF. Now depends on `@flow-state-dev/workspace`.
- **cursor:** a turn with images sends them as base64 with the prompt on `agent.send`. Takes PNG, JPEG, WebP and GIF. Now depends on `@flow-state-dev/workspace`.
- **every harness:** a file of a type the harness doesn't take refuses the turn before it starts, naming the file and the harness. A file that can't be read refuses it too. A turn never runs without a file the person sent.
- **harness-manager:** `harnessSessionFlow`'s `turn` hands the harness the request's files. A harness that declares no `accepts` is never handed one: the turn fails on its record, naming the file.
- **react:** `useHarnessLines().send(prompt, { attachments })` sends a line with files. A line with files never steers: while a turn runs it waits as the next turn, files and all.
- **workspace:** `privateTempRoot(name, purpose)` returns a temp folder private to this OS user, made `0700`, and refuses one another account owns or can enter.

Docs: the harness table in the attachments guide (what each harness takes, how a file reaches it, what it refuses); a line in packages/claude-code/README.md, packages/codex/README.md and packages/cursor/README.md on images; packages/react/README.md (`attachments` on `useHarnessLines().send`); packages/core/README.md (`attachments` on `HarnessRunInput`, `accepts`).
