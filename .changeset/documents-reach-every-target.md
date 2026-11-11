---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/claude-code": minor
"@flow-state-dev/codex": minor
"@flow-state-dev/cursor": minor
---

Documents: PDFs, text, Markdown, CSV and code files reach every model and harness (FIX-2520).

- **contracts / core:** the attachment list takes text-like files (`ATTACHMENT_TEXT_TYPES`: text, Markdown, CSV, JSON, YAML, HTML, XML; source files as `text/plain`) beside images and PDFs. Each counts as a document against the five per message. `attachmentMediaType({ name, type })` types a picked file by its extension for text-like files (a browser types `.ts` as video); `ATTACHMENT_ACCEPT` is the `<input accept>` list for everything the list takes. `attachmentSentAs(mediaType, accepts)` says how a file reaches a target: a text-like file always as text headed `### <filename>` (`formatAttachmentText`), a PDF as a file where the target's `accepts` lists it and as its text elsewhere, an image only as a file. `AttachmentTextTooLargeError` (`code: "pdf_text_too_large"`) names a PDF whose text is over 200 KB.
- **core:** a generator's model calls send a PDF as a file where the model's provider reads PDFs (Anthropic, OpenAI, Google) and as its extracted text for any other provider; `ModelResolver.prepareMessages` takes an optional `{ accepts }` target. The provider is read from `providerOf`, so a resolver that maps its own model aliases should map `providerOf` too. From `@flow-state-dev/core/harness`: `readHarnessTurnFiles(harness, ctx, accepts, files)` refuses, reads and splits a turn's files into those the harness reads and the text of the rest, and `promptWithTurnText(prompt, turn)` puts that text after the prompt. `HarnessAttachmentBytes` gains `text()`. `refuseUnacceptedAttachments` now passes a PDF or text-like file to a harness that declares `accepts`, since it can take the document's text.
- **engine:** the upload route checks a document before storing it: a text-like file must be UTF-8 with no NUL bytes and at most 200 KB, refused over it with its size, never cut (413 `attachment_text_too_large`, 415 `attachment_not_text`); a PDF must open and have at most 100 pages (413 `pdf_too_many_pages`, 415 `pdf_unreadable`). A PDF's text is extracted once at upload, page by page, a page with no text layer saying so, and kept in the blob store beside the PDF, claimed and deleted with it. A turn whose target gets a PDF's text fails before the target is called when that text is over 200 KB. New dependency: `unpdf`.
- **claude-code:** reads PDFs as document blocks; a text-like file goes as text after the prompt.
- **codex / cursor:** a PDF and a text-like file go as their text after the prompt. A scanned page has no text to hand over, and says so.
- **ui:** the composer takes every type the list takes by default, types text-like files by name, and refuses a text file over 200 KB, and a PDF the server counts over 100 pages, by name.

Docs: the documents table in the attachments guide (each type by target: a generator by provider, Claude Code, Codex, Cursor; that a scanned page has no text for Codex, Cursor and a provider that can't read PDFs; text files whole up to 200 KB, refused over it; PDFs to 100 pages; Word, Excel and PowerPoint refused); the limits line for PDFs and text files in packages/contracts/README.md; `readHarnessTurnFiles` and `promptWithTurnText` in packages/core/README.md; a line in packages/claude-code/README.md, packages/codex/README.md and packages/cursor/README.md on documents; the composer's default `accept` in the ui registry docs.
