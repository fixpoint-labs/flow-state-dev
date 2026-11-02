---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A conversation's line about a task now says which task it is, as data, so an app reads it without parsing the words (FIX-2378).

- `ctx.emit.message(text, { metadata })` attaches `metadata` to the message item. Clients read it; the model never sees it. `EmitMessageOptions` is exported from core.
- Orchestration adds `noticeMetadata(notice, task)` and `parseNotice(item)` beside `noticeText`. `parseNotice` returns the task, its ending, title and what came back, and still reads lines stored before this from their words.
- Workforce marks every task line it emits, and a delegate's answer carries the worker and the task it answered. Read it with `delegateAnswerOf(item)`, from the root or `./browser`.
