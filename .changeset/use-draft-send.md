---
"@flow-state-dev/react": minor
---

A message box's send, with its files, is one hook: `useDraftSend` (FIX-2717).

- **react:** `useDraftSend(namespace, id, attachments?)` returns `{ text, setText, sending, failure, submit, canSend }`. It is `useDraft` and `useSubmit` together: the text stays in the box until `submit(send)` lands, a send that lands clears it (unless something else was typed meanwhile), and one that fails keeps the text and sets `failure` to why. A second `submit` while one runs does nothing; an empty box sends nothing.
- **react:** pass the box's files as `attachments`, any object with `files` (`{ id, status }`), `refusals`, `settle()` and `consume(ids, shown)`, such as the UI registry's `useAttachments`. The send waits for their uploads, hands their `FileContent` references to `send` beside the line, and removes them from the box only once it lands. A box with files and no text sends too; a file refused while it uploaded is never sent, and a box left with nothing to send sends nothing. A file added while a send waits stays for the next one.
- **react:** also exported: the types `DraftSend`, `DraftSendFn` and `DraftSendAttachments`.

Docs: packages/react/README.md gains `useDraftSend` beside `useDraft` and `useSubmit`: its return, the `attachments` handle and what a send that fails keeps. apps/docs/docs/api/react.md: the same entry.
